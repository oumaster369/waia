/**
 * Preregistered revision-risk sample windows for DEE-537.
 * Windows are repository-owned and selected before operational results.
 * Live re-fetch is not performed in CI — tests inject frozen mocked pages.
 */

import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { mapHtxKlinesToBars } from "@/lib/trader/market-data/htx-kline-mapper";
import {
  FHV_SYMBOL_CODE_TO_INSTRUMENT,
  resolveFhvCanonicalPartitionInterval,
  type FhvOfficialPartitionName,
  type FhvOfficialSymbolCode,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import type { FhvRealHtxPageFetcher } from "@/lib/trader/market-data/fhv-real-htx-acquisition";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";

export const FHV_REVISION_RISK_EVIDENCE_SCHEMA = "fhv-revision-risk-evidence/v1" as const;

export const FHV_PREREGISTERED_REVISION_RISK_SAMPLES = [
  {
    sampleId: "development-btcusdt-2020-06-01-1h",
    partition: "development",
    symbol: "BTCUSDT",
    startUtc: "2020-06-01T00:00:00.000Z",
    endUtc: "2020-06-01T01:00:00.000Z",
  },
  {
    sampleId: "walk-forward-ethusdt-2023-06-01-1h",
    partition: "walk-forward",
    symbol: "ETHUSDT",
    startUtc: "2023-06-01T00:00:00.000Z",
    endUtc: "2023-06-01T01:00:00.000Z",
  },
] as const satisfies readonly {
  sampleId: string;
  partition: Exclude<FhvOfficialPartitionName, "blind-holdout">;
  symbol: FhvOfficialSymbolCode;
  startUtc: string;
  endUtc: string;
}[];

export type FhvRevisionRiskComparison = "SAME" | "CHANGED";

export type FhvRevisionRiskSampleEvidenceV1 = Readonly<{
  schemaVersion: typeof FHV_REVISION_RISK_EVIDENCE_SCHEMA;
  sampleId: string;
  partition: Exclude<FhvOfficialPartitionName, "blind-holdout">;
  symbol: FhvOfficialSymbolCode;
  startUtc: string;
  endUtc: string;
  operationalDigest: string;
  refetchDigest: string;
  operationalAcquiredAtUtc: string;
  refetchAcquiredAtUtc: string;
  comparison: FhvRevisionRiskComparison;
}>;

export class FhvRevisionRiskError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvRevisionRiskError";
  }
}

function assertSampleInsidePartition(
  sample: (typeof FHV_PREREGISTERED_REVISION_RISK_SAMPLES)[number],
): void {
  const canonical = resolveFhvCanonicalPartitionInterval(sample.partition);
  if (
    Date.parse(sample.startUtc) < Date.parse(canonical.startUtc) ||
    Date.parse(sample.endUtc) > Date.parse(canonical.endUtc)
  ) {
    throw new FhvRevisionRiskError(
      "REVISION_RISK_SAMPLE_OUTSIDE_PARTITION",
      `${sample.sampleId} is outside ${sample.partition}`,
    );
  }
}

for (const sample of FHV_PREREGISTERED_REVISION_RISK_SAMPLES) {
  assertSampleInsidePartition(sample);
}

export async function digestHtxSampleWindow(input: {
  sample: (typeof FHV_PREREGISTERED_REVISION_RISK_SAMPLES)[number];
  fetchPage: FhvRealHtxPageFetcher;
}): Promise<string> {
  const instrument = FHV_SYMBOL_CODE_TO_INSTRUMENT[input.sample.symbol];
  const rows = await input.fetchPage({
    symbol: internalSymbolToHtx(instrument),
    period: "1min",
    size: 1000,
    from: Math.floor(Date.parse(input.sample.startUtc) / 1000),
    to: Math.floor(Date.parse(input.sample.endUtc) / 1000) - 1,
  });
  const startMs = Date.parse(input.sample.startUtc);
  const endMs = Date.parse(input.sample.endUtc);
  const bars = mapHtxKlinesToBars(instrument, rows, "1m").filter((bar) => {
    const openMs = Date.parse(bar.barOpenTime);
    return openMs >= startMs && openMs < endMs;
  });
  return computeStableJsonDigest(bars.map((bar) => computeBarContentDigest(bar)));
}

export async function compareFhvRevisionRiskSample(input: {
  sample: (typeof FHV_PREREGISTERED_REVISION_RISK_SAMPLES)[number];
  operationalDigest: string;
  operationalAcquiredAtUtc: string;
  refetchAcquiredAtUtc: string;
  fetchPage: FhvRealHtxPageFetcher;
}): Promise<FhvRevisionRiskSampleEvidenceV1> {
  const refetchDigest = await digestHtxSampleWindow({
    sample: input.sample,
    fetchPage: input.fetchPage,
  });
  const comparison: FhvRevisionRiskComparison =
    refetchDigest === input.operationalDigest ? "SAME" : "CHANGED";
  return {
    schemaVersion: FHV_REVISION_RISK_EVIDENCE_SCHEMA,
    sampleId: input.sample.sampleId,
    partition: input.sample.partition,
    symbol: input.sample.symbol,
    startUtc: input.sample.startUtc,
    endUtc: input.sample.endUtc,
    operationalDigest: input.operationalDigest,
    refetchDigest,
    operationalAcquiredAtUtc: input.operationalAcquiredAtUtc,
    refetchAcquiredAtUtc: input.refetchAcquiredAtUtc,
    comparison,
  };
}
