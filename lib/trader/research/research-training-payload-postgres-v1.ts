import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import { sql } from "drizzle-orm";
import { z } from "zod";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { parseDecimal } from "@/lib/trader/risk/numeric";
import { assertHtxVolumeAuthorityQualified, HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { resolveAuthoritativeHtxBaseVolumeForCapital } from "@/lib/trader/market-data/volume-qualification/htx-volume-authority-capital-v1";
import { HISTORICAL_SEALED_MARKET_CYCLE_V2_SCHEMA } from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";
import type { Bar } from "@/lib/trader/intelligence/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { assertIngestBarsIntegrityOrThrow } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { FHV_SYMBOL_CODE_TO_INSTRUMENT, resolveFhvCanonicalPartitionInterval } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { assertHistoricalDatasetAuthorityRowV2 } from "@/lib/trader/historical-simulation-v2/production-next-cycle-authority-v2";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";
import { loadResearchTrainingLedgerScopePostgresV1 } from "@/lib/trader/research/research-attempt-registry-postgres-v1";
import { loadRegisteredResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";

/** Operational bounds for this materializing reader, not a research/sample-size
 * or financial policy. The owner must supply explicit smaller/equal budgets.
 * Oversized histories refuse in full; no truncated history can be returned. */
export const RESEARCH_TRAINING_READ_CAPS_V1 = Object.freeze({ maxBars: 1_000_000, maxBytes: 256 * 1024 * 1024 });
const requestSchema = z.object({
  attemptId: z.string().uuid(),
  trialIndex: z.number().int().min(0).max(31),
  limits: z.object({
    maxBars: z.number().int().min(1).max(RESEARCH_TRAINING_READ_CAPS_V1.maxBars),
    maxBytes: z.number().int().min(1).max(RESEARCH_TRAINING_READ_CAPS_V1.maxBytes),
  }).strict(),
}).strict();

type DatasetRow = Parameters<typeof assertHistoricalDatasetAuthorityRowV2>[0];
const BAR_KEYS = Object.freeze([
  "symbol", "interval", "open", "high", "low", "close", "volume", "barOpenTime", "barCloseTime",
] as const satisfies readonly (keyof Bar)[]);

function trainingBarOnly(value: Bar): Readonly<Bar> {
  if (!value || Object.keys(value).length !== BAR_KEYS.length ||
      BAR_KEYS.some(key => !Object.hasOwn(value, key) || typeof value[key] !== "string")) {
    throw new Error("RESEARCH_TRAINING_BAR_FIELDS_INVALID");
  }
  return Object.freeze({ symbol: value.symbol, interval: value.interval,
    open: value.open, high: value.high, low: value.low, close: value.close,
    volume: value.volume, barOpenTime: value.barOpenTime, barCloseTime: value.barCloseTime });
}

/** Closed DEVELOPMENT-only reader of already issued pre-holdout source records.
 * Proposal labels are not data authority: raw market bars and caller-created M9
 * dataset seals cannot supply this path. No source issuer, callback, partition
 * selector, validation or blind capability is accepted. This does not establish
 * current code/PIT/volume eligibility, a lease, a score or scientific admission.
 * Stored seals rely on the trusted historical issuer/DB writer; they are not
 * independent source provenance. Scoring must separately qualify that issuer. */
async function loadRegisteredTrainingPayload(
  db: WaiaPostgresDb, context: OrgContext, supplied: z.infer<typeof requestSchema>,
) {
  assertResearchRootPostgresDbV1(db);
  const captured = Object.freeze({
    organizationId: requireOrgContext(context.organizationId).organizationId.toLowerCase(),
  });
  const request = requestSchema.parse(supplied);
  const scope = await loadResearchTrainingLedgerScopePostgresV1(db, captured, {
    attemptId: request.attemptId, trialIndex: request.trialIndex,
  });
  const sourceRunId = scope.identity.sourceRunId;
  const experiment = await loadRegisteredResearchExperimentPostgresV1(db, captured,
    scope.identity.experimentSpecSha256);
  const partition = experiment.spec.partitions.train;
  if (partition.barCount > request.limits.maxBars) throw new Error("RESEARCH_TRAINING_READ_BAR_LIMIT");
  const development = resolveFhvCanonicalPartitionInterval("development");
  if (partition.firstOpenMs < Date.parse(development.startUtc) ||
      partition.lastCloseMs > Date.parse(development.endUtc)) {
    throw new Error("RESEARCH_TRAINING_DEVELOPMENT_BOUNDARY_REQUIRED");
  }
  const from = new Date(partition.firstOpenMs).toISOString();
  const before = new Date(partition.lastCloseMs).toISOString();

  // Both queries use exactly the same explicit projection and one read-only
  // snapshot. The first transfers only count/bytes, never price/volume bodies.
  // maxBars+1 detects excess without an unbounded application-side row array.
  const query = sql`select jsonb_build_object(
    'id',id::text,'cycle_id',cycle_id,'dataset_authority_digest_hex',dataset_authority_digest_hex,
    'membership_content_digest_hex',membership_content_digest_hex,
    'sealed_cycle_content_digest_hex',sealed_cycle_content_digest_hex,
    'authority_content_digest_hex',authority_content_digest_hex,
    'membership_json',membership_json,'sealed_cycle_json',sealed_cycle_json)::text as packet
    from public.trader_historical_dataset_authority_v2
    where organization_id=${captured.organizationId}::uuid and run_id=${sourceRunId}
      and dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
      and dataset_authority_digest_hex=${experiment.spec.universe.datasetSourceSha256}
      and membership_json->>'partition'='DEVELOPMENT'
      and membership_json->>'symbol'=${experiment.spec.universe.symbol}
      and (sealed_cycle_json->'closedBar'->>'barOpenTime')::timestamptz>=${from}::timestamptz
      and (sealed_cycle_json->'closedBar'->>'barOpenTime')::timestamptz<${before}::timestamptz
    order by (membership_json->>'recordIndex')::integer limit ${request.limits.maxBars + 1}`;
  const payload = await db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout = '30s'`);
    const [metadata] = await tx.execute<{ count: number; bytes: string }>(sql`
      select count(*)::integer as count,coalesce(sum(octet_length(packet)),0)::text as bytes
      from (${query}) as training_payload_metadata`);
    if (!metadata || metadata.count !== partition.barCount) {
      throw new Error("RESEARCH_TRAINING_PAYLOAD_COUNT_MISMATCH");
    }
    const byteCount = Number(metadata.bytes);
    if (!Number.isSafeInteger(byteCount) || byteCount < 1 || byteCount > request.limits.maxBytes) {
      throw new Error("RESEARCH_TRAINING_READ_BYTE_LIMIT");
    }
    const rows = await tx.execute<{ packet: string }>(query);
    if (rows.length !== partition.barCount || rows.reduce((sum, row) =>
      sum + Buffer.byteLength(row.packet, "utf8"), 0) !== byteCount) {
      throw new Error("RESEARCH_TRAINING_PAYLOAD_SNAPSHOT_MISMATCH");
    }
    let firstRecordIndex: number | undefined;
    let partitionSource: string | undefined;
    const cycles: DatasetRow["sealed_cycle_json"][] = [];
    const result = rows.map((row, index) => {
      const payload = JSON.parse(row.packet) as DatasetRow;
      const membership = payload.membership_json;
      if (!Number.isSafeInteger(membership?.recordIndex) || membership.recordIndex < 0) {
        throw new Error("RESEARCH_TRAINING_SOURCE_RECORD_INDEX");
      }
      firstRecordIndex ??= membership.recordIndex;
      const source = JSON.stringify([membership.partitionDigestHex, membership.partitionRawSha256Hex]);
      partitionSource ??= source;
      if (source !== partitionSource) throw new Error("RESEARCH_TRAINING_PARTITION_SOURCE_MISMATCH");
      assertHistoricalDatasetAuthorityRowV2(payload, { organizationId: captured.organizationId,
        runId: sourceRunId, partition: "DEVELOPMENT", symbol: experiment.spec.universe.symbol,
        recordIndex: firstRecordIndex + index, datasetAuthorityDigestHex: experiment.spec.universe.datasetSourceSha256 });
      cycles.push(payload.sealed_cycle_json);
      return trainingBarOnly(payload.sealed_cycle_json.closedBar);
    });
    if (Date.parse(result[0]!.barOpenTime) !== partition.firstOpenMs ||
        Date.parse(result.at(-1)!.barCloseTime) !== partition.lastCloseMs) {
      throw new Error("RESEARCH_TRAINING_PAYLOAD_INTERVAL_MISMATCH");
    }
    const integrity = assertIngestBarsIntegrityOrThrow({ bars: result,
      expectedSymbol: FHV_SYMBOL_CODE_TO_INSTRUMENT[experiment.spec.universe.symbol], expectedInterval: experiment.spec.universe.interval,
      expectedBarSetDigest: partition.contentSha256 });
    if (integrity.gaps.length) throw new Error("RESEARCH_TRAINING_PAYLOAD_GAPPED");
    return { bars: Object.freeze(result), cycles };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });

  return Object.freeze({ authority: "TRAINING_PAYLOAD_INTEGRITY_ONLY" as const,
    source: "PRE_HOLDOUT_DEVELOPMENT_AUTHORITY_V2" as const,
    sourceRunId, datasetAuthorityDigest: experiment.spec.universe.datasetSourceSha256,
    scope, partition, bars: payload.bars, cycles: payload.cycles, experiment });
}

/** Bars-only consumer retains its existing contract; execution-specific source
 * fields are neither exposed nor silently replaced by synthesized metadata. */
export async function loadRegisteredResearchTrainingBarsPostgresV1(
  db: WaiaPostgresDb, context: OrgContext, supplied: z.infer<typeof requestSchema>,
) {
  const { cycles: _cycles, experiment: _experiment, ...result } =
    await loadRegisteredTrainingPayload(db, context, supplied);
  return Object.freeze(result);
}

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const volumeReceiptSchema = z.object({
  schemaVersion: z.literal(HTX_VOLUME_QUALIFICATION_RECEIPT_SCHEMA_VERSION),
  verdict: z.literal("HTX_VOLUME_AUTHORITY_QUALIFIED"),
  authorityField: z.literal("amount"), quoteTurnoverField: z.literal("vol"),
  venue: z.literal("HTX"), marketType: z.literal("SPOT"),
  symbol: z.string().min(1).max(16), interval: z.literal("1m"),
  sampleCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  divergenceCount: z.literal(0), qualifiedAtUtc: z.string().datetime(),
  qualificationReceiptDigest: digest, detail: z.string().max(2048).optional(),
}).strict();
const marketCycleSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_SEALED_MARKET_CYCLE_V2_SCHEMA),
  cycleId: z.string().min(1).max(512), barIndex: z.number().int().nonnegative(),
  closedBar: z.object({ symbol: z.string(), interval: z.literal("1m"),
    open: z.string(), high: z.string(), low: z.string(), close: z.string(), volume: z.string(),
    barOpenTime: z.string(), barCloseTime: z.string() }).strict(),
  htxVolumeAuthorityReceipt: volumeReceiptSchema,
  htxVolumeRaw: z.object({ amount: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    vol: z.number().finite().nonnegative() }).strict(),
  contentDigestHex: digest,
}).strict();

/** Closed input preparation for the actual research-modeled executor. This
 * verifies nested volume commitments that an outer dataset seal alone does not
 * authenticate. It cannot establish independent issuer provenance, current code,
 * PIT eligibility, a lease, a score or permission to use real capital. */
export async function loadRegisteredResearchTrainingExecutionInputPostgresV1(
  db: WaiaPostgresDb, context: OrgContext, supplied: z.infer<typeof requestSchema>,
) {
  const input = await loadRegisteredTrainingPayload(db, context, supplied);
  const expectedDigest = input.experiment.spec.replay.volumeQualificationSha256;
  const cycles = input.cycles.map(value => {
    const cycle = marketCycleSchema.parse(value);
    const receipt = cycle.htxVolumeAuthorityReceipt;
    assertHtxVolumeAuthorityQualified(receipt);
    if (receipt.qualificationReceiptDigest !== expectedDigest) {
      throw new Error("RESEARCH_TRAINING_VOLUME_COMMITMENT_MISMATCH");
    }
    const amount = resolveAuthoritativeHtxBaseVolumeForCapital({
      receipt, amount: cycle.htxVolumeRaw.amount, vol: cycle.htxVolumeRaw.vol,
    });
    // The simulator's exact eight-decimal base capacity must equal the mapped
    // bar. Quote turnover cannot be substituted for base amount. Refuse instead
    // of rounding an extra-precision or exponential bar-volume representation.
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(cycle.closedBar.volume) ||
        parseDecimal(amount.toFixed(8)) !== parseDecimal(cycle.closedBar.volume)) {
      throw new Error("RESEARCH_TRAINING_VOLUME_BASE_MISMATCH");
    }
    return Object.freeze({ ...cycle, closedBar: Object.freeze(cycle.closedBar),
      htxVolumeAuthorityReceipt: Object.freeze(receipt), htxVolumeRaw: Object.freeze(cycle.htxVolumeRaw) });
  });
  return Object.freeze({ ...input, authority: "TRAINING_EXECUTION_INPUT_INTEGRITY_ONLY" as const,
    cycles: Object.freeze(cycles), volumeQualificationSha256: expectedDigest });
}
