import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq } from "drizzle-orm";
import * as pgSchema from "@/db/schema.postgres";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { assertDee540BlindTailAuthorized, type Dee540BlindTailGrant } from "@/lib/trader/research/dee-540-blind-tail-gate";
import { claimDee540BlindPayloadRead, type Dee540BlindPayloadCapability } from "@/lib/trader/research/dee-540-blind-tail-commit";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { listMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import {
  finalizeBarSetDigestFromBarDigests,
  type SealedResearchDatasetDigests,
} from "@/lib/trader/market-data/research-dataset";
import type { Bar, BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import { orgScopedWhere, requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

export type M9BarCommitment = Readonly<{
  id: string;
  barOpenTime: string;
  barCloseTime: string;
  contentDigest: string;
}>;

/** Stored hashes are commitments only. No OHLCV bytes have been verified here. */
export type M9DatasetSealPreview = Readonly<{
  organizationId: string;
  symbol: InstrumentId;
  interval: BarInterval;
  barCount: number;
  contentDigest: string;
  sealed: Readonly<SealedResearchDatasetDigests>;
  commitments: readonly M9BarCommitment[];
}>;

/** Strips repository-only fields (`id`, `organizationId`, `contentDigest`, `ingestedAt`) off a stored bar row. */
export function barsFromMarketBarRecords(
  records: readonly Pick<
    Bar,
    | "symbol"
    | "interval"
    | "open"
    | "high"
    | "low"
    | "close"
    | "volume"
    | "barOpenTime"
    | "barCloseTime"
  >[],
): Bar[] {
  return records.map((record) => ({
    symbol: record.symbol,
    interval: record.interval,
    open: record.open,
    high: record.high,
    low: record.low,
    close: record.close,
    volume: record.volume,
    barOpenTime: record.barOpenTime,
    barCloseTime: record.barCloseTime,
  }));
}

/** Metadata visibility only: no price or volume column is selected. The
 * deterministic split and stored hashes commit to a proposed dataset. Actual
 * payload integrity must be checked after each permitted split read. */
export async function computeM9DatasetSealPreviewPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  input: { symbol: InstrumentId; interval: BarInterval },
): Promise<M9DatasetSealPreview> {
  const scoped = requireOrgContext(context.organizationId);
  const table = pgSchema.traderMarketBars;
  const rows = await ex.select({
    id: table.id, barOpenTime: table.barOpenTime,
    barCloseTime: table.barCloseTime, contentDigest: table.contentDigest,
  }).from(table).where(and(
    orgScopedWhere(table.organizationId, scoped),
    eq(table.symbol, input.symbol), eq(table.interval, input.interval),
  )).orderBy(asc(table.barOpenTime));
  const commitments = Object.freeze(rows.map(row => Object.freeze({
    id: row.id, barOpenTime: row.barOpenTime.toISOString(),
    barCloseTime: row.barCloseTime.toISOString(), contentDigest: row.contentDigest,
  })));
  const trainCount = Math.floor(rows.length * 0.6);
  const validationCount = Math.floor(rows.length * 0.2);
  if (trainCount < 1 || validationCount < 1 || rows.length - trainCount - validationCount < 1) {
    throw new Error("M9_METADATA_INSUFFICIENT_PARTITIONS");
  }
  let previousClose = -Infinity;
  for (const row of rows) {
    if (!/^[a-f0-9]{64}$/.test(row.contentDigest) ||
        row.barOpenTime.getTime() < previousClose || row.barOpenTime >= row.barCloseTime) {
      throw new Error("M9_METADATA_INVALID_COMMITMENT");
    }
    previousClose = row.barCloseTime.getTime();
  }
  const digests = commitments.map(row => row.contentDigest);
  const validationEnd = trainCount + validationCount;
  const sealed = Object.freeze({
    trainBarCount: trainCount, validationBarCount: validationCount,
    blindBarCount: rows.length - validationEnd,
    trainDigest: finalizeBarSetDigestFromBarDigests(digests.slice(0, trainCount)),
    validationDigest: finalizeBarSetDigestFromBarDigests(digests.slice(trainCount, validationEnd)),
    blindDigest: finalizeBarSetDigestFromBarDigests(digests.slice(validationEnd)),
    sealedAt: new Date().toISOString(),
  });
  return Object.freeze({ organizationId: scoped.organizationId, symbol: input.symbol, interval: input.interval,
    barCount: rows.length, contentDigest: finalizeBarSetDigestFromBarDigests(digests),
    sealed, commitments });
}

/** Scoped, half-open payload read with exact ordered tuple and actual-content
 * verification. The blind case additionally checks the independent grant and
 * invocation-owned one-shot payload capability. It is called only inside the consume owner's
 * outcome transaction; this API does not itself issue another blind opening. */
export async function loadM9ResearchPayloadPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  preview: M9DatasetSealPreview,
  request: { partition: "nonblind" | "validation" } |
    { partition: "blind"; grant: Dee540BlindTailGrant; capability: Dee540BlindPayloadCapability },
): Promise<Bar[]> {
  const scoped = requireOrgContext(context.organizationId);
  if (scoped.organizationId !== preview.organizationId) throw new Error("M9_METADATA_SCOPE_MISMATCH");
  const validationEnd = preview.sealed.trainBarCount + preview.sealed.validationBarCount;
  if (request.partition === "blind") {
    const grant = assertDee540BlindTailAuthorized(request.grant ?? {});
    if (grant.blindAuthorizationScope.blindDigest !== preview.sealed.blindDigest) {
      throw new Error("M9_BLIND_PAYLOAD_GRANT_MISMATCH");
    }
    claimDee540BlindPayloadRead(ex, request.capability, preview.sealed.blindDigest);
  }
  const start = request.partition === "blind" ? validationEnd :
    request.partition === "validation" ? preview.sealed.trainBarCount : 0;
  const end = request.partition === "blind" ? preview.barCount : validationEnd;
  const expected = preview.commitments.slice(start, end);
  if (!expected.length) throw new Error("M9_METADATA_EMPTY_PARTITION");
  const records = await listMarketBarsPostgres(ex, scoped, {
    symbol: preview.symbol, interval: preview.interval,
    barOpenTimeFrom: new Date(expected[0]!.barOpenTime),
    barOpenTimeBefore: new Date(end < preview.barCount
      ? preview.commitments[end]!.barOpenTime : expected.at(-1)!.barCloseTime),
  });
  if (records.length !== expected.length || records.some((record, index) => {
    const commitment = expected[index]!;
    return record.id !== commitment.id || record.barOpenTime !== commitment.barOpenTime ||
      record.barCloseTime !== commitment.barCloseTime || record.contentDigest !== commitment.contentDigest ||
      computeBarContentDigest(record) !== commitment.contentDigest;
  })) throw new Error("M9_PAYLOAD_COMMITMENT_MISMATCH");
  return barsFromMarketBarRecords(records);
}
