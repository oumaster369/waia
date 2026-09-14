import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FHV_V2_POSTGRES_REQUIRED_MIGRATION_MAX } from "@/lib/trader/observability/fhv-v2-postgres-schema-preflight";

const ROOT = process.cwd();
const TAG = "0209_ai_twin_epistemic_persistence_v1";
const sql = readFileSync(join(ROOT, "db/migrations_postgres", `${TAG}.sql`), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.postgres.ts"), "utf8");
const preflight = readFileSync(
  join(ROOT, "lib/trader/observability/fhv-v2-postgres-schema-preflight.ts"),
  "utf8",
);

const TABLES = [
  "ai_twin_object_versions",
  "ai_twin_consent_grants",
  "ai_twin_consent_issuance_receipts",
  "ai_twin_observations",
  "ai_twin_claim_revisions",
  "ai_twin_human_corrections",
  "ai_twin_evidence_links",
  "ai_twin_working_hypotheses",
  "ai_twin_dynamic_relations",
  "ai_twin_knowledge_needs",
  "ai_twin_command_receipts",
  "ai_twin_rights_operations",
  "ai_twin_rights_operation_events",
  "ai_twin_rights_operation_attempts",
  "ai_twin_rights_operation_effects",
  "ai_twin_rights_completion_evidence",
  "ai_twin_model_endorsements",
  "ai_twin_necessity_reviews",
] as const;

describe("DEE-871 AI-TWIN epistemic persistence migration 0209", () => {
  it("owns exactly one contiguous 0209 journaled migration", () => {
    expect(
      readdirSync(join(ROOT, "db/migrations_postgres")).filter((name) =>
        /^0209_.*\.sql$/.test(name),
      ),
    ).toEqual([`${TAG}.sql`]);
    const journal = JSON.parse(
      readFileSync(join(ROOT, "db/migrations_postgres/meta/_journal.json"), "utf8"),
    ) as { entries: Array<Record<string, unknown>> };
    expect(journal.entries.at(-1)).toEqual({
      idx: 209,
      version: "7",
      when: 1780000000209,
      tag: TAG,
      breakpoints: true,
    });
    expect(sql).toContain("--> statement-breakpoint");
    expect(
      createHash("sha256")
        .update(readFileSync(join(ROOT, "db/migrations_postgres", `${TAG}.sql`)))
        .digest("hex"),
    ).toHaveLength(64);
  });

  it("creates the ratified epistemic tables and omits private archive", () => {
    for (const table of TABLES) {
      expect(sql).toContain(`CREATE TABLE public.${table}`);
      expect(schema).toMatch(new RegExp(`"${table}"`));
    }
    expect(sql).not.toContain("ai_twin_private_sources");
    expect(sql).not.toContain("ai_twin_private_experiences");
    expect(sql).not.toContain("ai_twin_private_experience_sources");
    expect(schema).not.toContain("ai_twin_private_sources");
  });

  it("is create-only additive without RLS, triggers, backfill or Trader table rewrites", () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.(?!ai_twin_)/);
    expect(sql).not.toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toContain("CREATE TRIGGER");
    expect(sql).not.toContain("UPDATE public.");
    expect(sql).not.toContain("INSERT INTO public.twin_");
    expect(sql).toContain("REFERENCES public.organization_members (organization_id, user_id)");
    expect(sql).toContain("ON DELETE RESTRICT");
  });

  it("keeps Trader scientific prefix at 0207 and admits 0209 only as compatible additive", () => {
    expect(FHV_V2_POSTGRES_REQUIRED_MIGRATION_MAX).toBe(207);
    expect(preflight).toContain('tag: "0209_ai_twin_epistemic_persistence_v1"');
    expect(preflight).not.toContain("ai_twin_object_versions");
    expect(preflight).toContain("FHV_V2_POSTGRES_REQUIRED_MIGRATION_MAX = 207");
  });

  it("binds endorsements and necessity reviews to exact claim revisions", () => {
    expect(sql).toContain("target_object_kind text NOT NULL DEFAULT 'claim'");
    expect(sql).toContain("REFERENCES public.ai_twin_claim_revisions");
    expect(sql).toContain("basis = 'initial_model_endorsement'");
    expect(sql).toContain("basis = 'storage_necessity'");
  });

  it("exports a fresh non-cached session lookup without mounting writers", () => {
    const session = readFileSync(join(ROOT, "lib/auth/session-user.ts"), "utf8");
    expect(session).toContain(
      "export const getFreshOptionalSessionUserId = resolveOptionalSessionUserId",
    );
    const production = readFileSync(
      join(ROOT, "lib/ai-twin/model/postgres-production-repository.ts"),
      "utf8",
    );
    expect(production).not.toContain("app/");
    expect(production).toContain("withPostgresSerializableTransactionRetry");
  });
});
