import { createHash } from "node:crypto";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  assignRvStateTertileV1,
  buildPredictivePackageV1,
  issueForecastV1,
  terminalMarginalFromSamplesV1,
  verifyForecastDistributionReplayV1,
  verifyReplicaPoolReplayV1,
  type PredictivePackageV1,
  type SourceAnchor,
  type TerminalScenarioMassesV1,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import {
  assertNoDuplicateSourceAnchors,
  canonicalizeSourceCorpusV1,
  SOURCE_CORPUS_DUPLICATE_ANCHOR,
} from "@/lib/trader/intelligence/forecast-v2/source-corpus-canonical-v1";
import { stationaryBootstrapV1 } from "@/lib/trader/intelligence/forecast-v2/stationary-bootstrap-v1";
import { deriveBootstrapRootK } from "@/lib/trader/intelligence/forecast-v2/waia-cbrng-v1";
import type { ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  TERMINAL_BUCKET_COUNT,
  type TerminalTargetGrid,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { type7TertileEdgesV1 } from "@/lib/trader/research/benchmark/type7-quantile-v1";

export const CHALLENGER_EXECUTOR_READY_STATUS = "EXECUTOR_READY" as const;
export const MIN_STATE_POOL_COUNT = 30 as const;
export const FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT =
  "FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT" as const;
export const FORECAST_EPISTEMIC_REPLICA_INVALID = "FORECAST_EPISTEMIC_REPLICA_INVALID" as const;
export { SOURCE_CORPUS_DUPLICATE_ANCHOR };

export type RvStateConditionalReplicaFit = {
  replicaOrdinal: number;
  bootstrapRootK: Buffer;
  blockLength: number;
  q1: number;
  q2: number;
  pools: {
    S0: SourceAnchor[];
    S1: SourceAnchor[];
    S2: SourceAnchor[];
  };
};

export function assertSourceCorpusUnique(anchors: readonly SourceAnchor[]): void {
  assertNoDuplicateSourceAnchors(anchors);
}

export { assignRvStateTertileV1 };

export function fitRvStateConditionalReplicaV1(input: {
  sourceCorpus: readonly SourceAnchor[];
  replicaRootFamilyIdentityDigest: Buffer;
  replicaOrdinal: number;
}): RvStateConditionalReplicaFit {
  const canonical = canonicalizeSourceCorpusV1(input.sourceCorpus);
  const bootstrapRootK = deriveBootstrapRootK(
    input.replicaRootFamilyIdentityDigest,
    input.replicaOrdinal,
  );
  const bootstrap = stationaryBootstrapV1({
    source: canonical,
    bootstrapRootK,
    replicaOrdinal: input.replicaOrdinal,
  });

  const rvValues = bootstrap.resampled.map((a) => a.realizedVol20m_1m);
  let q1: number;
  let q2: number;
  try {
    ({ q1, q2 } = type7TertileEdgesV1(rvValues));
  } catch {
    throw new Error(FORECAST_EPISTEMIC_REPLICA_INVALID);
  }

  const pools: RvStateConditionalReplicaFit["pools"] = { S0: [], S1: [], S2: [] };
  for (const anchor of bootstrap.resampled) {
    const state = assignRvStateTertileV1(anchor.realizedVol20m_1m, q1, q2);
    pools[state].push(anchor);
  }

  return {
    replicaOrdinal: input.replicaOrdinal,
    bootstrapRootK,
    blockLength: bootstrap.blockLength,
    q1,
    q2,
    pools,
  };
}

export function terminalMarginalFromJointSamplesV1(
  jointSamples: readonly SourceAnchor[],
  grid: TerminalTargetGrid,
  gridIdentityDigestHex: string,
): TerminalScenarioMassesV1 {
  const samples: number[][][] = [jointSamples.map((a) => [...a.outcome13d])];
  return terminalMarginalFromSamplesV1(samples, grid, gridIdentityDigestHex);
}

export function assertTerminalMarginalCoherenceV1(input: {
  jointSamples: readonly SourceAnchor[];
  terminalScenarioMasses: TerminalScenarioMassesV1;
  tolerance?: number;
}): void {
  const marginal = terminalMarginalFromJointSamplesV1(
    input.jointSamples,
    input.terminalScenarioMasses.grid,
    input.terminalScenarioMasses.gridIdentityDigestHex,
  );
  const tolerance = input.tolerance ?? 1e-12;
  for (let i = 0; i < TERMINAL_BUCKET_COUNT; i += 1) {
    const expected = input.terminalScenarioMasses.probabilities[i] ?? 0;
    const computed = marginal.probabilities[i] ?? 0;
    if (Math.abs(computed - expected) > tolerance) {
      throw new Error(
        `[challenger] terminal marginal incoherent ordinal=${i} expected=${expected} computed=${computed}`,
      );
    }
  }
}

export function buildExecutorReadyPackageV1(input: {
  family: ReplicaRootFamilyInput;
  sourceCorpus: readonly SourceAnchor[];
  kConfigDec: number;
  mConfigDec?: number;
}): PredictivePackageV1 {
  return buildPredictivePackageV1(input);
}

export function runExecutorReadyEndToEndV1(input: {
  family: ReplicaRootFamilyInput;
  sourceCorpus: readonly SourceAnchor[];
  kConfigDec: number;
  mConfigDec: number;
  anchorClosedBarEpochMs: number;
  anchorRealizedVol20m_1m: number;
  executionHorizonMinutes: number;
  normalizationVersionDigestHex: string;
}) {
  const pkg = buildExecutorReadyPackageV1({
    family: input.family,
    sourceCorpus: input.sourceCorpus,
    kConfigDec: input.kConfigDec,
    mConfigDec: input.mConfigDec,
  });

  for (const artifact of pkg.replicaArtifacts) {
    verifyReplicaPoolReplayV1({
      family: input.family,
      canonicalSourceCorpus: pkg.canonicalSourceCorpus,
      artifact,
    });
  }

  const issuance = issueForecastV1({
    pkg,
    anchorClosedBarEpochMs: input.anchorClosedBarEpochMs,
    anchorRealizedVol20m_1m: input.anchorRealizedVol20m_1m,
    executionHorizonMinutes: input.executionHorizonMinutes,
    normalizationVersionDigestHex: input.normalizationVersionDigestHex,
  });

  verifyForecastDistributionReplayV1({
    issuance,
    expectedDistributionSemanticDigestExec: issuance.distributionSemanticDigestExec,
  });

  return { pkg, issuance };
}

/**
 * Readiness derives from the frozen §4 registry EXECUTOR_READY entry — not an unconditional true.
 * Full Terminal-grid binding readiness is enforced at issuance via package.terminalTargetGrid.
 */
export function isRvStateConditionalExecutorReady(): boolean {
  const entry = challengerModelRegistryV1().find(
    (row) => row.modelTransformVersion === MODEL_TRANSFORM_VERSION,
  );
  return entry?.status === CHALLENGER_EXECUTOR_READY_STATUS;
}

/** Exact approved §4 MODEL_TRIAL_SPEC reason codes. */
export const RESEARCH_ONLY_UNIMPLEMENTED_HAR_JOINT_SPEC_NOT_FROZEN =
  "RESEARCH_ONLY_UNIMPLEMENTED_HAR_JOINT_SPEC_NOT_FROZEN" as const;
export const RESEARCH_ONLY_UNIMPLEMENTED_NONLINEAR_OPTIMIZER_NOT_FROZEN =
  "RESEARCH_ONLY_UNIMPLEMENTED_NONLINEAR_OPTIMIZER_NOT_FROZEN" as const;
export const RESEARCH_ONLY_UNIMPLEMENTED_FEATURE_SET_NOT_PINNED =
  "RESEARCH_ONLY_UNIMPLEMENTED_FEATURE_SET_NOT_PINNED" as const;
export const RESEARCH_ONLY_UNIMPLEMENTED_MULTIVARIATE_DENSITY_NOT_FROZEN =
  "RESEARCH_ONLY_UNIMPLEMENTED_MULTIVARIATE_DENSITY_NOT_FROZEN" as const;
export const RESEARCH_ONLY_PATTERN_OWNED = "RESEARCH_ONLY" as const;

export type ChallengerRegistryStatus =
  | typeof CHALLENGER_EXECUTOR_READY_STATUS
  | typeof RESEARCH_ONLY_UNIMPLEMENTED_HAR_JOINT_SPEC_NOT_FROZEN
  | typeof RESEARCH_ONLY_UNIMPLEMENTED_NONLINEAR_OPTIMIZER_NOT_FROZEN
  | typeof RESEARCH_ONLY_UNIMPLEMENTED_FEATURE_SET_NOT_PINNED
  | typeof RESEARCH_ONLY_UNIMPLEMENTED_MULTIVARIATE_DENSITY_NOT_FROZEN
  | typeof RESEARCH_ONLY_PATTERN_OWNED;

export function challengerModelRegistryV1(): ReadonlyArray<{
  modelTransformVersion: string;
  status: ChallengerRegistryStatus;
}> {
  return [
    { modelTransformVersion: MODEL_TRANSFORM_VERSION, status: CHALLENGER_EXECUTOR_READY_STATUS },
    {
      modelTransformVersion: "har-rv-terminal/v1",
      status: RESEARCH_ONLY_UNIMPLEMENTED_HAR_JOINT_SPEC_NOT_FROZEN,
    },
    {
      modelTransformVersion: "garch11-terminal/v1",
      status: RESEARCH_ONLY_UNIMPLEMENTED_NONLINEAR_OPTIMIZER_NOT_FROZEN,
    },
    {
      modelTransformVersion: "ordinal-ridge-terminal/v1",
      status: RESEARCH_ONLY_UNIMPLEMENTED_FEATURE_SET_NOT_PINNED,
    },
    {
      modelTransformVersion: "joint-locscale-execopp/v1",
      status: RESEARCH_ONLY_UNIMPLEMENTED_MULTIVARIATE_DENSITY_NOT_FROZEN,
    },
    {
      modelTransformVersion: "dynamical-state-ablation/v1",
      status: RESEARCH_ONLY_PATTERN_OWNED,
    },
  ];
}

export function assertChallengerExecutable(modelTransformVersion: string): void {
  const entry = challengerModelRegistryV1().find(
    (row) => row.modelTransformVersion === modelTransformVersion,
  );
  if (!entry) {
    throw new Error(`[challenger] unknown model_transform_version=${modelTransformVersion}`);
  }
  if (entry.status !== CHALLENGER_EXECUTOR_READY_STATUS) {
    throw new Error(
      `[challenger] model ${modelTransformVersion} is not EXECUTOR_READY (status=${entry.status})`,
    );
  }
}

export function computeChallengerArtifactDigest(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
