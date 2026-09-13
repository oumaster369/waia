import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TAG = "0208_historical_terminal_receipts_v1";
const sql = readFileSync(join(ROOT, "db/migrations_postgres", `${TAG}.sql`), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.postgres.ts"), "utf8");

describe("DEE-1006 historical terminal receipts migration", () => {
  it("owns exactly one contiguous 0208 journaled migration", () => {
    expect(
      readdirSync(join(ROOT, "db/migrations_postgres")).filter((name) =>
        /^0208_.*\.sql$/.test(name),
      ),
    ).toEqual([`${TAG}.sql`]);
    const journal = JSON.parse(
      readFileSync(join(ROOT, "db/migrations_postgres/meta/_journal.json"), "utf8"),
    ) as { entries: Array<Record<string, unknown>> };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 208,
      version: "7",
      when: 1780000000208,
      tag: TAG,
      breakpoints: true,
    });
    expect(sql).toContain("--> statement-breakpoint");
  });

  it("creates sibling append-only tables and does not overload admitted receipts", () => {
    expect(sql).toContain("trader_historical_scientific_admission_refusal_v1");
    expect(sql).toContain("trader_historical_rehearsal_started_v1");
    expect(sql).not.toContain("ALTER TABLE public.trader_scientific_admission_receipt_v1");
    expect(sql).toContain(
      "schema_version = 'waia.trader.historical_scientific_admission_refusal.v1'",
    );
    expect(sql).toContain("schema_version = 'waia.trader.historical_rehearsal_started.v1'");
  });

  it("proves UPDATE and DELETE raise via the 0201 append-only blocker", () => {
    expect(sql).toContain(
      "BEFORE UPDATE OR DELETE ON public.trader_historical_scientific_admission_refusal_v1",
    );
    expect(sql).toContain(
      "BEFORE UPDATE OR DELETE ON public.trader_historical_rehearsal_started_v1",
    );
    expect(sql).toContain("waia_historical_ratification_split_v2_block_mutation");
    expect(sql).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.waia_historical_ratification_split_v2_block_mutation/,
    );
    const blocker = readFileSync(
      join(ROOT, "db/migrations_postgres/0201_historical_ratification_split_v2.sql"),
      "utf8",
    );
    expect(blocker).toContain(
      "RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP",
    );
  });

  it("denies browser roles and force-enables RLS", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("FOR ALL TO authenticated, anon");
    expect(sql).toContain("USING (false) WITH CHECK (false)");
  });

  it("grants runner SELECT and column-scoped INSERT under lineage WITH CHECK", () => {
    expect(sql).toContain("REVOKE ALL ON public.trader_historical_scientific_admission_refusal_v1");
    expect(sql).toContain("REVOKE ALL ON public.trader_historical_rehearsal_started_v1");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated, waia_historical_runner");
    expect(sql).toContain(
      "GRANT SELECT ON public.trader_historical_scientific_admission_refusal_v1 TO waia_historical_runner",
    );
    expect(sql).toContain(
      "GRANT SELECT ON public.trader_historical_rehearsal_started_v1 TO waia_historical_runner",
    );
    expect(sql).toContain(
      "GRANT INSERT (organization_id, run_id, release_sha, runtime_release_binding_receipt_digest_hex",
    );
    expect(sql).toContain("GRANT INSERT (organization_id, account_id, run_id, release_sha");
    expect(sql).toContain("organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid");
    expect(sql).toContain("JOIN public.trader_historical_proposal_ratification_v2 approval");
    expect(sql).toContain(
      "JOIN public.trader_historical_four_surface_ratified_admission_v2 authority",
    );
    expect(sql).toContain("historical_rehearsal_started_v1_runner_insert");
    expect(sql).not.toMatch(/GRANT\s+(?:UPDATE|DELETE|TRUNCATE)/i);
  });

  it("binds JSON fields to extracted columns and seals the content digest", () => {
    expect(sql).toContain("jsonb_array_length(receipt_json -> 'surfaces') = 4");
    expect(sql).toContain("waia_historical_refusal_comparison_identities_valid_v1");
    expect(sql).toContain("jsonb_array_elements(identities)");
    expect(sql).not.toMatch(
      /CHECK \([\s\S]*SELECT count\([\s\S]*jsonb_array_elements\(receipt_json/,
    );
    expect(sql).toContain("resampleOrdinalStartInclusive')::integer) = 0");
    expect(sql).toContain("resampleOrdinalEndExclusive')::integer) = 10000");
    expect(sql).toContain("waia_canonical_jsonb_v1(receipt_json - 'contentDigestHex'::text)");
    expect(sql).toContain("(receipt_json ->> 'reasonCode') = reason_code");
    expect(sql).toContain("(receipt_json -> 'lifecycle' ->> 'phase') IN ('RUNNING','COMPLETED')");
    expect(schema).toContain("export const traderHistoricalScientificAdmissionRefusalV1");
    expect(schema).toContain("export const traderHistoricalRehearsalStartedV1");
  });
});
