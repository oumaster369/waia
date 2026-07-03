import type { Bar } from "@/lib/trader/intelligence/types";
import type { ResearchDatasetRecord } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import { computeBarSetDigest, splitBarsThreeWay } from "@/lib/trader/market-data/research-dataset";
import { ResearchFailureReconstructionError } from "@/lib/trader/research/errors";

export type VerifiedSealedResearchDataset = {
  splits: ReturnType<typeof splitBarsThreeWay>;
  barCount: number;
};

export function verifySealedResearchDatasetFromBars(
  bars: readonly Bar[],
  dataset: ResearchDatasetRecord,
): VerifiedSealedResearchDataset {
  if (bars.length < 60) {
    throw new ResearchFailureReconstructionError(
      "INSUFFICIENT_MARKET_BARS",
      `need at least 60 bars (got ${bars.length})`,
    );
  }

  const splits = splitBarsThreeWay(bars);

  if (splits.train.length !== dataset.trainBarCount) {
    throw new ResearchFailureReconstructionError(
      "SEALED_DATASET_DIGEST_MISMATCH",
      `train bar count mismatch (expected ${dataset.trainBarCount}, got ${splits.train.length})`,
    );
  }
  if (splits.validation.length !== dataset.validationBarCount) {
    throw new ResearchFailureReconstructionError(
      "SEALED_DATASET_DIGEST_MISMATCH",
      `validation bar count mismatch (expected ${dataset.validationBarCount}, got ${splits.validation.length})`,
    );
  }
  if (splits.blind.length !== dataset.blindBarCount) {
    throw new ResearchFailureReconstructionError(
      "SEALED_DATASET_DIGEST_MISMATCH",
      `blind bar count mismatch (expected ${dataset.blindBarCount}, got ${splits.blind.length})`,
    );
  }

  const trainDigest = computeBarSetDigest(splits.train);
  const validationDigest = computeBarSetDigest(splits.validation);
  const blindDigest = computeBarSetDigest(splits.blind);

  if (trainDigest !== dataset.trainDigest) {
    throw new ResearchFailureReconstructionError(
      "SEALED_DATASET_DIGEST_MISMATCH",
      "train digest mismatch against sealed research dataset",
    );
  }
  if (validationDigest !== dataset.validationDigest) {
    throw new ResearchFailureReconstructionError(
      "SEALED_DATASET_DIGEST_MISMATCH",
      "validation digest mismatch against sealed research dataset",
    );
  }
  if (blindDigest !== dataset.blindDigest) {
    throw new ResearchFailureReconstructionError(
      "SEALED_DATASET_DIGEST_MISMATCH",
      "blind digest mismatch against sealed research dataset",
    );
  }

  return { splits, barCount: bars.length };
}
