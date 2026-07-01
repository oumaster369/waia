import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { Bar, BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";

export const RESEARCH_DATASET_SCHEMA_VERSION = "1.0.0" as const;

export type ResearchDatasetSplitName = "train" | "validation" | "blind";

export type ResearchDatasetSplitRatios = {
  train: number;
  validation: number;
  blind: number;
};

export const DEFAULT_RESEARCH_DATASET_SPLIT_RATIOS: ResearchDatasetSplitRatios = {
  train: 0.6,
  validation: 0.2,
  blind: 0.2,
};

export type ResearchDatasetThreeWaySplit = {
  train: readonly Bar[];
  validation: readonly Bar[];
  blind: readonly Bar[];
};

export type SealedResearchDatasetDigests = {
  trainBarCount: number;
  validationBarCount: number;
  blindBarCount: number;
  trainDigest: string;
  validationDigest: string;
  blindDigest: string;
  sealedAt: string;
};

export type SealResearchDatasetInput = {
  symbol: InstrumentId;
  interval: BarInterval;
  splits: ResearchDatasetThreeWaySplit;
  sealedAt?: Date;
};

function assertSplitRatios(ratios: ResearchDatasetSplitRatios): void {
  const sum = ratios.train + ratios.validation + ratios.blind;
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(
      `[market-data] research dataset split ratios must sum to 1 (got ${sum.toFixed(6)})`,
    );
  }
  if (ratios.train <= 0 || ratios.validation <= 0 || ratios.blind <= 0) {
    throw new Error("[market-data] research dataset split ratios must be positive");
  }
}

function splitCount(total: number, ratio: number): number {
  return Math.floor(total * ratio);
}

/** Chronological train / validation / blind partition. */
export function splitBarsThreeWay(
  bars: readonly Bar[],
  ratios: ResearchDatasetSplitRatios = DEFAULT_RESEARCH_DATASET_SPLIT_RATIOS,
): ResearchDatasetThreeWaySplit {
  assertSplitRatios(ratios);

  if (bars.length < 3) {
    throw new Error(
      `[market-data] research dataset requires at least 3 bars for three-way split (got ${bars.length})`,
    );
  }

  const trainCount = splitCount(bars.length, ratios.train);
  const validationCount = splitCount(bars.length, ratios.validation);
  const blindCount = bars.length - trainCount - validationCount;

  if (trainCount < 1 || validationCount < 1 || blindCount < 1) {
    throw new Error(
      `[market-data] split ratios yield empty partition for ${bars.length} bars (train=${trainCount}, validation=${validationCount}, blind=${blindCount})`,
    );
  }

  const trainEnd = trainCount;
  const validationEnd = trainEnd + validationCount;

  return {
    train: bars.slice(0, trainEnd),
    validation: bars.slice(trainEnd, validationEnd),
    blind: bars.slice(validationEnd),
  };
}

export function computeBarSetDigest(bars: readonly Bar[]): string {
  const barDigests = bars.map((bar) => computeBarContentDigest(bar));
  return computeStableJsonDigest({
    schemaVersion: RESEARCH_DATASET_SCHEMA_VERSION,
    barDigests,
  });
}

export function sealResearchDataset(
  bars: readonly Bar[],
  splits: ResearchDatasetThreeWaySplit,
): SealedResearchDatasetDigests {
  if (bars.length === 0) {
    throw new Error("[market-data] cannot seal research dataset from empty bar history");
  }

  const combinedCount = splits.train.length + splits.validation.length + splits.blind.length;
  if (combinedCount !== bars.length) {
    throw new Error(
      `[market-data] split bar counts (${combinedCount}) must match full history (${bars.length})`,
    );
  }

  const sealedAt = new Date().toISOString();

  return {
    trainBarCount: splits.train.length,
    validationBarCount: splits.validation.length,
    blindBarCount: splits.blind.length,
    trainDigest: computeBarSetDigest(splits.train),
    validationDigest: computeBarSetDigest(splits.validation),
    blindDigest: computeBarSetDigest(splits.blind),
    sealedAt,
  };
}
