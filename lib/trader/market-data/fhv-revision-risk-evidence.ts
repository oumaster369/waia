/**
 * Preregistered revision-risk sample windows for DEE-537.
 * Windows are repository-owned and selected before operational results.
 * Live re-fetch is not performed in CI — tests inject frozen mocked pages.
 */

import { join } from "node:path";

import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import { digestNdjsonWindow } from "@/lib/trader/market-data/fhv-canonical-coverage";
import {
  FHV_SYMBOL_CODE_TO_INSTRUMENT,
  fhvOfficialPartitionFileRelativePath,
  resolveFhvCanonicalPartitionInterval,
  type FhvOfficialPartitionName,
  type FhvOfficialSymbolCode,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import type { FhvRealHtxPageFetcher } from "@/lib/trader/market-data/fhv-real-htx-acquisition";
import { streamingBarSemanticDigestOf } from "@/lib/trader/market-data/fhv-streaming-bar-digest";
import { mapHtxKlinesToBars } from "@/lib/trader/market-data/htx-kline-mapper";
import { FHV_SCIENTIFIC_PARTITIONS_V1 } from "@/lib/trader/observability/fhv-partition-receipt";

export const FHV_REVISION_RISK_EVIDENCE_SCHEMA = "fhv-revision-risk-evidence/v1" as const;

export const FHV_PREREGISTERED_REVISION_RISK_SAMPLES = [
  {
    sampleId: "development-btcusdt-2020-06-01-1h",
    partition: "development",
    scientificPartition: "DEVELOPMENT",
    symbol: "BTCUSDT",
    startUtc: "2020-06-01T00:00:00.000Z",
    endUtc: "2020-06-01T01:00:00.000Z",
  },
  {
    sampleId: "walk-forward-ethusdt-2023-06-01-1h",
    partition: "walk-forward",
    scientificPartition: "WF_PREDICTIVE",
    symbol: "ETHUSDT",
    startUtc: "2023-06-01T00:00:00.000Z",
    endUtc: "2023-06-01T01:00:00.000Z",
  },
] as const satisfies readonly {
  sampleId: string;
  partition: Exclude<FhvOfficialPartitionName, "blind-holdout">;
  scientificPartition: "DEVELOPMENT" | "WF_PREDICTIVE" | "WF_ECONOMIC";
  symbol: FhvOfficialSymbolCode;
  startUtc: string;
  endUtc: string;
}[];

export type FhvRevisionRiskComparison = "SAME" | "CHANGED";

export type FhvRevisionRiskSampleEvidenceV1 = Readonly<{
  schemaVersion: typeof FHV_REVISION_RISK_EVIDENCE_SCHEMA;
  sampleId: string;
  partition: Exclude<FhvOfficialPartitionName, "blind-holdout">;
  scientificPartition: "DEVELOPMENT" | "WF_PREDICTIVE" | "WF_ECONOMIC";
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
  const scientific = FHV_SCIENTIFIC_PARTITIONS_V1[sample.scientificPartition];
  if (
    Date.parse(sample.startUtc) < Date.parse(scientific.startUtc) ||
    Date.parse(sample.endUtc) > Date.parse(scientific.endUtc)
  ) {
    throw new FhvRevisionRiskError(
      "REVISION_RISK_SAMPLE_OUTSIDE_SCIENTIFIC_PARTITION",
      `${sample.sampleId} is outside ${sample.scientificPartition}`,
    );
  }
}

for (const sample of FHV_PREREGISTERED_REVISION_RISK_SAMPLES) {
  assertSampleInsidePartition(sample);
}

export function digestOperationalRevisionRiskFromAcquiredFile(input: {
  datasetRoot: string;
  sample: (typeof FHV_PREREGISTERED_REVISION_RISK_SAMPLES)[number];
}): string {
  const relativePath = fhvOfficialPartitionFileRelativePath({
    partition: input.sample.partition,
    symbol: input.sample.symbol,
  });
  return digestNdjsonWindow({
    filePath: join(input.datasetRoot, relativePath),
    startUtc: input.sample.startUtc,
    endUtc: input.sample.endUtc,
    expectedSymbol: FHV_SYMBOL_CODE_TO_INSTRUMENT[input.sample.symbol],
  });
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
  return streamingBarSemanticDigestOf(bars);
}

export async function compareFhvRevisionRiskSample(input: {
  sample: (typeof FHV_PREREGISTERED_REVISION_RISK_SAMPLES)[number];
  operationalDigest: string;
  operationalAcquiredAtUtc: string;
  refetchAcquiredAtUtc: string;
  fetchPage: FhvRealHtxPageFetcher;
}): Promise<FhvRevisionRiskSampleEvidenceV1> {
  if (!/^[a-f0-9]{64}$/.test(input.operationalDigest)) {
    throw new FhvRevisionRiskError(
      "REVISION_RISK_OPERATIONAL_DIGEST_INVALID",
      "operational digest must be a 64-char hex digest of acquired bytes",
    );
  }
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
    scientificPartition: input.sample.scientificPartition,
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

export function assertCompletePreregisteredRevisionRiskEvidence(input: {
  datasetRoot: string;
  evidence: readonly FhvRevisionRiskSampleEvidenceV1[];
}): "SAME" | "HUMAN_DECISION_REQUIRED" {
  if (input.evidence.length === 0) {
    throw new FhvRevisionRiskError(
      "REVISION_RISK_EVIDENCE_EMPTY",
      "PRE_HOLDOUT qualification requires the complete preregistered revision-risk set",
    );
  }
  const expectedIds = FHV_PREREGISTERED_REVISION_RISK_SAMPLES.map((sample) => sample.sampleId);
  const seen = new Set<string>();
  for (const row of input.evidence) {
    if (seen.has(row.sampleId)) {
      throw new FhvRevisionRiskError(
        "REVISION_RISK_SAMPLE_DUPLICATE",
        `duplicate revision-risk sample ${row.sampleId}`,
      );
    }
    seen.add(row.sampleId);
    const expected = FHV_PREREGISTERED_REVISION_RISK_SAMPLES.find(
      (sample) => sample.sampleId === row.sampleId,
    );
    if (!expected) {
      throw new FhvRevisionRiskError(
        "REVISION_RISK_SAMPLE_UNKNOWN",
        `unknown revision-risk sample ${row.sampleId}`,
      );
    }
    if (
      row.partition !== expected.partition ||
      row.scientificPartition !== expected.scientificPartition ||
      row.symbol !== expected.symbol ||
      row.startUtc !== expected.startUtc ||
      row.endUtc !== expected.endUtc
    ) {
      throw new FhvRevisionRiskError(
        "REVISION_RISK_SAMPLE_BOUNDS_MISMATCH",
        `${row.sampleId} source/bounds/symbol do not match the preregistered sample`,
      );
    }
    const operationalFromBytes = digestOperationalRevisionRiskFromAcquiredFile({
      datasetRoot: input.datasetRoot,
      sample: expected,
    });
    if (row.operationalDigest !== operationalFromBytes) {
      throw new FhvRevisionRiskError(
        "REVISION_RISK_OPERATIONAL_DIGEST_FORGED",
        `${row.sampleId} operational digest does not match acquired immutable bytes`,
      );
    }
  }
  for (const sampleId of expectedIds) {
    if (!seen.has(sampleId)) {
      throw new FhvRevisionRiskError(
        "REVISION_RISK_SAMPLE_MISSING",
        `missing preregistered revision-risk sample ${sampleId}`,
      );
    }
  }
  const changed = input.evidence.some((row) => row.comparison === "CHANGED");
  return changed ? "HUMAN_DECISION_REQUIRED" : "SAME";
}
