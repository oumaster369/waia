import { createHash } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  attestRawSecretScanV1,
  buildRawStorageBindingAtDurableBoundaryV1,
  defineRawCapturePolicyV1,
  prepareRawCaptureV1,
} from "@/lib/trader/mi/raw-capture-v1";
import { persistPreparedRawCaptureV1Postgres } from "@/lib/trader/mi/raw-capture-repository-postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { createRealityEventV2, createRealityProjectionV2 } from "@/lib/trader/reality/v2/contracts";
import {
  ingestRealitySourceReportV2Postgres,
  releaseRealityQuarantineV2Postgres,
} from "@/lib/trader/reality/v2/ingest-postgres";
import {
  readCurrentRealityProjectionV2Postgres,
  replayRealityProjectionV2Postgres,
} from "@/lib/trader/reality/v2/replay";
import {
  appendRealityEventV2FromWriter,
  appendRealitySourceReportV2Postgres,
  createTruthFromVerifiedSourceV2,
  insertRealityProjectionV2FromWriter,
  insertTruthRecordV2FromWriter,
  listRealityEventsV2,
  listRealitySourceReportsV2,
  listTruthRecordsV2,
  readLatestRealityProjectionV2,
  readRealitySourceReportV2,
} from "@/lib/trader/reality/v2/repository-postgres";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-000000067701";
const USER_B = "00000000-0000-4000-8000-000000067702";
const SOURCE_A = "00000000-0000-4000-8000-000000067711";
const SOURCE_B = "00000000-0000-4000-8000-000000067712";
const ACCOUNT = "htx-spot-reality-b";
const realityTables = [
  "trader_reality_source_reports_v2",
  "trader_reality_truth_records_v2",
  "trader_reality_events_v2",
  "trader_reality_projections_v2",
] as const;
const rawTables = [
  "trader_mi_raw_validation_receipt_v1",
  "trader_mi_raw_capture_receipt_v1",
  "trader_mi_raw_storage_binding_v1",
] as const;

