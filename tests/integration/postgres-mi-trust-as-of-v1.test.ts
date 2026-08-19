import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  persistTrustAsOfReceiptV1Postgres,
  readTrustAsOfReceiptV1Postgres,
  resolveAndPersistTrustAsOfV1Postgres,
  TrustAsOfReceiptConflictError,
  TrustAsOfSourceNotFoundError,
} from "@/lib/trader/mi/trust-as-of-repository-postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-000000065401";
const USER_B = "00000000-0000-4000-8000-000000065402";
const SOURCE_A = "00000000-0000-4000-8000-000000065411";
const SOURCE_A_OTHER = "00000000-0000-4000-8000-000000065413";
const SOURCE_B = "00000000-0000-4000-8000-000000065412";
const ANCHOR = new Date("2026-08-19T12:00:00.000Z");
const hex64 = (seed: string) => createHash("sha256").update(seed).digest("hex");

async function clearMi(sql: postgres.Sql, org: string) {
  await sql.unsafe("ALTER TABLE trader_mi_trust_as_of_receipt_v1 DISABLE TRIGGER trader_mi_trust_as_of_receipt_v1_block_delete");
  await sql.unsafe("ALTER TABLE trader_mi_source_trust DISABLE TRIGGER trader_mi_source_trust_block_delete");
  try {
    await sql.unsafe("DELETE FROM trader_mi_trust_as_of_receipt_v1 WHERE organization_id = $1::uuid", [org]);
    await sql.unsafe("DELETE FROM trader_mi_source_trust WHERE organization_id = $1::uuid", [org]);
    await sql.unsafe("DELETE FROM trader_mi_source WHERE organization_id = $1::uuid", [org]);
  } finally {
    await sql.unsafe("ALTER TABLE trader_mi_source_trust ENABLE TRIGGER trader_mi_source_trust_block_delete");
    await sql.unsafe("ALTER TABLE trader_mi_trust_as_of_receipt_v1 ENABLE TRIGGER trader_mi_trust_as_of_receipt_v1_block_delete");
  }
}

async function resetUser(userId: string) {
  const sql = postgres(url!, { max: 1 });
  try {
    await clearMi(sql, personalOrganizationIdFromUserId(userId));
  } catch {
  } finally {
    await sql.end({ timeout: 5 });
  }
  await cleanupWp13Org(url!, userId);
}

const insertSource = (sql: postgres.Sql, org: string, source: string) => sql`
  INSERT INTO trader_mi_source (id, organization_id, venue, feed_kind, status)
  VALUES (${source}::uuid, ${org}::uuid, ${`test-${source.slice(-4)}`}, 'pit-trust', 'active')
`;

async function insertTrust(sql: postgres.Sql, input: {
  org: string; source: string; seq: number; revisionOf?: string | null;
  availableAt?: string | null; future?: boolean;
}) {
  const id = randomUUID();
  const day = input.future ? "20" : "19";
  const hour = `0${input.seq}`;
  await sql`
    INSERT INTO trader_mi_source_trust (
      id, organization_id, source_id, trust_score, rationale, recorded_by,
      event_time, available_at, ingest_time, revision_of, revision_seq, content_digest
    ) VALUES (
      ${id}::uuid, ${input.org}::uuid, ${input.source}::uuid, '0.70000000', 'test-only',
      'postgres-integration', ${`2026-08-${day}T${hour}:00:00Z`}::timestamptz,
      ${input.availableAt === null ? null : (input.availableAt ?? `2026-08-${day}T${hour}:05:00Z`)}::timestamptz,
      ${`2026-08-${day}T${hour}:10:00Z`}::timestamptz, ${input.revisionOf ?? null}::uuid,
      ${input.seq}, ${hex64(`${input.org}:${input.source}:${input.seq}:${id}`)}
    )
  `;
  return id;
}

