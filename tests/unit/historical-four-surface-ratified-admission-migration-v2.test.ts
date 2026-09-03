import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TAG = "0194_historical_four_surface_ratified_admission_v2";
const SQL = readFileSync(join(ROOT, "db/migrations_postgres", `${TAG}.sql`), "utf8");
const SCHEMA = readFileSync(join(ROOT, "db/schema.postgres.ts"), "utf8");

describe("DEE-919 four-surface ratified admission migration", () => {
  it("owns exactly one contiguous 0194 migration", () => {
    expect(readdirSync(join(ROOT, "db/migrations_postgres"))
      .filter((name) => /^0194_.*\.sql$/.test(name))).toEqual([`${TAG}.sql`]);
    const journal = JSON.parse(readFileSync(join(
      ROOT, "db/migrations_postgres/meta/_journal.json",
    ), "utf8")) as { entries: Array<Record<string, unknown>> };
    expect(journal.entries).toContainEqual({
      idx: 194, version: "7", when: 1780000000194, tag: TAG, breakpoints: true,
    });
  });

  it("is append-only, four-surface bound and tenant-scoped for the runner", () => {
    expect(SQL).toContain("jsonb_array_length(surface_admissions_json) = 4");
    expect(SQL).toContain("aggregate_admission_receipt_id");
    expect(SQL).toContain("operator_user_id");
    expect(SQL).toContain("knowledge_snapshots_json jsonb NOT NULL");
    expect(SQL).toContain("knowledge_snapshot_digest_hex text NOT NULL");
    expect(SQL).toContain("market_evidence_json jsonb NOT NULL");
    expect(SQL).toContain("market_evidence_digest_hex text NOT NULL");
    expect(SQL).toContain("authority_json -> 'knowledgeSnapshots' = knowledge_snapshots_json");
    expect(SQL).toContain("authority_json -> 'marketEvidence' = market_evidence_json");
    expect(SQL).toContain("(authority_json ->> 'epistemicRecordCutoff')::timestamptz = created_at");
    expect(SQL).toContain("BEFORE UPDATE");
    expect(SQL).toContain("BEFORE DELETE");
    expect(SQL).toContain("ENABLE ROW LEVEL SECURITY");
    expect(SQL).toContain("current_user = 'waia_historical_runner'");
    expect(SQL).toContain("GRANT SELECT ON TABLE");
    expect(SQL).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE)/i);
    expect(SQL).not.toMatch(/BYPASSRLS|service_role/i);
  });

  it("makes capital, live and blind holdout authority unrepresentable", () => {
    expect(SQL).toContain("'capitalAuthority', 'NONE'");
    expect(SQL).toContain("'liveTradingAuthority', 'NONE'");
    expect(SQL).toContain(
      "'blindHoldoutAuthority', 'FORBIDDEN_NOT_PRESENT_NOT_ACCESSED'",
    );
  });

  it("mirrors the named aggregate composite foreign key in Drizzle", () => {
    expect(SCHEMA).toContain("export const traderScientificAdmissionReceiptV1");
    expect(SCHEMA).toContain("scientific_admission_receipt_v1_full_lineage_unique");
    expect(SCHEMA).toContain(
      'name: "historical_four_surface_ratified_admission_v2_aggregate_fk"',
    );
    expect(SCHEMA).toContain("t.aggregateAdmissionReceiptId");
    expect(SCHEMA).toContain("traderScientificAdmissionReceiptV1.contentDigest");
    expect(SCHEMA).toContain('knowledgeSnapshotsJson: jsonb("knowledge_snapshots_json").notNull()');
    expect(SCHEMA).toContain(
      'knowledgeSnapshotDigestHex: text("knowledge_snapshot_digest_hex").notNull()',
    );
    expect(SCHEMA).toContain('marketEvidenceJson: jsonb("market_evidence_json").notNull()');
    expect(SCHEMA).toContain(
      'marketEvidenceDigestHex: text("market_evidence_digest_hex").notNull()',
    );
  });
});