function hex64(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

async function clearOrg(sqlClient: postgres.Sql, organizationId: string): Promise<void> {
  for (const table of [...realityTables, ...rawTables]) {
    await sqlClient.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
  }
  try {
    for (const table of [...realityTables].reverse()) {
      await sqlClient.unsafe(`DELETE FROM ${table} WHERE organization_id = $1::uuid`, [organizationId]);
    }
    for (const table of rawTables) {
      await sqlClient.unsafe(`DELETE FROM ${table} WHERE organization_id = $1::uuid`, [organizationId]);
    }
    await sqlClient.unsafe("DELETE FROM trader_mi_source WHERE organization_id = $1::uuid", [organizationId]);
  } finally {
    for (const table of [...realityTables, ...rawTables].reverse()) {
      await sqlClient.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
    }
  }
}

async function resetUser(userId: string): Promise<void> {
  const sqlClient = postgres(url!, { max: 1 });
  try {
    await clearOrg(sqlClient, personalOrganizationIdFromUserId(userId));
  } catch {
    // The first bootstrap may not have installed 0160 yet.
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
  await cleanupWp13Org(url!, userId);
}

async function capture(
  db: WaiaPostgresDb,
  organizationId: string,
  sourceId: string,
  seed: string,
) {
  const bodyBytes = new TextEncoder().encode(`{"fixture":"${seed}"}`);
  const prepared = prepareRawCaptureV1({
    organizationId,
    sourceId,
    bodyBytes,
    policy: defineRawCapturePolicyV1({ maxPayloadBytes: 1_024, retentionSeconds: 3_600 }),
    secretScanReceipt: attestRawSecretScanV1({
      status: "PASS",
      bodyBytes,
      scannerId: "reality-v2-postgres-test",
      scannerVersion: "v1",
      completedAt: new Date(Date.now() - 10_000),
    }),
  });
  const storageBinding = buildRawStorageBindingAtDurableBoundaryV1({
    organizationId,
    sourceId,
    rawBytesDigest: prepared.rawBytesDigest,
    objectReference: {
      storageBackendId: "test-private-encrypted-store",
      objectKey: `reality-v2/${seed}`,
      objectVersion: "1",
      encryptionRequirement: "PRIVATE_ENCRYPTED",
      accessRequirement: "SERVER_ONLY",
    },
    storedAt: new Date(Date.now() - 5_000),
  });
  return persistPreparedRawCaptureV1Postgres(db, { organizationId }, {
    prepared,
    storageBinding,
  });
}

function fillInput(
  receipt: Awaited<ReturnType<typeof capture>>["receipt"],
  revision: string,
  supersedesNativeRevision: string | null,
  quantity = "0.001",
) {
  return {
    sourceKind: "HTX_SPOT_FILL_REST" as const,
    sourceNativeIdentity: {
      identityKind: "HTX_TRADE_ID" as const,
      nativeId: "htx-trade-reality-b",
      nativeRevision: revision,
      supersedesNativeRevision,
    },
    attributionStatus: "ATTRIBUTED" as const,
    subject: { subjectClass: "FILL" as const, subjectKey: "HTX:spot:htx-trade-reality-b" },
    primitiveAssertion: {
      kind: "FILL" as const,
      venueTradeId: "htx-trade-reality-b",
      venueOrderId: "htx-order-reality-b",
      symbol: "BTCUSDT",
      side: "buy" as const,
      quantity,
      price: "25000",
      feeAmount: "0.025",
      feeAsset: "USDT",
      settlementStatus: "OBSERVED" as const,
    },
    lineage: {
      lineageKind: "RAW_CAPTURE_V1" as const,
      rawCaptureReceiptDigestHex: receipt.contentDigest,
      rawBytesDigestHex: receipt.rawBytesDigest,
      storageBindingDigestHex: receipt.storageBindingDigest,
    },
    provenance: {
      venue: "HTX" as const,
      transport: "REST" as const,
      connectorId: "htx-existing-boundary",
      connectorVersion: "test-v1",
      adapterVersion: "reality-htx-spot-v1",
      sourceFinalityMetadata: [{ key: "settlement", value: "observed" }] as const,
    },
    structuralVerification: "VERIFIED" as const,
    verificationReasonCodes: [] as const,
    validAtUtc: new Date(Date.now() - 60_000).toISOString(),
  };
}

describe.skipIf(!enabled || !url)("PostgreSQL Reality V2 substrate (DEE-677)", () => {
  let sqlClient: postgres.Sql;
  let db: WaiaPostgresDb;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    await resetUser(USER_A);
    await resetUser(USER_B);
    orgA = await seedWp13User(url!, USER_A, "DEE-677 Reality Org A");
    orgB = await seedWp13User(url!, USER_B, "DEE-677 Reality Org B");
    sqlClient = postgres(url!, { max: 4 });
    db = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
  }, 120_000);

  beforeEach(async () => {
    await clearOrg(sqlClient, orgA);
    await clearOrg(sqlClient, orgB);
    await sqlClient`INSERT INTO trader_mi_source (id, organization_id, venue, feed_kind, status)
      VALUES (${SOURCE_A}::uuid, ${orgA}::uuid, 'htx', 'raw-foundation', 'active')`;
    await sqlClient`INSERT INTO trader_mi_source (id, organization_id, venue, feed_kind, status)
      VALUES (${SOURCE_B}::uuid, ${orgB}::uuid, 'htx', 'raw-foundation', 'active')`;
  });

  afterAll(async () => {
    if (sqlClient) {
      await clearOrg(sqlClient, orgA);
      await clearOrg(sqlClient, orgB);
      await sqlClient.end({ timeout: 10 });
    }
    await cleanupWp13Org(url!, USER_A);
    await cleanupWp13Org(url!, USER_B);
  });

  it("stores only immutable scoped digest/reference lineage and exact verified truth", async () => {
    const raw = await capture(db, orgA, SOURCE_A, "base");
    const input = fillInput(raw.receipt, "1", null);
    const stored = await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      input,
    );
    const replay = await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      input,
    );
    expect(stored.insertedNew).toBe(true);
    expect(replay).toEqual({ report: stored.report, insertedNew: false });
    const siblingInput = {
      ...input,
      sourceNativeIdentity: {
        identityKind: "HTX_TRADE_ID" as const,
        nativeId: "htx-trade-reality-b-sibling",
        nativeRevision: null,
        supersedesNativeRevision: null,
      },
      subject: {
        subjectClass: "FILL" as const,
        subjectKey: "HTX:spot:htx-trade-reality-b-sibling",
      },
      primitiveAssertion: {
        ...input.primitiveAssertion,
        venueTradeId: "htx-trade-reality-b-sibling",
      },
    };
    const sibling = await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      siblingInput,
    );
    expect(sibling.insertedNew).toBe(true);
    await expect(appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      { ...input, primitiveAssertion: { ...input.primitiveAssertion, quantity: "0.009" } },
    )).rejects.toThrow(/reinterpreted with different semantics/);
    expect(await readRealitySourceReportV2(
      db,
      { organizationId: orgB, accountId: ACCOUNT },
      stored.report.sourceReportId,
    )).toBeNull();
    expect(await listRealitySourceReportsV2(db, { organizationId: orgB, accountId: ACCOUNT }))
      .toEqual([]);

    const rows = await sqlClient<{ knowledge_at: string; created_at: string }[]>`
      SELECT knowledge_at, created_at FROM trader_reality_source_reports_v2
      WHERE id = ${stored.report.sourceReportId}
    `;
    expect(new Date(rows[0]!.knowledge_at).toISOString())
      .toBe(new Date(rows[0]!.created_at).toISOString());
    const forbidden = await sqlClient<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY(${realityTables as unknown as string[]})
        AND column_name IN (
          'body', 'body_bytes', 'raw_body', 'raw_bytes', 'raw_payload', 'payload_json',
          'api_key', 'access_key', 'secret', 'signature'
        )
    `;
    expect(forbidden).toEqual([]);

    const truth = createTruthFromVerifiedSourceV2(stored.report, {
      supersedesTruthRecordId: null,
      markers: [],
    });
    await runWaiaPostgresTransaction(db, async (tx) => {
      await insertTruthRecordV2FromWriter(tx, { organizationId: orgA, accountId: ACCOUNT }, truth);
    });
    expect(await listTruthRecordsV2(db, { organizationId: orgA, accountId: ACCOUNT }))
      .toEqual([truth]);
    expect(await listTruthRecordsV2(db, { organizationId: orgB, accountId: ACCOUNT }))
      .toEqual([]);

    await expect(sqlClient`
      UPDATE trader_reality_truth_records_v2 SET content_digest = content_digest
      WHERE id = ${truth.truthRecordId}
    `).rejects.toThrow(/append-only/);
    await expect(sqlClient`
      DELETE FROM trader_reality_source_reports_v2 WHERE id = ${stored.report.sourceReportId}
    `).rejects.toThrow(/append-only/);
  });

  it("accepts only explicit source-native correction and preserves a serialized digest frontier", async () => {
    const baseRaw = await capture(db, orgA, SOURCE_A, "revision-1");
    const correctionRaw = await capture(db, orgA, SOURCE_A, "revision-2");
    const baseSource = (await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(baseRaw.receipt, "1", null),
    )).report;
    const correctedSource = (await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(correctionRaw.receipt, "2", "1", "0.002"),
    )).report;
    const baseTruth = createTruthFromVerifiedSourceV2(baseSource, {
      supersedesTruthRecordId: null,
      markers: [],
    });
    const correctedTruth = createTruthFromVerifiedSourceV2(correctedSource, {
      supersedesTruthRecordId: baseTruth.truthRecordId,
      markers: [],
    });
    await runWaiaPostgresTransaction(db, async (tx) => {
      await insertTruthRecordV2FromWriter(tx, { organizationId: orgA, accountId: ACCOUNT }, baseTruth);
      await insertTruthRecordV2FromWriter(tx, { organizationId: orgA, accountId: ACCOUNT }, correctedTruth);
    });

    const eventInputs = [
      { sourceReportId: baseSource.sourceReportId, truthRecordId: baseTruth.truthRecordId },
      { sourceReportId: correctedSource.sourceReportId, truthRecordId: correctedTruth.truthRecordId },
    ];
    await Promise.all(eventInputs.map((input) => runWaiaPostgresTransaction(db, async (tx) =>
      appendRealityEventV2FromWriter(tx, { organizationId: orgA, accountId: ACCOUNT }, {
        eventType: "OBSERVED",
        ...input,
        relatedTruthRecordId: null,
        reasonCodes: [],
      }))));
    const events = await listRealityEventsV2(db, { organizationId: orgA, accountId: ACCOUNT });
    expect(events.map((event) => event.eventSequence)).toEqual(["1", "2"]);
    expect(events[1]!.previousEventDigestHex).toBe(events[0]!.contentDigestHex);

    const stale = createRealityEventV2({
      organizationId: orgA,
      accountId: ACCOUNT,
      eventSequence: "1",
      eventType: "OBSERVED",
      sourceReportId: baseSource.sourceReportId,
      truthRecordId: baseTruth.truthRecordId,
      relatedTruthRecordId: null,
      reasonCodes: [],
      knowledgeAtUtc: new Date().toISOString(),
      previousEventDigestHex: null,
    });
    await expect(sqlClient`
      INSERT INTO trader_reality_events_v2 (
        id, organization_id, account_id, event_sequence, event_type, source_report_id,
        truth_record_id, related_truth_record_id, reason_codes, knowledge_at,
        previous_event_digest, content_digest, schema_version
      ) VALUES (
        ${stale.realityEventId}, ${orgA}::uuid, ${ACCOUNT}, 1, 'OBSERVED',
        ${baseSource.sourceReportId}, ${baseTruth.truthRecordId}, NULL, '[]'::jsonb,
        ${stale.knowledgeAtUtc}, NULL, ${stale.contentDigestHex}, ${stale.schemaVersion}
      )
    `).rejects.toThrow(/sequence\/digest head mismatch/);

    const head = events[1]!;
    const projection = createRealityProjectionV2({
      organizationId: orgA,
      accountId: ACCOUNT,
      knowledgeAsOfUtc: head.knowledgeAtUtc,
      frontierSequence: head.eventSequence,
      frontierEventDigestHex: head.contentDigestHex,
      stableEntries: [{
        subject: correctedTruth.subject,
        truthRecordId: correctedTruth.truthRecordId,
        sourceReportId: correctedTruth.sourceReportId,
        validAtUtc: correctedTruth.validAtUtc,
        knowledgeAtUtc: correctedTruth.knowledgeAtUtc,
        primitiveAssertion: correctedTruth.primitiveAssertion,
      }],
      uncertainties: [],
    });
    await runWaiaPostgresTransaction(db, async (tx) => {
      await insertRealityProjectionV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        projection,
      );
    });
    expect(await readLatestRealityProjectionV2(db, { organizationId: orgA, accountId: ACCOUNT }))
      .toEqual(projection);
    expect(await readLatestRealityProjectionV2(db, { organizationId: orgB, accountId: ACCOUNT }))
      .toBeNull();
  });

  it("deduplicates, quarantines contradictions, preserves stable truth, and replays exact as-of state", async () => {
    const baseRaw = await capture(db, orgA, SOURCE_A, "ingest-base");
    const base = await ingestRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(baseRaw.receipt, "1", null),
    );
    expect(base.classification).toBe("NEW_FACT");
    expect(base.projection?.stableEntries[0]?.truthRecordId).toBe(base.truthRecord?.truthRecordId);

    const duplicateRaw = await capture(db, orgA, SOURCE_A, "ingest-duplicate");
    const duplicate = await ingestRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(duplicateRaw.receipt, "1", null),
    );
    expect(duplicate.classification).toBe("DUPLICATE");
    expect(await listTruthRecordsV2(db, { organizationId: orgA, accountId: ACCOUNT }))
      .toHaveLength(1);
    expect(await listRealityEventsV2(db, { organizationId: orgA, accountId: ACCOUNT }))
      .toHaveLength(1);

    const disputedRaw = await capture(db, orgA, SOURCE_A, "ingest-disputed");
    const disputed = await ingestRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(disputedRaw.receipt, "1", null, "0.002"),
    );
    expect(disputed.classification).toBe("SOURCE_CONTRADICTION");
    expect(disputed.projection?.stableEntries[0]?.truthRecordId)
      .toBe(base.truthRecord?.truthRecordId);
    expect(disputed.projection?.uncertainties).toHaveLength(1);

    const contradictionAsOf = disputed.projection!.knowledgeAsOfUtc;
    const replayedContradiction = await replayRealityProjectionV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      contradictionAsOf,
    );
    expect(replayedContradiction).toEqual(disputed.projection);

    const released = await releaseRealityQuarantineV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      disputed.sourceReport.sourceReportId,
    );
    expect(released.stableEntries[0]?.truthRecordId).toBe(base.truthRecord?.truthRecordId);
    expect(released.uncertainties).toEqual([]);

    const correctionRaw = await capture(db, orgA, SOURCE_A, "ingest-correction");
    const correction = await ingestRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(correctionRaw.receipt, "2", "1", "0.003"),
    );
    expect(correction.classification).toBe("EXPLICIT_CORRECTION");
    expect(correction.truthRecord?.supersedesTruthRecordId).toBe(base.truthRecord?.truthRecordId);
    expect(correction.projection?.stableEntries[0]?.truthRecordId)
      .toBe(correction.truthRecord?.truthRecordId);

    const restarted = await readCurrentRealityProjectionV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
    );
    expect(restarted).toEqual(correction.projection);
    expect(await readCurrentRealityProjectionV2Postgres(
      db,
      { organizationId: orgB, accountId: ACCOUNT },
    )).toBeNull();
  });

  it("enforces deny RLS for authenticated and anon across real CRUD paths", async () => {
    const metadata = await sqlClient<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${realityTables as unknown as string[]})
      ORDER BY c.relname
    `;
    expect(metadata).toHaveLength(4);
    expect(metadata.every((row) => row.relrowsecurity)).toBe(true);
    const policies = await sqlClient<{
      tablename: string; roles: string[]; cmd: string; qual: string; with_check: string;
    }[]>`
      SELECT tablename, roles, cmd, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(${realityTables as unknown as string[]})
      ORDER BY tablename
    `;
    expect(policies).toHaveLength(4);
    expect(policies.every((policy) =>
      policy.cmd === "ALL" && policy.qual === "false" && policy.with_check === "false" &&
      policy.roles.includes("authenticated") && policy.roles.includes("anon")
    )).toBe(true);

    await sqlClient.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${realityTables.join(", ")} TO authenticated, anon`,
    );
    try {
      for (const role of ["authenticated", "anon"] as const) {
        const roleSql = postgres(url!, { max: 1 });
        try {
          await roleSql.unsafe(`SET ROLE ${role}`);
          for (const table of realityTables) {
            await expect(roleSql.unsafe(`SELECT * FROM ${table}`)).resolves.toEqual([]);
            await expect(roleSql.unsafe(
              `UPDATE ${table} SET organization_id = organization_id RETURNING organization_id`,
            )).resolves.toEqual([]);
            await expect(roleSql.unsafe(`DELETE FROM ${table} RETURNING organization_id`))
              .resolves.toEqual([]);
          }
          const denied = hex64(`${role}-reality-denied`);
          await expect(roleSql.unsafe(`
            INSERT INTO trader_reality_projections_v2 (
              id, organization_id, account_id, projection_policy_version, knowledge_as_of,
              frontier_sequence, frontier_event_digest, stable_entries, uncertainties,
              content_digest, schema_version
            ) VALUES (
              '${denied}', '${orgA}', '${ACCOUNT}', 'reality-fold/htx-spot-v1',
              now() - interval '1 minute', 0, NULL, '[]', '[]',
              '${denied}', 'reality-projection/v2'
            )
          `)).rejects.toThrow(/row-level security/);
        } finally {
          try { await roleSql.unsafe("RESET ROLE"); } catch {}
          await roleSql.end({ timeout: 5 });
        }
      }
    } finally {
      await sqlClient.unsafe(
        `REVOKE SELECT, INSERT, UPDATE, DELETE ON ${realityTables.join(", ")} FROM authenticated, anon`,
      );
    }
  });
});
