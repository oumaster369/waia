import { createHash } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
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
  appendContradictoryRealityTruthV2FromWriter,
  appendObservedRealityTruthV2FromWriter,
  appendReleasedRealityQuarantineV2FromWriter,
  appendRealitySourceObservationV2FromWriter,
  appendRealitySourceReportV2Postgres,
  appendSupersededRealityTruthV2FromWriter,
  appendUnverifiableRealityQuarantineV2FromWriter,
  listRealityEventsV2,
  listRealitySourceReportsV2,
  listTruthRecordsV2,
  persistCanonicalRealityProjectionV2FromWriter,
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
const SOURCE_PUBLIC = "00000000-0000-4000-8000-000000067713";
const SOURCE_OTHER_ACCOUNT = "00000000-0000-4000-8000-000000067714";
const ACCOUNT = "htx-spot-reality-b";
const OTHER_ACCOUNT = "htx-spot-reality-other";
const FRONTIER_SERVICE_ROLE = "reality_v2_frontier_test_service";
const realityLedgerTables = [
  "trader_reality_source_reports_v2",
  "trader_reality_truth_records_v2",
  "trader_reality_events_v2",
  "trader_reality_projections_v2",
] as const;
const realityProtectedTables = [
  "trader_reality_raw_source_admissions_v2",
  "trader_reality_knowledge_frontiers_v2",
] as const;
const realityTables = [...realityLedgerTables, ...realityProtectedTables] as const;
const realityAppendOnlyTables = [
  ...realityLedgerTables,
  "trader_reality_raw_source_admissions_v2",
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
  for (const table of [...realityAppendOnlyTables, ...rawTables]) {
    await sqlClient.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
  }
  try {
    for (const table of [...realityLedgerTables].reverse()) {
      await sqlClient.unsafe(`DELETE FROM ${table} WHERE organization_id = $1::uuid`, [organizationId]);
    }
    await sqlClient.unsafe(
      "DELETE FROM trader_reality_knowledge_frontiers_v2 WHERE organization_id = $1::uuid",
      [organizationId],
    );
    await sqlClient.unsafe(
      "DELETE FROM trader_reality_raw_source_admissions_v2 WHERE organization_id = $1::uuid",
      [organizationId],
    );
    for (const table of rawTables) {
      await sqlClient.unsafe(`DELETE FROM ${table} WHERE organization_id = $1::uuid`, [organizationId]);
    }
    await sqlClient.unsafe("DELETE FROM trader_mi_source WHERE organization_id = $1::uuid", [organizationId]);
  } finally {
    for (const table of [...realityAppendOnlyTables, ...rawTables].reverse()) {
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
      rawCaptureSourceId: receipt.sourceId,
      rawCaptureReceiptDigestHex: receipt.contentDigest,
      rawBytesDigestHex: receipt.rawBytesDigest,
      storageBindingDigestHex: receipt.storageBindingDigest,
    },
    provenance: {
      venue: "HTX" as const,
      transport: "REST" as const,
      connectorId: "htx-exchange-connector",
      connectorVersion: "test-v1",
      adapterVersion: "reality-htx-spot-v1",
      sourceFinalityMetadata: [] as const,
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
    await sqlClient.unsafe(`DO $role$
      BEGIN
        CREATE ROLE ${FRONTIER_SERVICE_ROLE} NOLOGIN BYPASSRLS;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END
    $role$`);
  }, 120_000);

  beforeEach(async () => {
    await clearOrg(sqlClient, orgA);
    await clearOrg(sqlClient, orgB);
    await sqlClient`INSERT INTO trader_mi_source (
      id, organization_id, venue, feed_kind, symbol, status
    ) VALUES (
      ${SOURCE_A}::uuid, ${orgA}::uuid, 'HTX', 'raw-foundation', 'reality-account-a', 'active'
    )`;
    await sqlClient`INSERT INTO trader_mi_source (
      id, organization_id, venue, feed_kind, symbol, status
    ) VALUES (
      ${SOURCE_B}::uuid, ${orgB}::uuid, 'HTX', 'raw-foundation', 'reality-account-b', 'active'
    )`;
    await sqlClient`INSERT INTO trader_mi_source (id, organization_id, venue, feed_kind, status)
      VALUES (${SOURCE_PUBLIC}::uuid, ${orgA}::uuid, 'HTX', 'spot_ohlcv', 'active')`;
    await sqlClient`INSERT INTO trader_mi_source (
      id, organization_id, venue, feed_kind, symbol, status
    ) VALUES (
      ${SOURCE_OTHER_ACCOUNT}::uuid, ${orgA}::uuid, 'HTX', 'raw-foundation',
      'reality-account-other', 'active'
    )`;
    await sqlClient`INSERT INTO trader_reality_raw_source_admissions_v2 (
      organization_id, account_id, capture_source_id, reality_source_kind,
      provider, feed_class, transport
    ) VALUES
      (${orgA}::uuid, ${ACCOUNT}, ${SOURCE_A}::uuid, 'HTX_SPOT_FILL_REST',
        'HTX', 'raw-foundation', 'REST'),
      (${orgA}::uuid, ${OTHER_ACCOUNT}, ${SOURCE_OTHER_ACCOUNT}::uuid, 'HTX_SPOT_FILL_REST',
        'HTX', 'raw-foundation', 'REST'),
      (${orgB}::uuid, ${ACCOUNT}, ${SOURCE_B}::uuid, 'HTX_SPOT_FILL_REST',
        'HTX', 'raw-foundation', 'REST')`;
  });

  afterAll(async () => {
    if (sqlClient) {
      await clearOrg(sqlClient, orgA);
      await clearOrg(sqlClient, orgB);
      await sqlClient.unsafe(`DROP ROLE IF EXISTS ${FRONTIER_SERVICE_ROLE}`);
      await sqlClient.end({ timeout: 10 });
    }
    await cleanupWp13Org(url!, USER_A);
    await cleanupWp13Org(url!, USER_B);
  });

  it("rejects blank account scopes at direct-SQL table and allocator boundaries", async () => {
    await expect(sqlClient`
      SELECT * FROM public.waia_reality_v2_allocate_knowledge_at(
        ${orgA}::uuid, ${"   "}::text
      )
    `).rejects.toThrow(/nonblank account scope/);
    await expect(sqlClient`
      INSERT INTO trader_reality_knowledge_frontiers_v2 (organization_id, account_id)
      VALUES (${orgA}::uuid, ${"\t"})
    `).rejects.toThrow(/account_id|check constraint/);
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

    await expect(sqlClient`
      UPDATE trader_mi_source SET feed_kind = 'spot_ohlcv'
      WHERE id = ${SOURCE_A}::uuid AND organization_id = ${orgA}::uuid
    `).rejects.toThrow(/capture-source identity is immutable/);
    await expect(sqlClient.begin(async (transaction) => {
      await transaction`
        UPDATE trader_mi_source SET status = 'deprecated'
        WHERE id = ${SOURCE_A}::uuid AND organization_id = ${orgA}::uuid
      `;
      await transaction`
        UPDATE trader_mi_source SET status = 'active'
        WHERE id = ${SOURCE_A}::uuid AND organization_id = ${orgA}::uuid
      `;
    })).rejects.toThrow(/cannot be reactivated/);

    const publicRaw = await capture(db, orgA, SOURCE_PUBLIC, "public-source-class");
    const crossOrgRaw = await capture(db, orgB, SOURCE_B, "cross-org-source");
    const crossAccountRaw = await capture(
      db,
      orgA,
      SOURCE_OTHER_ACCOUNT,
      "same-org-cross-account-source",
    );
    await expect(appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(publicRaw.receipt, "public", null),
    )).rejects.toThrow(/not bound to the admitted HTX private REST source class/);
    await expect(appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(crossAccountRaw.receipt, "cross-account", null),
    )).rejects.toThrow(/not bound to the admitted HTX private REST source class/);
    await expect(appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(crossOrgRaw.receipt, "cross-org", null),
    )).rejects.toThrow(/not bound to the admitted HTX private REST source class/);
    await expect(appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      {
        ...input,
        lineage: {
          ...input.lineage,
          rawCaptureReceiptDigestHex: hex64("guessed-receipt"),
        },
      },
    )).rejects.toThrow(/not bound to the admitted HTX private REST source class/);

    const directRelabelId = hex64("direct-cross-account-source-relabel");
    await expect(sqlClient.begin(async (transaction) => {
      const reserved = await transaction<{ reservation_id: string; knowledge_at: string }[]>`
        SELECT reservation_id::text, knowledge_at
        FROM public.waia_reality_v2_allocate_knowledge_at(
          ${orgA}::uuid, ${ACCOUNT}::text
        )
      `;
      await transaction`
        INSERT INTO trader_reality_source_reports_v2 (
          id, organization_id, account_id, source_kind, source_native_identity_kind,
          source_native_id, source_native_revision, supersedes_native_revision,
          attribution_status, subject_class, subject_key, primitive_assertion, lineage_kind,
          execution_report_id, execution_report_digest, raw_capture_source_id,
          raw_capture_receipt_digest,
          raw_bytes_digest, storage_binding_digest, provenance, structural_verification,
          verification_reason_codes, valid_at, knowledge_at, knowledge_reservation_id,
          content_digest, schema_version
        )
        SELECT
          ${directRelabelId}, organization_id, account_id, source_kind,
          source_native_identity_kind, source_native_id || '-cross-account-relabel',
          source_native_revision, supersedes_native_revision, attribution_status,
          subject_class, subject_key || '-cross-account-relabel', primitive_assertion, lineage_kind,
          execution_report_id, execution_report_digest, ${crossAccountRaw.receipt.sourceId}::uuid,
          ${crossAccountRaw.receipt.contentDigest},
          ${crossAccountRaw.receipt.rawBytesDigest},
          ${crossAccountRaw.receipt.storageBindingDigest}, provenance,
          structural_verification, verification_reason_codes, valid_at,
          ${new Date(reserved[0]!.knowledge_at).toISOString()},
          ${reserved[0]!.reservation_id}::uuid, ${directRelabelId}, schema_version
        FROM trader_reality_source_reports_v2 WHERE id = ${stored.report.sourceReportId}
      `;
    })).rejects.toThrow(/registered private REST source class/);

    for (const [caseName, provenance] of [
      ["raw-secret", {
        ...stored.report.provenance,
        sourceFinalityMetadata: [{ key: "details", value: "Bearer secret raw body" }],
      }],
      ["oversized", {
        ...stored.report.provenance,
        connectorVersion: "x".repeat(129),
      }],
      ["opaque-json", {
        ...stored.report.provenance,
        sourceFinalityMetadata: [{ key: "reportSequence", value: { rawBody: "secret" } }],
      }],
    ] as const) {
      const rejectedId = hex64(`direct-sql-${caseName}`);
      await expect(sqlClient.begin(async (transaction) => {
        const reserved = await transaction<{ reservation_id: string; knowledge_at: string }[]>`
          SELECT reservation_id::text, knowledge_at
          FROM public.waia_reality_v2_allocate_knowledge_at(
            ${orgA}::uuid, ${ACCOUNT}::text
          )
        `;
        await transaction`
          INSERT INTO trader_reality_source_reports_v2 (
            id, organization_id, account_id, source_kind, source_native_identity_kind,
            source_native_id, source_native_revision, supersedes_native_revision,
            attribution_status, subject_class, subject_key, primitive_assertion, lineage_kind,
            execution_report_id, execution_report_digest, raw_capture_source_id,
            raw_capture_receipt_digest,
            raw_bytes_digest, storage_binding_digest, provenance, structural_verification,
            verification_reason_codes, valid_at, knowledge_at, knowledge_reservation_id,
            content_digest, schema_version
          )
          SELECT
            ${rejectedId}, organization_id, account_id, source_kind,
            source_native_identity_kind, source_native_id || ${`-${caseName}`},
            source_native_revision, supersedes_native_revision, attribution_status,
            subject_class, subject_key || ${`-${caseName}`}, primitive_assertion, lineage_kind,
            execution_report_id, execution_report_digest, raw_capture_source_id,
            raw_capture_receipt_digest,
            raw_bytes_digest, storage_binding_digest, ${JSON.stringify(provenance)}::jsonb,
            structural_verification, verification_reason_codes, valid_at,
            ${new Date(reserved[0]!.knowledge_at).toISOString()},
            ${reserved[0]!.reservation_id}::uuid, ${rejectedId}, schema_version
          FROM trader_reality_source_reports_v2 WHERE id = ${stored.report.sourceReportId}
        `;
      })).rejects.toThrow(/provenance|check constraint/);
    }

    const truth = await runWaiaPostgresTransaction(db, (tx) =>
      appendObservedRealityTruthV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        stored.report,
      ));
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

  it("accepts only exact intent writes and rejects forged events/projections", async () => {
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
    const baseTruth = await runWaiaPostgresTransaction(db, (tx) =>
      appendObservedRealityTruthV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        baseSource,
      ));
    const correctedTruth = await runWaiaPostgresTransaction(db, (tx) =>
      appendSupersededRealityTruthV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        correctedSource,
        baseTruth,
      ));
    const events = await listRealityEventsV2(db, { organizationId: orgA, accountId: ACCOUNT });
    expect(events.map((event) => event.eventSequence)).toEqual(["1", "2"]);
    expect(events.map((event) => event.eventType)).toEqual(["OBSERVED", "SUPERSEDED"]);
    expect(events[1]!.previousEventDigestHex).toBe(events[0]!.contentDigestHex);
    expect(new Date(events[1]!.knowledgeAtUtc).getTime())
      .toBeGreaterThan(new Date(events[0]!.knowledgeAtUtc).getTime());

    const stale = createRealityEventV2({
      organizationId: orgA,
      accountId: ACCOUNT,
      eventSequence: "1",
      eventType: "OBSERVED",
      sourceReportId: baseSource.sourceReportId,
      truthRecordId: baseTruth.truthRecordId,
      relatedTruthRecordId: null,
      quarantineEventId: null,
      reasonCodes: [],
      knowledgeAtUtc: new Date().toISOString(),
      previousEventDigestHex: null,
    });
    await expect(sqlClient`
      INSERT INTO trader_reality_events_v2 (
        id, organization_id, account_id, event_sequence, event_type, source_report_id,
        truth_record_id, related_truth_record_id, quarantine_event_id, reason_codes, knowledge_at,
        knowledge_reservation_id, previous_event_digest, content_digest, schema_version
      ) VALUES (
        ${stale.realityEventId}, ${orgA}::uuid, ${ACCOUNT}, 1, 'OBSERVED',
        ${baseSource.sourceReportId}, ${baseTruth.truthRecordId}, NULL, NULL, '[]'::jsonb,
        ${stale.knowledgeAtUtc}, ${SOURCE_A}::uuid, NULL,
        ${stale.contentDigestHex}, ${stale.schemaVersion}
      )
    `).rejects.toThrow(/sequence\/digest head mismatch/);

    const head = events[1]!;
    const forgedProjection = createRealityProjectionV2({
      organizationId: orgA,
      accountId: ACCOUNT,
      knowledgeAsOfUtc: head.knowledgeAtUtc,
      frontierSequence: head.eventSequence,
      frontierEventDigestHex: head.contentDigestHex,
      stableEntries: [{
        subject: baseTruth.subject,
        truthRecordId: baseTruth.truthRecordId,
        sourceReportId: baseTruth.sourceReportId,
        validAtUtc: baseTruth.validAtUtc,
        knowledgeAtUtc: baseTruth.knowledgeAtUtc,
        primitiveAssertion: baseTruth.primitiveAssertion,
      }],
      uncertainties: [],
    });
    await expect(runWaiaPostgresTransaction(db, (tx) =>
      persistCanonicalRealityProjectionV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        forgedProjection,
      ))).rejects.toThrow(/not exactly equal to the canonical Reality ledger fold/);
    const projection = await runWaiaPostgresTransaction(db, (tx) =>
      persistCanonicalRealityProjectionV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
      ));
    expect(projection?.stableEntries[0]?.truthRecordId).toBe(correctedTruth.truthRecordId);
    expect(await readLatestRealityProjectionV2(db, { organizationId: orgA, accountId: ACCOUNT }))
      .toEqual(projection);
    expect(await readLatestRealityProjectionV2(db, { organizationId: orgB, accountId: ACCOUNT }))
      .toBeNull();

    const attemptInvalidEvent = async (
      eventType: "OBSERVED" | "SUPERSEDED",
      sourceReportId: string,
      truthRecordId: string,
      relatedTruthRecordId: string | null,
    ) => sqlClient.begin(async (transaction) => {
      const reserved = await transaction<{ reservation_id: string; knowledge_at: string }[]>`
        SELECT reservation_id::text, knowledge_at
        FROM public.waia_reality_v2_allocate_knowledge_at(
          ${orgA}::uuid, ${ACCOUNT}::text
        )
      `;
      const event = createRealityEventV2({
        organizationId: orgA,
        accountId: ACCOUNT,
        eventSequence: "3",
        eventType,
        sourceReportId,
        truthRecordId,
        relatedTruthRecordId,
        quarantineEventId: null,
        reasonCodes: eventType === "SUPERSEDED" ? ["SOURCE_NATIVE_CORRECTION"] : [],
        knowledgeAtUtc: new Date(reserved[0]!.knowledge_at).toISOString(),
        previousEventDigestHex: head.contentDigestHex,
      });
      await transaction`
        INSERT INTO trader_reality_events_v2 (
          id, organization_id, account_id, event_sequence, event_type, source_report_id,
          truth_record_id, related_truth_record_id, quarantine_event_id, reason_codes, knowledge_at,
          knowledge_reservation_id, previous_event_digest, content_digest, schema_version
        ) VALUES (
          ${event.realityEventId}, ${orgA}::uuid, ${ACCOUNT}, ${event.eventSequence}::bigint,
          ${event.eventType}, ${event.sourceReportId}, ${event.truthRecordId},
          ${event.relatedTruthRecordId}, NULL, ${JSON.stringify(event.reasonCodes)}::jsonb,
          ${event.knowledgeAtUtc}, ${reserved[0]!.reservation_id}::uuid,
          ${event.previousEventDigestHex},
          ${event.contentDigestHex}, ${event.schemaVersion}
        )
      `;
    });
    await expect(attemptInvalidEvent(
      "OBSERVED",
      correctedSource.sourceReportId,
      correctedTruth.truthRecordId,
      null,
    )).rejects.toThrow(/OBSERVED must introduce exactly one unsuperseding stable truth/);
    await expect(attemptInvalidEvent(
      "SUPERSEDED",
      baseSource.sourceReportId,
      baseTruth.truthRecordId,
      correctedTruth.truthRecordId,
    )).rejects.toThrow(/SUPERSEDED must exactly link/);
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
    const contradictionEvent = (await listRealityEventsV2(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
    )).find((event) =>
      event.eventType === "SOURCE_CONTRADICTION" &&
      event.sourceReportId === disputed.sourceReport.sourceReportId
    );
    expect(contradictionEvent).toBeDefined();

    const contradictionAsOf = disputed.projection!.knowledgeAsOfUtc;
    const replayedContradiction = await replayRealityProjectionV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      contradictionAsOf,
    );
    expect(replayedContradiction).toEqual(disputed.projection);

    await expect(runWaiaPostgresTransaction(db, (tx) =>
      appendReleasedRealityQuarantineV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        disputed.sourceReport,
        base.truthRecord!,
      ))).rejects.toThrow(/exact unresolved causally linked quarantine/);

    const unrelatedRaw = await capture(db, orgA, SOURCE_A, "release-unrelated-subject");
    const unrelatedBase = fillInput(unrelatedRaw.receipt, "unrelated", null);
    const unrelated = await ingestRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      {
        ...unrelatedBase,
        sourceNativeIdentity: {
          ...unrelatedBase.sourceNativeIdentity,
          nativeId: "htx-trade-reality-unrelated",
        },
        subject: {
          subjectClass: "FILL" as const,
          subjectKey: "HTX:spot:htx-trade-reality-unrelated",
        },
        primitiveAssertion: {
          ...unrelatedBase.primitiveAssertion,
          venueTradeId: "htx-trade-reality-unrelated",
        },
      },
    );
    expect(unrelated.classification).toBe("NEW_FACT");

    const attemptDirectRelease = async (input: Readonly<{
      organizationId: string;
      sourceReportId: string;
      truthRecordId: string;
      relatedTruthRecordId: string | null;
      quarantineEventId: string;
      seed: string;
    }>) => sqlClient.begin(async (transaction) => {
      const headRows = await transaction<{
        event_sequence: string;
        content_digest: string;
      }[]>`
        SELECT event_sequence::text, content_digest
        FROM trader_reality_events_v2
        WHERE organization_id = ${input.organizationId}::uuid AND account_id = ${ACCOUNT}
        ORDER BY event_sequence DESC LIMIT 1
      `;
      const reserved = await transaction<{ reservation_id: string; knowledge_at: string }[]>`
        SELECT reservation_id::text, knowledge_at
        FROM public.waia_reality_v2_allocate_knowledge_at(
          ${input.organizationId}::uuid, ${ACCOUNT}::text
        )
      `;
      const headRow = headRows[0];
      const event = createRealityEventV2({
        organizationId: input.organizationId,
        accountId: ACCOUNT,
        eventSequence: headRow ? (BigInt(headRow.event_sequence) + 1n).toString() : "1",
        eventType: "RELEASED",
        sourceReportId: input.sourceReportId,
        truthRecordId: input.truthRecordId,
        relatedTruthRecordId: input.relatedTruthRecordId,
        quarantineEventId: input.quarantineEventId,
        reasonCodes: [
          "QUARANTINE_RESOLVED_WITHOUT_PROMOTION",
          input.seed.toUpperCase().replaceAll("-", "_"),
        ].sort(),
        knowledgeAtUtc: new Date(reserved[0]!.knowledge_at).toISOString(),
        previousEventDigestHex: headRow?.content_digest ?? null,
      });
      await transaction`
        INSERT INTO trader_reality_events_v2 (
          id, organization_id, account_id, event_sequence, event_type, source_report_id,
          truth_record_id, related_truth_record_id, quarantine_event_id, reason_codes, knowledge_at,
          knowledge_reservation_id, previous_event_digest, content_digest, schema_version
        ) VALUES (
          ${event.realityEventId}, ${event.organizationId}::uuid, ${event.accountId},
          ${event.eventSequence}::bigint, ${event.eventType}, ${event.sourceReportId},
          ${event.truthRecordId}, ${event.relatedTruthRecordId}, ${event.quarantineEventId},
          ${JSON.stringify(event.reasonCodes)}::jsonb, ${event.knowledgeAtUtc},
          ${reserved[0]!.reservation_id}::uuid, ${event.previousEventDigestHex},
          ${event.contentDigestHex}, ${event.schemaVersion}
        )
      `;
    });

    const attemptDirectQuarantine = async (
      eventType: "QUARANTINED" | "SOURCE_CONTRADICTION",
      relatedTruthRecordId: string | null,
      seed: string,
    ) => sqlClient.begin(async (transaction) => {
      const headRows = await transaction<{
        event_sequence: string;
        content_digest: string;
      }[]>`
        SELECT event_sequence::text, content_digest
        FROM trader_reality_events_v2
        WHERE organization_id = ${orgA}::uuid AND account_id = ${ACCOUNT}
        ORDER BY event_sequence DESC LIMIT 1
      `;
      const reserved = await transaction<{ reservation_id: string; knowledge_at: string }[]>`
        SELECT reservation_id::text, knowledge_at
        FROM public.waia_reality_v2_allocate_knowledge_at(${orgA}::uuid, ${ACCOUNT}::text)
      `;
      const headRow = headRows[0]!;
      const event = createRealityEventV2({
        organizationId: orgA,
        accountId: ACCOUNT,
        eventSequence: (BigInt(headRow.event_sequence) + 1n).toString(),
        eventType,
        sourceReportId: disputed.sourceReport.sourceReportId,
        truthRecordId: disputed.truthRecord!.truthRecordId,
        relatedTruthRecordId,
        quarantineEventId: null,
        reasonCodes: [seed.toUpperCase().replaceAll("-", "_")],
        knowledgeAtUtc: new Date(reserved[0]!.knowledge_at).toISOString(),
        previousEventDigestHex: headRow.content_digest,
      });
      await transaction`
        INSERT INTO trader_reality_events_v2 (
          id, organization_id, account_id, event_sequence, event_type, source_report_id,
          truth_record_id, related_truth_record_id, quarantine_event_id, reason_codes,
          knowledge_at, knowledge_reservation_id, previous_event_digest, content_digest,
          schema_version
        ) VALUES (
          ${event.realityEventId}, ${orgA}::uuid, ${ACCOUNT}, ${event.eventSequence}::bigint,
          ${event.eventType}, ${event.sourceReportId}, ${event.truthRecordId},
          ${event.relatedTruthRecordId}, NULL, ${JSON.stringify(event.reasonCodes)}::jsonb,
          ${event.knowledgeAtUtc}, ${reserved[0]!.reservation_id}::uuid,
          ${event.previousEventDigestHex}, ${event.contentDigestHex}, ${event.schemaVersion}
        )
      `;
    });

    await expect(attemptDirectQuarantine(
      "QUARANTINED",
      null,
      "forged-intervening-quarantine",
    )).rejects.toThrow(/already has an unresolved quarantine/);
    await expect(attemptDirectQuarantine(
      "SOURCE_CONTRADICTION",
      base.truthRecord!.truthRecordId,
      "double-unresolved",
    )).rejects.toThrow(/already has an unresolved quarantine/);

    await expect(attemptDirectRelease({
      organizationId: orgA,
      sourceReportId: disputed.sourceReport.sourceReportId,
      truthRecordId: base.truthRecord!.truthRecordId,
      relatedTruthRecordId: null,
      quarantineEventId: contradictionEvent!.realityEventId,
      seed: "unrelated-truth",
    })).rejects.toThrow(/RELEASED must exactly resolve/);
    await expect(attemptDirectRelease({
      organizationId: orgA,
      sourceReportId: disputed.sourceReport.sourceReportId,
      truthRecordId: disputed.truthRecord!.truthRecordId,
      relatedTruthRecordId: unrelated.truthRecord!.truthRecordId,
      quarantineEventId: contradictionEvent!.realityEventId,
      seed: "cross-subject",
    })).rejects.toThrow(/RELEASED must exactly resolve/);
    await expect(attemptDirectRelease({
      organizationId: orgA,
      sourceReportId: base.sourceReport.sourceReportId,
      truthRecordId: disputed.truthRecord!.truthRecordId,
      relatedTruthRecordId: base.truthRecord!.truthRecordId,
      quarantineEventId: contradictionEvent!.realityEventId,
      seed: "cross-source",
    })).rejects.toThrow(/RELEASED must exactly resolve/);
    await expect(attemptDirectRelease({
      organizationId: orgB,
      sourceReportId: disputed.sourceReport.sourceReportId,
      truthRecordId: disputed.truthRecord!.truthRecordId,
      relatedTruthRecordId: base.truthRecord!.truthRecordId,
      quarantineEventId: contradictionEvent!.realityEventId,
      seed: "cross-org",
    })).rejects.toThrow(/RELEASED must exactly resolve|foreign key/);

    const released = await releaseRealityQuarantineV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      disputed.sourceReport.sourceReportId,
    );
    expect(released.stableEntries[0]?.truthRecordId).toBe(base.truthRecord?.truthRecordId);
    expect(released.uncertainties).toEqual([]);
    await expect(attemptDirectRelease({
      organizationId: orgA,
      sourceReportId: disputed.sourceReport.sourceReportId,
      truthRecordId: disputed.truthRecord!.truthRecordId,
      relatedTruthRecordId: base.truthRecord!.truthRecordId,
      quarantineEventId: contradictionEvent!.realityEventId,
      seed: "double-release",
    })).rejects.toThrow(/exactly resolve|one_release_per_quarantine|duplicate key/);

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

    await expect(runWaiaPostgresTransaction(db, (tx) =>
      appendContradictoryRealityTruthV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        disputed.sourceReport,
        base.truthRecord!,
        ["SOURCE_ASSERTION_CONTRADICTION"],
      ))).rejects.toThrow(/exact current stable truth/);
    await expect(attemptDirectQuarantine(
      "SOURCE_CONTRADICTION",
      base.truthRecord!.truthRecordId,
      "superseded-stable-target",
    )).rejects.toThrow(/current stable truth/);

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

  it("preserves a missing correction target as a source-only quarantine and replays it exactly", async () => {
    const siblingRaw = await capture(db, orgA, SOURCE_A, "missing-correction-sibling");
    const siblingDraft = fillInput(siblingRaw.receipt, "missing-revision", null);
    const sibling = await ingestRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      {
        ...siblingDraft,
        sourceNativeIdentity: {
          ...siblingDraft.sourceNativeIdentity,
          nativeId: "htx-trade-reality-missing-sibling",
        },
        subject: {
          subjectClass: "FILL" as const,
          subjectKey: "HTX:spot:htx-trade-reality-missing-sibling",
        },
        primitiveAssertion: {
          ...siblingDraft.primitiveAssertion,
          venueTradeId: "htx-trade-reality-missing-sibling",
        },
      },
    );
    expect(sibling.classification).toBe("NEW_FACT");

    const raw = await capture(db, orgA, SOURCE_A, "missing-correction-target");
    const result = await ingestRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(raw.receipt, "2", "missing-revision"),
    );

    expect(result.classification).toBe("QUARANTINED");
    expect(result.truthRecord).toBeNull();
    expect(result.projection?.stableEntries.map((entry) => entry.truthRecordId))
      .toEqual([sibling.truthRecord!.truthRecordId]);
    expect(result.projection?.uncertainties).toMatchObject([{
      sourceReportId: result.sourceReport.sourceReportId,
      marker: "SOURCE_CONTRADICTION",
      reasonCodes: ["CORRECTION_TARGET_NOT_FOUND"],
    }]);
    const truths = await listTruthRecordsV2(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
    );
    expect(truths).toHaveLength(1);
    expect(truths.every((truth) => truth.sourceReportId !== result.sourceReport.sourceReportId))
      .toBe(true);
    const events = await listRealityEventsV2(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
    );
    expect(events.at(-1)).toMatchObject({
      eventType: "QUARANTINED",
      sourceReportId: result.sourceReport.sourceReportId,
      truthRecordId: null,
      relatedTruthRecordId: null,
      quarantineEventId: null,
      reasonCodes: ["CORRECTION_TARGET_NOT_FOUND"],
    });
    expect(await replayRealityProjectionV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      result.projection!.knowledgeAsOfUtc,
    )).toEqual(result.projection);
  });

  it("reserves missing-target quarantine for one complete verified correction", async () => {
    const unverifiableRaw = await capture(db, orgA, SOURCE_A, "reserved-reason-unverifiable");
    const unverifiableDraft = fillInput(unverifiableRaw.receipt, "unverifiable", null);
    const unverifiable = await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      {
        ...unverifiableDraft,
        sourceNativeIdentity: null,
        attributionStatus: "UNATTRIBUTED" as const,
        primitiveAssertion: null,
        structuralVerification: "UNVERIFIABLE" as const,
        verificationReasonCodes: ["MISSING_SOURCE_NATIVE_ID"],
      },
    );
    const nonCorrectionRaw = await capture(db, orgA, SOURCE_A, "reserved-reason-non-correction");
    const nonCorrection = await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(nonCorrectionRaw.receipt, "base-only", null),
    );

    const appendRepositoryQuarantine = (
      sourceReport: typeof unverifiable.report,
      reasonCodes: readonly string[],
    ) => runWaiaPostgresTransaction(db, (tx) =>
      appendUnverifiableRealityQuarantineV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        sourceReport,
        reasonCodes,
      ));
    await expect(appendRepositoryQuarantine(
      unverifiable.report,
      ["CORRECTION_TARGET_NOT_FOUND"],
    )).rejects.toThrow(/requires one complete verified correction identity/);
    await expect(appendRepositoryQuarantine(
      nonCorrection.report,
      ["CORRECTION_TARGET_NOT_FOUND"],
    )).rejects.toThrow(/requires one complete verified correction identity/);
    await expect(appendRepositoryQuarantine(
      unverifiable.report,
      ["CORRECTION_TARGET_NOT_FOUND", "MISSING_SOURCE_NATIVE_ID"],
    )).rejects.toThrow(/requires one complete verified correction identity/);

    const appendDirectQuarantine = async (
      sourceReportId: string,
      reasonCodes: readonly string[],
    ) => sqlClient.begin(async (transaction) => {
      const reserved = await transaction<{ reservation_id: string; knowledge_at: string }[]>`
        SELECT reservation_id::text, knowledge_at
        FROM public.waia_reality_v2_allocate_knowledge_at(${orgA}::uuid, ${ACCOUNT}::text)
      `;
      const event = createRealityEventV2({
        organizationId: orgA,
        accountId: ACCOUNT,
        eventSequence: "1",
        eventType: "QUARANTINED",
        sourceReportId,
        truthRecordId: null,
        relatedTruthRecordId: null,
        quarantineEventId: null,
        reasonCodes,
        knowledgeAtUtc: new Date(reserved[0]!.knowledge_at).toISOString(),
        previousEventDigestHex: null,
      });
      await transaction`
        INSERT INTO trader_reality_events_v2 (
          id, organization_id, account_id, event_sequence, event_type, source_report_id,
          truth_record_id, related_truth_record_id, quarantine_event_id, reason_codes,
          knowledge_at, knowledge_reservation_id, previous_event_digest, content_digest,
          schema_version
        ) VALUES (
          ${event.realityEventId}, ${orgA}::uuid, ${ACCOUNT}, ${event.eventSequence}::bigint,
          ${event.eventType}, ${event.sourceReportId}, NULL, NULL, NULL,
          ${JSON.stringify(event.reasonCodes)}::jsonb, ${event.knowledgeAtUtc},
          ${reserved[0]!.reservation_id}::uuid, NULL, ${event.contentDigestHex},
          ${event.schemaVersion}
        )
      `;
    });
    await expect(appendDirectQuarantine(
      unverifiable.report.sourceReportId,
      ["CORRECTION_TARGET_NOT_FOUND"],
    )).rejects.toThrow(/absent correction target/);
    await expect(appendDirectQuarantine(
      nonCorrection.report.sourceReportId,
      ["CORRECTION_TARGET_NOT_FOUND"],
    )).rejects.toThrow(/absent correction target/);
    await expect(appendDirectQuarantine(
      unverifiable.report.sourceReportId,
      ["CORRECTION_TARGET_NOT_FOUND", "MISSING_SOURCE_NATIVE_ID"],
    )).rejects.toThrow(/absent correction target/);
    expect(await listRealityEventsV2(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
    )).toEqual([]);
  });

  it("rejects false missing-target quarantine at repository, SQL, and serialized race boundaries", async () => {
    const baseRaw = await capture(db, orgA, SOURCE_A, "false-missing-base");
    const base = await ingestRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(baseRaw.receipt, "1", null),
    );
    const correctionRaw = await capture(db, orgA, SOURCE_A, "false-missing-correction");
    const correction = await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      fillInput(correctionRaw.receipt, "2", "1"),
    );

    await expect(runWaiaPostgresTransaction(db, (tx) =>
      appendUnverifiableRealityQuarantineV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        correction.report,
        ["CORRECTION_TARGET_NOT_FOUND"],
      ))).rejects.toThrow(/correction target exists in the exact source\/truth identity scope/);

    const appendDirectMissingTarget = async (
      sourceReportId: string,
      previousEventDigestHex: string,
      eventSequence: string,
    ) => sqlClient.begin(async (transaction) => {
      const reserved = await transaction<{ reservation_id: string; knowledge_at: string }[]>`
        SELECT reservation_id::text, knowledge_at
        FROM public.waia_reality_v2_allocate_knowledge_at(${orgA}::uuid, ${ACCOUNT}::text)
      `;
      const event = createRealityEventV2({
        organizationId: orgA,
        accountId: ACCOUNT,
        eventSequence,
        eventType: "QUARANTINED",
        sourceReportId,
        truthRecordId: null,
        relatedTruthRecordId: null,
        quarantineEventId: null,
        reasonCodes: ["CORRECTION_TARGET_NOT_FOUND"],
        knowledgeAtUtc: new Date(reserved[0]!.knowledge_at).toISOString(),
        previousEventDigestHex,
      });
      await transaction`
        INSERT INTO trader_reality_events_v2 (
          id, organization_id, account_id, event_sequence, event_type, source_report_id,
          truth_record_id, related_truth_record_id, quarantine_event_id, reason_codes,
          knowledge_at, knowledge_reservation_id, previous_event_digest, content_digest,
          schema_version
        ) VALUES (
          ${event.realityEventId}, ${orgA}::uuid, ${ACCOUNT}, ${event.eventSequence}::bigint,
          ${event.eventType}, ${event.sourceReportId}, NULL, NULL, NULL,
          ${JSON.stringify(event.reasonCodes)}::jsonb, ${event.knowledgeAtUtc},
          ${reserved[0]!.reservation_id}::uuid, ${event.previousEventDigestHex},
          ${event.contentDigestHex}, ${event.schemaVersion}
        )
      `;
    });
    const baseHead = (await listRealityEventsV2(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
    )).at(-1)!;
    await expect(appendDirectMissingTarget(
      correction.report.sourceReportId,
      baseHead.contentDigestHex,
      "2",
    )).rejects.toThrow(/absent correction target/);
    expect(base.truthRecord).not.toBeNull();

    const raceTargetRaw = await capture(db, orgA, SOURCE_A, "false-missing-race-target");
    const raceTargetDraft = fillInput(raceTargetRaw.receipt, "race-1", null);
    const raceTarget = await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      {
        ...raceTargetDraft,
        sourceNativeIdentity: {
          ...raceTargetDraft.sourceNativeIdentity,
          nativeId: "htx-trade-reality-race",
        },
        subject: { subjectClass: "FILL", subjectKey: "HTX:spot:htx-trade-reality-race" },
        primitiveAssertion: {
          ...raceTargetDraft.primitiveAssertion,
          venueTradeId: "htx-trade-reality-race",
        },
      },
    );
    const raceCorrectionRaw = await capture(db, orgA, SOURCE_A, "false-missing-race-correction");
    const raceCorrectionDraft = fillInput(raceCorrectionRaw.receipt, "race-2", "race-1");
    const raceCorrection = await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      {
        ...raceCorrectionDraft,
        sourceNativeIdentity: {
          ...raceCorrectionDraft.sourceNativeIdentity,
          nativeId: "htx-trade-reality-race",
        },
        subject: { subjectClass: "FILL", subjectKey: "HTX:spot:htx-trade-reality-race" },
        primitiveAssertion: {
          ...raceCorrectionDraft.primitiveAssertion,
          venueTradeId: "htx-trade-reality-race",
        },
      },
    );
    let releaseTarget!: () => void;
    let targetWritten!: () => void;
    const targetIsWritten = new Promise<void>((resolve) => { targetWritten = resolve; });
    const targetMayCommit = new Promise<void>((resolve) => { releaseTarget = resolve; });
    const targetTransaction = runWaiaPostgresTransaction(db, async (tx) => {
      const truth = await appendObservedRealityTruthV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        raceTarget.report,
      );
      targetWritten();
      await targetMayCommit;
      return truth;
    });
    await targetIsWritten;
    let quarantineStarted!: () => void;
    const quarantineIsStarted = new Promise<void>((resolve) => { quarantineStarted = resolve; });
    const quarantineTransaction = runWaiaPostgresTransaction(db, async (tx) => {
      quarantineStarted();
      return appendUnverifiableRealityQuarantineV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        raceCorrection.report,
        ["CORRECTION_TARGET_NOT_FOUND"],
      );
    });
    await quarantineIsStarted;
    releaseTarget();
    await expect(targetTransaction).resolves.toBeDefined();
    await expect(quarantineTransaction).rejects.toThrow(/correction target exists/);
  });

  it("authors a strict scope frontier after lock despite reversed transaction start order", async () => {
    const olderRaw = await capture(db, orgA, SOURCE_A, "older-transaction");
    const newerRaw = await capture(db, orgA, SOURCE_A, "newer-transaction");
    const olderInput = fillInput(olderRaw.receipt, "10", null);
    const newerInput = {
      ...fillInput(newerRaw.receipt, "20", null),
      sourceNativeIdentity: {
        identityKind: "HTX_TRADE_ID" as const,
        nativeId: "htx-trade-reality-newer",
        nativeRevision: "20",
        supersedesNativeRevision: null,
      },
      subject: {
        subjectClass: "FILL" as const,
        subjectKey: "HTX:spot:htx-trade-reality-newer",
      },
      primitiveAssertion: {
        ...fillInput(newerRaw.receipt, "20", null).primitiveAssertion,
        venueTradeId: "htx-trade-reality-newer",
      },
    };
    let releaseOlder!: () => void;
    let markOlderStarted!: () => void;
    const olderStarted = new Promise<void>((resolve) => { markOlderStarted = resolve; });
    const olderMayProceed = new Promise<void>((resolve) => { releaseOlder = resolve; });
    const olderTransaction = runWaiaPostgresTransaction(db, async (tx) => {
      await tx.execute(sql`SELECT transaction_timestamp()`);
      markOlderStarted();
      await olderMayProceed;
      return appendRealitySourceObservationV2FromWriter(
        tx,
        { organizationId: orgA, accountId: ACCOUNT },
        olderInput,
      );
    });
    await olderStarted;
    const newer = await appendRealitySourceReportV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      newerInput,
    );
    releaseOlder();
    const older = await olderTransaction;
    expect(new Date(older.report.knowledgeAtUtc).getTime())
      .toBeGreaterThan(new Date(newer.report.knowledgeAtUtc).getTime());

    const forgedKnowledgeId = hex64("forged-guc-knowledge-frontier");
    const forgedKnowledgeAt = new Date(Date.now() + 86_400_000).toISOString();
    await expect(sqlClient.begin(async (transaction) => {
      await transaction`SELECT set_config(
        'waia.reality_v2_reserved_scope', ${`${orgA}:${ACCOUNT}`}, true
      )`;
      await transaction`SELECT set_config(
        'waia.reality_v2_reserved_knowledge_at', ${forgedKnowledgeAt}, true
      )`;
      await transaction`
        INSERT INTO trader_reality_source_reports_v2 (
          id, organization_id, account_id, source_kind, source_native_identity_kind,
          source_native_id, source_native_revision, supersedes_native_revision,
          attribution_status, subject_class, subject_key, primitive_assertion, lineage_kind,
          execution_report_id, execution_report_digest, raw_capture_source_id,
          raw_capture_receipt_digest,
          raw_bytes_digest, storage_binding_digest, provenance, structural_verification,
          verification_reason_codes, valid_at, knowledge_at, knowledge_reservation_id,
          content_digest, schema_version
        )
        SELECT
          ${forgedKnowledgeId}, organization_id, account_id, source_kind,
          source_native_identity_kind, source_native_id || '-forged-frontier',
          source_native_revision, supersedes_native_revision, attribution_status,
          subject_class, subject_key || '-forged-frontier', primitive_assertion, lineage_kind,
          execution_report_id, execution_report_digest, raw_capture_source_id,
          raw_capture_receipt_digest,
          raw_bytes_digest, storage_binding_digest, provenance, structural_verification,
          verification_reason_codes, valid_at, ${forgedKnowledgeAt},
          ${SOURCE_A}::uuid, ${forgedKnowledgeId}, schema_version
        FROM trader_reality_source_reports_v2 WHERE id = ${newer.report.sourceReportId}
      `;
    })).rejects.toThrow(/forged, stale, reused, or cross-scope/);

    await expect(sqlClient.begin(async (transaction) => {
      await transaction`
        SELECT * FROM public.waia_reality_v2_allocate_knowledge_at(
          ${orgA}::uuid, ${ACCOUNT}::text
        )
      `;
      await transaction`
        SELECT * FROM public.waia_reality_v2_allocate_knowledge_at(
          ${orgA}::uuid, ${ACCOUNT}::text
        )
      `;
    })).rejects.toThrow(/already owns an unconsumed knowledge reservation/);

    await sqlClient.unsafe(
      `GRANT USAGE ON SCHEMA public TO ${FRONTIER_SERVICE_ROLE}`,
    );
    await sqlClient.unsafe(
      `GRANT EXECUTE ON FUNCTION public.waia_reality_v2_allocate_knowledge_at(uuid, text) ` +
      `TO ${FRONTIER_SERVICE_ROLE}`,
    );
    const serviceSql = postgres(url!, { max: 1 });
    try {
      await serviceSql.unsafe(`SET ROLE ${FRONTIER_SERVICE_ROLE}`);
      await expect(serviceSql`
        SELECT * FROM public.waia_reality_v2_allocate_knowledge_at(
          ${orgA}::uuid, ${ACCOUNT}::text
        )
      `).resolves.toHaveLength(1);
      await expect(serviceSql`
        UPDATE trader_reality_knowledge_frontiers_v2
        SET last_knowledge_at = ${forgedKnowledgeAt}
        WHERE organization_id = ${orgA}::uuid AND account_id = ${ACCOUNT}
      `).rejects.toThrow(/permission denied/);
      await expect(serviceSql`
        SELECT public.waia_reality_v2_consume_knowledge_reservation(
          ${orgA}::uuid, ${ACCOUNT}::text, ${SOURCE_A}::uuid, ${forgedKnowledgeAt}
        )
      `).rejects.toThrow(/permission denied/);
    } finally {
      try { await serviceSql.unsafe("RESET ROLE"); } catch {}
      await serviceSql.end({ timeout: 5 });
      await sqlClient.unsafe(
        `REVOKE EXECUTE ON FUNCTION ` +
        `public.waia_reality_v2_allocate_knowledge_at(uuid, text) ` +
        `FROM ${FRONTIER_SERVICE_ROLE}`,
      );
      await sqlClient.unsafe(`REVOKE USAGE ON SCHEMA public FROM ${FRONTIER_SERVICE_ROLE}`);
    }

    await runWaiaPostgresTransaction(db, (tx) => appendObservedRealityTruthV2FromWriter(
      tx,
      { organizationId: orgA, accountId: ACCOUNT },
      newer.report,
    ));
    await runWaiaPostgresTransaction(db, (tx) => appendObservedRealityTruthV2FromWriter(
      tx,
      { organizationId: orgA, accountId: ACCOUNT },
      older.report,
    ));
    const sources = await listRealitySourceReportsV2(db, {
      organizationId: orgA,
      accountId: ACCOUNT,
    });
    const events = await listRealityEventsV2(db, { organizationId: orgA, accountId: ACCOUNT });
    const frontierTimes = [
      ...sources.map((source) => new Date(source.knowledgeAtUtc).getTime()),
      ...events.map((event) => new Date(event.knowledgeAtUtc).getTime()),
    ].sort((left, right) => left - right);
    expect(new Set(frontierTimes).size).toBe(frontierTimes.length);
    expect(frontierTimes.every((value, index) => index === 0 || value > frontierTimes[index - 1]!))
      .toBe(true);
    const firstAsOf = await replayRealityProjectionV2Postgres(
      db,
      { organizationId: orgA, accountId: ACCOUNT },
      events[0]!.knowledgeAtUtc,
    );
    expect(firstAsOf.frontierSequence).toBe("1");
    expect(firstAsOf.frontierEventDigestHex).toBe(events[0]!.contentDigestHex);
    expect(firstAsOf.stableEntries).toHaveLength(1);
  });

  it("enforces deny RLS for authenticated and anon across real CRUD paths", async () => {
    const metadata = await sqlClient<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${realityTables as unknown as string[]})
      ORDER BY c.relname
    `;
    expect(metadata).toHaveLength(6);
    expect(metadata.every((row) => row.relrowsecurity)).toBe(true);
    const policies = await sqlClient<{
      tablename: string; roles: string[]; cmd: string; qual: string; with_check: string;
    }[]>`
      SELECT tablename, roles, cmd, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(${realityTables as unknown as string[]})
      ORDER BY tablename
    `;
    expect(policies).toHaveLength(6);
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
