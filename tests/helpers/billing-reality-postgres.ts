import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { attestRawSecretScanV1, buildRawStorageBindingAtDurableBoundaryV1, defineRawCapturePolicyV1, prepareRawCaptureV1 } from "@/lib/trader/mi/raw-capture-v1";
import { persistPreparedRawCaptureV1Postgres } from "@/lib/trader/mi/raw-capture-repository-postgres";
import { ingestRealitySourceReportV2Postgres } from "@/lib/trader/reality/v2/ingest-postgres";
import type { RealityPrimitiveAssertionV2 } from "@/lib/trader/reality/v2/contracts";
import type { AppendRealitySourceReportV2Input, RealityAccountContext } from "@/lib/trader/reality/v2/repository-postgres";
import { listTruthRecordsV2, readLatestRealityProjectionV2 } from "@/lib/trader/reality/v2/repository-postgres";
import { billingEvidenceAtProjection, billingFixturePrimitives, billingFixtureSource, type BillingRealityFixtureInput } from "./billing-reality-evidence";

/** Synthetic native storage fixture: real source admission/lineage/append-only
 * writer guards. It makes no venue, economic attribution or finality claim. */
export async function prepareBillingRealitySourceFixture(db: WaiaPostgresDb, scope: RealityAccountContext,
  primitive: RealityPrimitiveAssertionV2, overrides: Partial<AppendRealitySourceReportV2Input> = {}) {
  const sourceId = randomUUID();
  await db.execute(sql`INSERT INTO trader_mi_source (id,organization_id,venue,feed_kind,status,symbol)
    VALUES(${sourceId}::uuid,${scope.organizationId}::uuid,'HTX','raw-foundation','active',${sourceId})`);
  await db.execute(sql`INSERT INTO trader_reality_raw_source_admissions_v2
    (organization_id,account_id,capture_source_id,reality_source_kind,provider,feed_class,transport)
    VALUES(${scope.organizationId}::uuid,${scope.accountId},${sourceId}::uuid,'HTX_SPOT_FILL_REST','HTX','raw-foundation','REST')`);
  const label = randomUUID();
  const bodyBytes = new TextEncoder().encode(JSON.stringify({ syntheticOnly: true, primitive, label }));
  const prepared = prepareRawCaptureV1({ organizationId: scope.organizationId, sourceId, bodyBytes,
    policy: defineRawCapturePolicyV1({ maxPayloadBytes: 2048, retentionSeconds: 3600 }),
    secretScanReceipt: attestRawSecretScanV1({ status: "PASS", bodyBytes, scannerId: "dee1120-fixture", scannerVersion: "v1",
      completedAt: new Date(Date.now() - 10000) }) });
  const storageBinding = buildRawStorageBindingAtDurableBoundaryV1({ organizationId: scope.organizationId, sourceId,
    rawBytesDigest: prepared.rawBytesDigest, objectReference: { storageBackendId: "synthetic-encrypted-test-store", objectKey: `dee1120/${label}`,
      objectVersion: "1", encryptionRequirement: "PRIVATE_ENCRYPTED", accessRequirement: "SERVER_ONLY" }, storedAt: new Date(Date.now() - 5000) });
  const { receipt } = await persistPreparedRawCaptureV1Postgres(db, { organizationId: scope.organizationId }, { prepared, storageBinding });
  return { ...billingFixtureSource(primitive, label, {
    lineageKind: "RAW_CAPTURE_V1", rawCaptureSourceId: receipt.sourceId, rawCaptureReceiptDigestHex: receipt.contentDigest,
    rawBytesDigestHex: receipt.rawBytesDigest, storageBindingDigestHex: receipt.storageBindingDigest }), ...overrides };
}
export async function persistBillingRealitySourceFixture(db: WaiaPostgresDb, scope: RealityAccountContext,
  primitive: RealityPrimitiveAssertionV2, overrides: Partial<AppendRealitySourceReportV2Input> = {}) {
  return ingestRealitySourceReportV2Postgres(db, scope, await prepareBillingRealitySourceFixture(db, scope, primitive, overrides));
}
export async function persistBillingRealityFixture(db: WaiaPostgresDb, input: BillingRealityFixtureInput) {
  const scope = { organizationId: input.organizationId, accountId: input.accountId };
  const admitted = [];
  for (const primitive of billingFixturePrimitives(input.realizedPnl)) {
    admitted.push(await persistBillingRealitySourceFixture(db, scope, primitive));
  }
  const projection = await readLatestRealityProjectionV2(db, scope);
  if (!projection) throw new Error("synthetic native projection missing");
  const selected = new Set(admitted.map((row) => row.truthRecord?.truthRecordId));
  const truths = (await listTruthRecordsV2(db, scope)).filter((t) => selected.has(t.truthRecordId));
  return billingEvidenceAtProjection(input, projection, truths);
}
