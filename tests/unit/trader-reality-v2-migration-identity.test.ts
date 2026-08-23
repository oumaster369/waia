import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATION_TAG = "0160_trader_reality_v2";
const MIGRATION_PATH = join(ROOT, "db/migrations_postgres", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "db/migrations_postgres/meta/_journal.json");
const REPOSITORY_PATH = join(ROOT, "lib/trader/reality/v2/repository-postgres.ts");

describe("Reality V2 migration identity (DEE-677)", () => {
  it("owns exactly one next-numbered 0160 PostgreSQL migration", () => {
    const files = readdirSync(join(ROOT, "db/migrations_postgres"))
      .filter((name) => /^0160_.*\.sql$/.test(name));
    expect(files).toEqual([`${MIGRATION_TAG}.sql`]);

    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    expect(journal.entries).toContainEqual({
      idx: 160,
      version: "7",
      when: 1780000000160,
      tag: MIGRATION_TAG,
      breakpoints: true,
    });
    expect(journal.entries.filter((entry) => entry.tag === MIGRATION_TAG)).toHaveLength(1);
  });

  it("creates exactly four ledger and two protected deny-RLS tables without raw payload storage", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const createdTables = [...sql.matchAll(/CREATE TABLE public\.(trader_reality_[a-z_]+_v2)/g)]
      .map((match) => match[1]);
    expect(createdTables).toEqual([
      "trader_reality_raw_source_admissions_v2",
      "trader_reality_knowledge_frontiers_v2",
      "trader_reality_source_reports_v2",
      "trader_reality_truth_records_v2",
      "trader_reality_events_v2",
      "trader_reality_projections_v2",
    ]);
    expect(sql).not.toMatch(/raw_payload|raw_body|body_bytes|api_secret|access_key|signature text/i);
    expect(sql.match(/account_id text NOT NULL CHECK \(account_id ~ '\[\^\[:space:\]\]'\)/g))
      .toHaveLength(6);
    for (const table of createdTables) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY ${table}_deny_client_all`);
    }
    for (const table of createdTables.filter((table) =>
      table !== "trader_reality_knowledge_frontiers_v2")) {
      expect(sql).toContain(`${table}_block_update`);
      expect(sql).toContain(`${table}_block_delete`);
    }
  });

  it("pins database-authored knowledge time, scoped lineage, correction, and event-head guards", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toContain("waia_reality_v2_allocate_knowledge_at");
    expect(sql).toContain("waia_reality_v2_consume_knowledge_reservation");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("pending_transaction_id = txid_current()");
    expect(sql).toContain("Reality knowledge allocation requires a nonblank account scope");
    expect(sql).toContain("reservation consumption requires a nonblank account scope");
    expect(sql).toContain("date_trunc('milliseconds', transaction_timestamp())");
    expect(sql).toContain("last_knowledge_at + interval '1 millisecond'");
    expect(sql).toContain("forged, stale, reused, or cross-scope");
    expect(sql).not.toContain("current_setting('waia.reality_v2_reserved");
    expect(sql).not.toContain("set_config('waia.reality_v2_reserved");
    expect(sql).toContain("ExecutionReportV2 lineage does not match scoped immutable HTX source");
    expect(sql).toContain("report.report_sequence::text");
    expect(sql).toContain("report.report_type = NEW.provenance");
    expect(sql).toContain("upper(attempt.venue) = 'HTX'");
    expect(sql).toContain("registered private REST source class");
    expect(sql).toContain("feed_class = 'raw-foundation'");
    expect(sql).not.toMatch(/htx_private_spot_.*_rest_v1/);
    expect(sql).toContain("source_account_unique");
    expect(sql).toContain("admitted Reality capture-source identity is immutable");
    expect(sql).toContain("Only explicit source-native correction may supersede scoped truth");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("Reality event sequence/digest head mismatch");
    expect(sql).toContain("OBSERVED must introduce exactly one unsuperseding stable truth");
    expect(sql).toContain("SUPERSEDED must exactly link a source-native correction");
    expect(sql).toContain("'[\"CORRECTION_TARGET_NOT_FOUND\"]'::jsonb");
    expect(sql).toContain("NOT (NEW.reason_codes ? 'CORRECTION_TARGET_NOT_FOUND')");
    expect(sql).toContain("source_row.attribution_status = 'ATTRIBUTED'");
    expect(sql).toContain("source_row.source_native_identity_kind IS NOT NULL");
    expect(sql).toContain(
      "QUARANTINED must exactly preserve one source-only causal episode with an absent correction target",
    );
    expect(sql).toContain(
      "target_truth.source_native_revision IS NOT DISTINCT FROM\n                source_row.supersedes_native_revision",
    );
    expect(sql).toContain("stable_event.event_type IN ('OBSERVED', 'SUPERSEDED')");
    expect(sql).toContain("later_correction.related_truth_record_id = target_truth.id");
    expect(sql).toContain("SOURCE_CONTRADICTION must exactly link disputed and current stable truth");
    expect(sql).toContain("RELEASED must exactly resolve one causally linked truth-bearing quarantine");
    expect(sql).toContain("Reality causal episode already has an unresolved quarantine");
    expect(sql).toContain("trader_reality_events_v2_one_release_per_quarantine");
    expect(sql).toContain("Reality projection frontier is not exact at requested as-of time");
    expect(sql).toContain("frontier_row.knowledge_at <> NEW.knowledge_as_of");
  });

  it("pins strict transport metadata domains for TypeScript-bypass/direct SQL writes", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toContain("trader_reality_source_reports_v2_provenance");
    expect(sql).toContain("provenance->'sourceFinalityMetadata' = '[]'::jsonb");
    expect(sql).toContain("'{sourceFinalityMetadata,0,value}'");
    expect(sql).toContain("'{sourceFinalityMetadata,1,value}'");
    expect(sql).toContain("'9223372036854775807'");
    expect(sql).toContain("'FILL_REPORT_OBSERVED'");
    expect(sql).toContain("provenance - ARRAY[");
  });

  it("keeps generic event/projection persistence private behind intent-specific writes", () => {
    const repository = readFileSync(REPOSITORY_PATH, "utf8");
    expect(repository).not.toMatch(/export async function appendRealityEventV2FromWriter/);
    expect(repository).not.toMatch(/export async function insertRealityProjectionV2FromWriter/);
    expect(repository).toContain("export async function appendObservedRealityTruthV2FromWriter");
    expect(repository).toContain("export async function appendSupersededRealityTruthV2FromWriter");
    expect(repository).toContain("export async function persistCanonicalRealityProjectionV2FromWriter");
    expect(repository).toContain("canonicalJsonString(expectedProjection)");
    expect(repository).toContain("waia_reality_v2_allocate_knowledge_at");
    expect(repository).toContain("knowledgeReservationId: allocation.reservationId");
    expect(repository).toContain("quarantineEventId: causal.id");
  });
});