describe.skipIf(!enabled || !url)("postgres MI TrustAsOfReceiptV1 (DEE-654)", () => {
  let sql: postgres.Sql;
  let db: WaiaPostgresDb;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    await resetUser(USER_A); await resetUser(USER_B);
    orgA = await seedWp13User(url!, USER_A, "DEE-654 PIT Org A");
    orgB = await seedWp13User(url!, USER_B, "DEE-654 PIT Org B");
    sql = postgres(url!, { max: 2 });
    db = drizzle(sql, { schema: pgSchema }) as WaiaPostgresDb;
  }, 120_000);

  beforeEach(async () => {
    await clearMi(sql, orgA); await clearMi(sql, orgB);
    await insertSource(sql, orgA, SOURCE_A); await insertSource(sql, orgA, SOURCE_A_OTHER);
    await insertSource(sql, orgB, SOURCE_B);
  });

  afterAll(async () => {
    if (sql) {
      await clearMi(sql, orgA); await clearMi(sql, orgB); await sql.end({ timeout: 10 });
    }
    await cleanupWp13Org(url!, USER_A); await cleanupWp13Org(url!, USER_B);
  });

  it("persists a complete prefix idempotently and ignores future extensions", async () => {
    const firstId = await insertTrust(sql, { org: orgA, source: SOURCE_A, seq: 1 });
    await insertTrust(sql, { org: orgA, source: SOURCE_A, seq: 2, revisionOf: firstId });
    const first = await resolveAndPersistTrustAsOfV1Postgres(db, { organizationId: orgA }, {
      sourceId: SOURCE_A, anchorTime: ANCHOR,
    });
    const secondId = first.receipt.selectedTrustRevisionId!;
    await insertTrust(sql, { org: orgA, source: SOURCE_A, seq: 3, revisionOf: secondId, future: true });
    const replay = await resolveAndPersistTrustAsOfV1Postgres(db, { organizationId: orgA }, {
      sourceId: SOURCE_A, anchorTime: ANCHOR,
    });
    expect(first).toMatchObject({ insertedNew: true, receipt: { status: "RESOLVED", selectedRevisionSeq: 2 } });
    expect(replay).toEqual({ receipt: first.receipt, insertedNew: false });
    const forgedDigest = "f".repeat(64);
    const forged = { ...first.receipt, id: forgedDigest, contentDigest: forgedDigest };
    await expect(persistTrustAsOfReceiptV1Postgres(db, { organizationId: orgA }, forged))
      .rejects.toBeInstanceOf(TrustAsOfReceiptConflictError);
    await expect(readTrustAsOfReceiptV1Postgres(db, { organizationId: orgA }, forgedDigest)).resolves.toBeNull();
  });

  it("persists UNKNOWN for nullable availability and exposes both additive columns", async () => {
    await insertTrust(sql, { org: orgA, source: SOURCE_A, seq: 1, availableAt: null });
    const result = await resolveAndPersistTrustAsOfV1Postgres(db, { organizationId: orgA }, {
      sourceId: SOURCE_A, anchorTime: ANCHOR,
    });
    expect(result.receipt).toMatchObject({ status: "UNKNOWN", unknownReason: "MISSING_AVAILABLE_AT" });
    const columns = await sql<{ table_name: string; is_nullable: string }[]>`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'available_at'
        AND table_name IN ('trader_mi_source_trust', 'trader_mi_observation') ORDER BY table_name
    `;
    expect(columns).toEqual([
      { table_name: "trader_mi_observation", is_nullable: "YES" },
      { table_name: "trader_mi_source_trust", is_nullable: "YES" },
    ]);
  });

  it("denies cross-tenant reads and cross-source selected-revision references", async () => {
    const wrongSourceRevision = await insertTrust(sql, { org: orgA, source: SOURCE_A_OTHER, seq: 1 });
    const own = await resolveAndPersistTrustAsOfV1Postgres(db, { organizationId: orgB }, {
      sourceId: SOURCE_B, anchorTime: ANCHOR,
    });
    await expect(resolveAndPersistTrustAsOfV1Postgres(db, { organizationId: orgA }, {
      sourceId: SOURCE_B, anchorTime: ANCHOR,
    })).rejects.toBeInstanceOf(TrustAsOfSourceNotFoundError);
    await expect(readTrustAsOfReceiptV1Postgres(db, { organizationId: orgA }, own.receipt.id)).resolves.toBeNull();

    const digest = hex64("cross-tenant-selected-revision");
    await expect(sql`INSERT INTO trader_mi_trust_as_of_receipt_v1 (
      id, organization_id, source_id, anchor_time, status, selected_trust_revision_id,
      selected_revision_seq, selected_content_digest, selected_trust_score, visible_prefix_digest,
      receipt_json, content_digest, schema_version
    ) VALUES (${digest}, ${orgA}::uuid, ${SOURCE_A}::uuid, ${ANCHOR.toISOString()}::timestamptz,
      'RESOLVED', ${wrongSourceRevision}::uuid, 1, ${hex64("selected")}, '0.7', ${hex64("prefix")}, '{}',
      ${digest}, 'trust-as-of-receipt-v1')`).rejects.toThrow();
  });

  it("blocks mutation and authenticated/anon direct access", async () => {
    await insertTrust(sql, { org: orgA, source: SOURCE_A, seq: 1 });
    const { receipt } = await resolveAndPersistTrustAsOfV1Postgres(db, { organizationId: orgA }, {
      sourceId: SOURCE_A, anchorTime: ANCHOR,
    });
    await expect(sql`UPDATE trader_mi_trust_as_of_receipt_v1 SET status = 'UNKNOWN' WHERE id = ${receipt.id}`).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM trader_mi_trust_as_of_receipt_v1 WHERE id = ${receipt.id}`).rejects.toThrow(/append-only/);

    for (const role of ["authenticated", "anon"] as const) {
      const roleSql = postgres(url!, { max: 1 });
      try {
        await roleSql.unsafe(`SET ROLE ${role}`);
        await expect(roleSql`SELECT * FROM trader_mi_trust_as_of_receipt_v1 LIMIT 1`).rejects.toThrow();
        await expect(roleSql`INSERT INTO trader_mi_trust_as_of_receipt_v1 SELECT * FROM trader_mi_trust_as_of_receipt_v1 LIMIT 0`).rejects.toThrow();
      } finally {
        try { await roleSql.unsafe("RESET ROLE"); } catch {}
        await roleSql.end({ timeout: 5 });
      }
    }
  });
});
