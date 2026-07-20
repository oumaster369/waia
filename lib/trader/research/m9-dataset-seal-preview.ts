import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { listMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import {
  sealResearchDataset,
  splitBarsThreeWay,
  type ResearchDatasetThreeWaySplit,
  type SealedResearchDatasetDigests,
} from "@/lib/trader/market-data/research-dataset";
import type { Bar, BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

export type M9DatasetSealPreview = {
  bars: Bar[];
  splits: ResearchDatasetThreeWaySplit;
  sealed: SealedResearchDatasetDigests;
};

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

/**
 * Deterministic dataset seal preview shared by the M9 v2 research campaign, the operator
 * digest helper, and the research orchestrator (DEE-398 / ADR-0022). Given identical stored
 * bars, this always produces the same `blindDigest` (and full split), regardless of who calls
 * it or when — the property runtime re-verification in the orchestrator depends on.
 */
export async function computeM9DatasetSealPreviewPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  input: { symbol: InstrumentId; interval: BarInterval },
): Promise<M9DatasetSealPreview> {
  const barRecords = await listMarketBarsPostgres(ex, context, input);
  const bars = barsFromMarketBarRecords(barRecords);
  const splits = splitBarsThreeWay(bars);
  const sealed = sealResearchDataset(bars, splits);
  return { bars, splits, sealed };
}
