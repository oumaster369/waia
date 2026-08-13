import { createHash } from "node:crypto";

import {
  ALEATORIC_ROOT_PREFIX_16,
  ALPHA_EPI_CONFIG_SCALE8,
  CBRNG_DOMAIN_ALEDRAW1,
  MODEL_TRANSFORM_VERSION,
  TARGET_ROLE_EXECUTION,
  TARGET_ROLE_TERMINAL,
} from "./constants";
import { computeDistributionSemanticDigest } from "./distribution-semantic-digest-v1";
import {
  computeForecastContentDigest,
  computeForecastGenerationIdentityDigest,
  computePredictivePackageContentDigest,
  computePredictivePackageGenerationIdentityDigest,
  computeReplicaArtifactDigestK,
  computeReplicaRootFamilyIdentityDigest,
  computeForecastSamplingFamilyIdentityDigest,
  computeRuntimeContractDigest,
  digestHex,
  type ReplicaRootFamilyInput,
} from "./identity-digests";
import { computePoolSemanticDigest } from "./pool-semantic-digest-v1";
import { quantizeScale8HalfUp } from "./quantize-scale8-half-up-v1";
import {
  FEATURE_VERSION,
  FIT_PARTITION_DEVELOPMENT,
  FORECAST_DISTRIBUTION_REPLAY_MISMATCH,
  FORECAST_EPISTEMIC_REPLICA_INVALID,
  FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT,
  FORECAST_POOL_REPLAY_MISMATCH,
  MIN_STATE_POOL_COUNT,
  OUTCOME_VERSION,
  REPLICA_ARTIFACT_VERSION,
  STATE_ASSIGNMENT_VERSION,
  STATE_EDGES_VERSION,
  type PoolObservation,
  type SourceAnchor,
} from "./source-anchor-v1";
import { canonicalizeSourceCorpusV1 } from "./source-corpus-canonical-v1";
import { stationaryBootstrapV1 } from "./stationary-bootstrap-v1";
import { deriveBootstrapRootK, waiaUnbiasedInt } from "./waia-cbrng-v1";
import { type7TertileEdgesV1 } from "@/lib/trader/research/benchmark/type7-quantile-v1";
import {
  computeTerminalTargetGridFromDevelopmentReturns,
  empiricalBucketProbabilities,
  TERMINAL_BUCKET_COUNT,
  type TerminalTargetGrid,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { terminalRhFromOutcome13dV1 } from "./exec-opp-outcome-materializer-v1";

export { MODEL_TRANSFORM_VERSION };
export type { SourceAnchor } from "./source-anchor-v1";
export {
  FORECAST_DISTRIBUTION_REPLAY_MISMATCH,
  FORECAST_EPISTEMIC_REPLICA_INVALID,
  FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT,
  FORECAST_POOL_REPLAY_MISMATCH,
  MIN_STATE_POOL_COUNT,
};

export type RvState = "S0" | "S1" | "S2";

export type ReplicaArtifact = {
  replicaOrdinal: number;
  bootstrapRootK: Buffer;
  blockLength: number;
  q1: number;
  q2: number;
  q1Scale8: string;
  q2Scale8: string;
  nS0: number;
  nS1: number;
  nS2: number;
  poolSemanticDigestS0: Buffer;
  poolSemanticDigestS1: Buffer;
  poolSemanticDigestS2: Buffer;
  replicaArtifactDigest: Buffer;
  pools: {
    S0: PoolObservation[];
    S1: PoolObservation[];
    S2: PoolObservation[];
  };
};

export type PredictivePackageV1 = {
  family: ReplicaRootFamilyInput;
  replicaRootFamilyIdentityDigest: Buffer;
  predictivePackageGenerationIdentityDigest: Buffer;
  predictivePackageContentDigest: Buffer;
  kConfigDec: number;
  mConfigDec: number;
  alphaEpiConfigScale8: string;
  canonicalSourceCorpus: SourceAnchor[];
  replicaArtifacts: ReplicaArtifact[];
  runtimeContractDigest: Buffer;
  /** Human-ratified DEVELOPMENT Terminal 7-bucket ceremony grid (fixed at package fit). */
  terminalTargetGrid: TerminalTargetGrid;
  terminalTargetGridIdentityDigestHex: string;
};

export type TerminalBucketTailSemanticsV1 = "LOWER_TAIL" | "INTERIOR" | "UPPER_TAIL";

export type TerminalScenarioMassesV1 = {
  grid: TerminalTargetGrid;
  gridIdentityDigestHex: string;
  /** Exactly 7 empirical probabilities on the fixed grid; Σp = 1. */
  probabilities: readonly number[];
  /**
   * Canonical open-tail encoding:
   * ordinal 0 lower = null (−∞ LOWER_TAIL); ordinal 6 upper = null (+∞ UPPER_TAIL).
   * Interior bounds are scale-8 ceremony edges. Never invent ±inf sentinels.
   */
  lowerBoundsScale8: readonly (string | null)[];
  upperBoundsScale8: readonly (string | null)[];
  tailSemantics: readonly TerminalBucketTailSemanticsV1[];
};

export type ForecastIssuanceV1 = {
  package: PredictivePackageV1;
  anchorClosedBarEpochMs: number;
  anchorRealizedVol20m_1m: number;
  executionHorizonMinutes: number;
  organizationId: string;
  normalizationVersionDigestHex: string;
  forecastSamplingFamilyIdentityDigest: Buffer;
  aleatoricRoot: Buffer;
  forecastGenerationIdentityDigest: Buffer;
  distributionSemanticDigestExec: Buffer;
  distributionSemanticDigestTerminal: Buffer;
  forecastContentDigestExec: Buffer;
  forecastContentDigestTerminal: Buffer;
  samples: number[][][];
  terminalScenarioMasses: TerminalScenarioMassesV1;
  actionable: boolean;
  reasonCodes: string[];
};

function line(value: string): Buffer {
  return Buffer.from(`${value}\n`, "utf8");
}

export function assignRvStateTertileV1(rv: number, q1: number, q2: number): RvState {
  if (rv <= q1) {
    return "S0";
  }
  if (rv <= q2) {
    return "S1";
  }
  return "S2";
}

function buildReplicaArtifactStream(input: {
  replicaOrdinal: number;
  symbol: string;
  primaryHorizonMinutes: number;
  blockLength: number;
  bootstrapRootK: Buffer;
  q1Scale8: string;
  q2Scale8: string;
  nS0: number;
  nS1: number;
  nS2: number;
  poolSemanticDigestS0: Buffer;
  poolSemanticDigestS1: Buffer;
  poolSemanticDigestS2: Buffer;
}): Buffer {
  return Buffer.concat([
    line(REPLICA_ARTIFACT_VERSION),
    line(MODEL_TRANSFORM_VERSION),
    line(String(input.replicaOrdinal)),
    line(input.symbol),
    line(String(input.primaryHorizonMinutes)),
    line(FIT_PARTITION_DEVELOPMENT),
    line(String(input.blockLength)),
    input.bootstrapRootK,
    line(input.q1Scale8),
    line(input.q2Scale8),
    line(STATE_EDGES_VERSION),
    line(String(input.nS0)),
    line(String(input.nS1)),
    line(String(input.nS2)),
    input.poolSemanticDigestS0,
    input.poolSemanticDigestS1,
    input.poolSemanticDigestS2,
  ]);
}

function aleDrawAddress(rootSeed: Buffer, k: number, m: number, draw: number) {
  return {
    domain: CBRNG_DOMAIN_ALEDRAW1,
    rootSeed,
    replicaU32: k,
    sampleU32: m,
    drawU32: draw,
    retryU32: 0,
  };
}

export function deriveAleatoricRootT(forecastSamplingFamilyIdentityDigest: Buffer): Buffer {
  if (forecastSamplingFamilyIdentityDigest.length !== 32) {
    throw new Error("[forecast-v2/joint] forecast sampling family digest must be 32 bytes");
  }
  return createHash("sha256")
    .update(Buffer.from(ALEATORIC_ROOT_PREFIX_16, "ascii"))
    .update(forecastSamplingFamilyIdentityDigest)
    .digest();
}

export function fitReplicaArtifactV1(input: {
  family: ReplicaRootFamilyInput;
  canonicalSourceCorpus: readonly SourceAnchor[];
  replicaRootFamilyIdentityDigest: Buffer;
  replicaOrdinal: number;
}): ReplicaArtifact {
  const bootstrapRootK = deriveBootstrapRootK(
    input.replicaRootFamilyIdentityDigest,
    input.replicaOrdinal,
  );
  const bootstrap = stationaryBootstrapV1({
    source: [...input.canonicalSourceCorpus],
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
  if (!Number.isFinite(q1) || !Number.isFinite(q2) || !(q1 < q2)) {
    throw new Error(FORECAST_EPISTEMIC_REPLICA_INVALID);
  }

  const pools: ReplicaArtifact["pools"] = { S0: [], S1: [], S2: [] };
  for (let pos = 0; pos < bootstrap.resampled.length; pos += 1) {
    const anchor = bootstrap.resampled[pos]!;
    const state = assignRvStateTertileV1(anchor.realizedVol20m_1m, q1, q2);
    pools[state].push({ resamplePositionOrdinal: pos, anchor });
  }

  const poolDigestInputBase = {
    organizationId: input.family.organizationId,
    venue: input.family.venue,
    market: input.family.market,
    symbol: input.family.symbol,
    primaryHorizonMinutes: input.family.primaryHorizonMinutes,
    replicaOrdinal: input.replicaOrdinal,
    developmentDatasetDigestHex: input.family.developmentDatasetDigestHex,
  };

  const poolSemanticDigestS0 = computePoolSemanticDigest({
    ...poolDigestInputBase,
    stateId: "S0",
    observations: pools.S0,
  });
  const poolSemanticDigestS1 = computePoolSemanticDigest({
    ...poolDigestInputBase,
    stateId: "S1",
    observations: pools.S1,
  });
  const poolSemanticDigestS2 = computePoolSemanticDigest({
    ...poolDigestInputBase,
    stateId: "S2",
    observations: pools.S2,
  });

  const q1Scale8 = quantizeScale8HalfUp(q1);
  const q2Scale8 = quantizeScale8HalfUp(q2);
  const artifactBody = buildReplicaArtifactStream({
    replicaOrdinal: input.replicaOrdinal,
    symbol: input.family.symbol,
    primaryHorizonMinutes: input.family.primaryHorizonMinutes,
    blockLength: bootstrap.blockLength,
    bootstrapRootK,
    q1Scale8,
    q2Scale8,
    nS0: pools.S0.length,
    nS1: pools.S1.length,
    nS2: pools.S2.length,
    poolSemanticDigestS0,
    poolSemanticDigestS1,
    poolSemanticDigestS2,
  });

  return {
    replicaOrdinal: input.replicaOrdinal,
    bootstrapRootK,
    blockLength: bootstrap.blockLength,
    q1,
    q2,
    q1Scale8,
    q2Scale8,
    nS0: pools.S0.length,
    nS1: pools.S1.length,
    nS2: pools.S2.length,
    poolSemanticDigestS0,
    poolSemanticDigestS1,
    poolSemanticDigestS2,
    replicaArtifactDigest: computeReplicaArtifactDigestK(artifactBody),
    pools,
  };
}

export function serializeReplicaArtifactPayloadV1(input: {
  artifact: ReplicaArtifact;
  symbol: string;
  primaryHorizonMinutes: number;
}): Buffer {
  return buildReplicaArtifactStream({
    replicaOrdinal: input.artifact.replicaOrdinal,
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    blockLength: input.artifact.blockLength,
    bootstrapRootK: input.artifact.bootstrapRootK,
    q1Scale8: input.artifact.q1Scale8,
    q2Scale8: input.artifact.q2Scale8,
    nS0: input.artifact.nS0,
    nS1: input.artifact.nS1,
    nS2: input.artifact.nS2,
    poolSemanticDigestS0: input.artifact.poolSemanticDigestS0,
    poolSemanticDigestS1: input.artifact.poolSemanticDigestS1,
    poolSemanticDigestS2: input.artifact.poolSemanticDigestS2,
  });
}

export function buildPredictivePackageV1(input: {
  family: ReplicaRootFamilyInput;
  sourceCorpus: readonly SourceAnchor[];
  kConfigDec: number;
  mConfigDec?: number;
  alphaEpiConfigScale8?: string;
  runtimeContract?: {
    osClass: string;
    arch: string;
    nodeVersionExact: string;
  };
}): PredictivePackageV1 {
  if (!Number.isInteger(input.kConfigDec) || input.kConfigDec < 1 || input.kConfigDec > 50) {
    throw new Error("[forecast-v2/joint] kConfigDec must be integer 1..50");
  }

  const canonicalSourceCorpus = canonicalizeSourceCorpusV1(input.sourceCorpus);
  const replicaRootFamilyIdentityDigest = computeReplicaRootFamilyIdentityDigest(input.family);
  const mConfigDec = input.mConfigDec ?? 80;
  const alphaEpiConfigScale8 = input.alphaEpiConfigScale8 ?? ALPHA_EPI_CONFIG_SCALE8;

  const runtimeContractDigest = computeRuntimeContractDigest({
    osClass: input.runtimeContract?.osClass ?? process.platform,
    arch: input.runtimeContract?.arch ?? process.arch,
    nodeVersionExact: input.runtimeContract?.nodeVersionExact ?? process.version,
    codeReleaseSha: input.family.codeReleaseSha,
    modelTransformVersion: input.family.modelTransformVersion,
  });

  const replicaArtifacts: ReplicaArtifact[] = [];
  for (let replicaOrdinal = 0; replicaOrdinal < input.kConfigDec; replicaOrdinal += 1) {
    replicaArtifacts.push(
      fitReplicaArtifactV1({
        family: input.family,
        canonicalSourceCorpus,
        replicaRootFamilyIdentityDigest,
        replicaOrdinal,
      }),
    );
  }

  const predictivePackageGenerationIdentityDigest =
    computePredictivePackageGenerationIdentityDigest({
      replicaRootFamilyIdentityDigestHex: digestHex(replicaRootFamilyIdentityDigest),
      kConfigDec: input.kConfigDec,
      mConfigDec,
      alphaEpiConfigScale8,
    });

  const predictivePackageContentDigest = computePredictivePackageContentDigest(
    predictivePackageGenerationIdentityDigest,
    replicaArtifacts.map((artifact) => artifact.replicaArtifactDigest),
  );

  const developmentRh = canonicalSourceCorpus.map((a) => terminalRhFromOutcome13dV1(a.outcome13d));
  const terminalTargetGrid = computeTerminalTargetGridFromDevelopmentReturns(developmentRh);
  const terminalTargetGridIdentityDigestHex =
    computeTerminalTargetGridIdentityDigestHex(terminalTargetGrid);

  return {
    family: input.family,
    replicaRootFamilyIdentityDigest,
    predictivePackageGenerationIdentityDigest,
    predictivePackageContentDigest,
    kConfigDec: input.kConfigDec,
    mConfigDec,
    alphaEpiConfigScale8,
    canonicalSourceCorpus,
    replicaArtifacts,
    runtimeContractDigest,
    terminalTargetGrid,
    terminalTargetGridIdentityDigestHex,
  };
}

function drawAleatoricSample(input: {
  aleatoricRoot: Buffer;
  replicaOrdinal: number;
  drawOrdinal: number;
  pool: readonly PoolObservation[];
}): readonly number[] {
  if (input.pool.length === 0) {
    throw new Error(FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT);
  }
  const index = waiaUnbiasedInt(
    aleDrawAddress(input.aleatoricRoot, input.replicaOrdinal, input.drawOrdinal, 0),
    input.pool.length,
  );
  return input.pool[index]!.anchor.outcome13d;
}

export function generateForecastSamplesV1(input: {
  pkg: PredictivePackageV1;
  anchorClosedBarEpochMs: number;
  anchorRealizedVol20m_1m: number;
  aleatoricRoot: Buffer;
}): { samples: number[][][]; reasonCodes: string[]; actionable: boolean } {
  const samples: number[][][] = [];
  const reasonCodes: string[] = [];
  let actionable = true;

  for (let k = 0; k < input.pkg.kConfigDec; k += 1) {
    const artifact = input.pkg.replicaArtifacts[k]!;
    const state = assignRvStateTertileV1(input.anchorRealizedVol20m_1m, artifact.q1, artifact.q2);
    const pool = artifact.pools[state];
    if (pool.length < MIN_STATE_POOL_COUNT) {
      actionable = false;
      reasonCodes.push(FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT);
      throw new Error(FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT);
    }
    const replicaSamples: number[][] = [];
    for (let m = 0; m < input.pkg.mConfigDec; m += 1) {
      replicaSamples.push([
        ...drawAleatoricSample({
          aleatoricRoot: input.aleatoricRoot,
          replicaOrdinal: k,
          drawOrdinal: m,
          pool,
        }),
      ]);
    }
    samples.push(replicaSamples);
  }

  return { samples, reasonCodes, actionable };
}

export function computeTerminalTargetGridIdentityDigestHex(grid: TerminalTargetGrid): string {
  if (grid.bucketCount !== TERMINAL_BUCKET_COUNT || grid.edges.length !== 6) {
    throw new Error("[forecast-v2/joint] Terminal target grid must be exactly 7 buckets (6 edges)");
  }
  const body = [
    "terminal-target-grid/v1",
    `bucketCount=${grid.bucketCount}`,
    ...grid.edges.map((e) => quantizeScale8HalfUp(e)),
  ].join("\n");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * Terminal R_h marginal on the Human-ratified 7-bucket ceremony grid.
 * Does NOT invent bounds, pad unique keys, or derive a new grid from issuance samples.
 */
export function terminalMarginalFromSamplesV1(
  samples: readonly (readonly (readonly number[])[])[],
  grid: TerminalTargetGrid,
  gridIdentityDigestHex: string,
): TerminalScenarioMassesV1 {
  if (grid.bucketCount !== TERMINAL_BUCKET_COUNT || grid.edges.length !== 6) {
    throw new Error("[forecast-v2/joint] incomplete or invalid Terminal target grid");
  }
  const expectedDigest = computeTerminalTargetGridIdentityDigestHex(grid);
  if (expectedDigest !== gridIdentityDigestHex) {
    throw new Error("[forecast-v2/joint] Terminal target grid identity mismatch");
  }

  const flat: number[] = [];
  for (const replica of samples) {
    for (const draw of replica) {
      if (draw.length !== 13) {
        throw new Error("[forecast-v2/joint] sample must be 13-D outcome");
      }
      flat.push(terminalRhFromOutcome13dV1(draw));
    }
  }
  if (flat.length === 0) {
    throw new Error("[forecast-v2/joint] empty sample stream for Terminal marginal");
  }

  const probabilities = empiricalBucketProbabilities(flat, grid);
  if (probabilities.length !== TERMINAL_BUCKET_COUNT) {
    throw new Error("[forecast-v2/joint] Terminal probability vector must have length 7");
  }
  const sum = probabilities.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-12) {
    throw new Error(`[forecast-v2/joint] Terminal probabilities must sum to 1 (got ${sum})`);
  }

  const lowerBoundsScale8: (string | null)[] = [];
  const upperBoundsScale8: (string | null)[] = [];
  const tailSemantics: TerminalBucketTailSemanticsV1[] = [];
  // Open 7-bucket partition from type-7 edges: (-∞,e0], (e0,e1], …, (e5,+∞)
  // NULL is the only canonical open-end encoding (LOWER_TAIL / UPPER_TAIL).
  for (let ordinal = 0; ordinal < TERMINAL_BUCKET_COUNT; ordinal += 1) {
    if (ordinal === 0) {
      tailSemantics.push("LOWER_TAIL");
      lowerBoundsScale8.push(null);
      upperBoundsScale8.push(quantizeScale8HalfUp(grid.edges[0]!));
    } else if (ordinal === TERMINAL_BUCKET_COUNT - 1) {
      tailSemantics.push("UPPER_TAIL");
      lowerBoundsScale8.push(quantizeScale8HalfUp(grid.edges[grid.edges.length - 1]!));
      upperBoundsScale8.push(null);
    } else {
      tailSemantics.push("INTERIOR");
      lowerBoundsScale8.push(quantizeScale8HalfUp(grid.edges[ordinal - 1]!));
      upperBoundsScale8.push(quantizeScale8HalfUp(grid.edges[ordinal]!));
    }
  }

  return {
    grid,
    gridIdentityDigestHex,
    probabilities,
    lowerBoundsScale8,
    upperBoundsScale8,
    tailSemantics,
  };
}

export function issueForecastV1(input: {
  pkg: PredictivePackageV1;
  anchorClosedBarEpochMs: number;
  anchorRealizedVol20m_1m: number;
  executionHorizonMinutes: number;
  normalizationVersionDigestHex: string;
}): ForecastIssuanceV1 {
  const forecastSamplingFamilyIdentityDigest = computeForecastSamplingFamilyIdentityDigest({
    replicaRootFamilyIdentityDigestHex: digestHex(input.pkg.replicaRootFamilyIdentityDigest),
    organizationId: input.pkg.family.organizationId,
    venue: input.pkg.family.venue,
    market: input.pkg.family.market,
    symbol: input.pkg.family.symbol,
    anchorClosedBarEpochMs: input.anchorClosedBarEpochMs,
    primaryHorizonMinutes: input.pkg.family.primaryHorizonMinutes,
    executionHorizonMinutes: input.executionHorizonMinutes,
    runtimeContractDigestHex: digestHex(input.pkg.runtimeContractDigest),
  });

  const aleatoricRoot = deriveAleatoricRootT(forecastSamplingFamilyIdentityDigest);

  const forecastGenerationIdentityDigest = computeForecastGenerationIdentityDigest({
    predictivePackageContentDigestHex: digestHex(input.pkg.predictivePackageContentDigest),
    organizationId: input.pkg.family.organizationId,
    venue: input.pkg.family.venue,
    market: input.pkg.family.market,
    symbol: input.pkg.family.symbol,
    anchorClosedBarEpochMs: input.anchorClosedBarEpochMs,
    primaryHorizonMinutes: input.pkg.family.primaryHorizonMinutes,
    executionHorizonMinutes: input.executionHorizonMinutes,
    terminalTargetRoleId: TARGET_ROLE_TERMINAL,
    executionTargetRoleId: TARGET_ROLE_EXECUTION,
    runtimeContractDigestHex: digestHex(input.pkg.runtimeContractDigest),
  });

  const { samples, reasonCodes, actionable } = generateForecastSamplesV1({
    pkg: input.pkg,
    anchorClosedBarEpochMs: input.anchorClosedBarEpochMs,
    anchorRealizedVol20m_1m: input.anchorRealizedVol20m_1m,
    aleatoricRoot,
  });

  const distributionSemanticDigestExec = computeDistributionSemanticDigest({
    forecastGenerationIdentityDigestHex: digestHex(forecastGenerationIdentityDigest),
    predictivePackageContentDigestHex: digestHex(input.pkg.predictivePackageContentDigest),
    k: input.pkg.kConfigDec,
    m: input.pkg.mConfigDec,
    normalizationVersionDigestHex: input.normalizationVersionDigestHex,
    targetRoleId: TARGET_ROLE_EXECUTION,
    samples,
  });

  const distributionSemanticDigestTerminal = computeDistributionSemanticDigest({
    forecastGenerationIdentityDigestHex: digestHex(forecastGenerationIdentityDigest),
    predictivePackageContentDigestHex: digestHex(input.pkg.predictivePackageContentDigest),
    k: input.pkg.kConfigDec,
    m: input.pkg.mConfigDec,
    normalizationVersionDigestHex: input.normalizationVersionDigestHex,
    targetRoleId: TARGET_ROLE_TERMINAL,
    samples,
  });

  const forecastContentDigestExec = computeForecastContentDigest(
    forecastGenerationIdentityDigest,
    distributionSemanticDigestExec,
  );
  const forecastContentDigestTerminal = computeForecastContentDigest(
    forecastGenerationIdentityDigest,
    distributionSemanticDigestTerminal,
  );

  return {
    package: input.pkg,
    anchorClosedBarEpochMs: input.anchorClosedBarEpochMs,
    anchorRealizedVol20m_1m: input.anchorRealizedVol20m_1m,
    executionHorizonMinutes: input.executionHorizonMinutes,
    organizationId: input.pkg.family.organizationId,
    normalizationVersionDigestHex: input.normalizationVersionDigestHex,
    forecastSamplingFamilyIdentityDigest,
    aleatoricRoot,
    forecastGenerationIdentityDigest,
    distributionSemanticDigestExec,
    distributionSemanticDigestTerminal,
    forecastContentDigestExec,
    forecastContentDigestTerminal,
    samples,
    terminalScenarioMasses: terminalMarginalFromSamplesV1(
      samples,
      input.pkg.terminalTargetGrid,
      input.pkg.terminalTargetGridIdentityDigestHex,
    ),
    actionable,
    reasonCodes,
  };
}

export function verifyForecastDistributionReplayV1(input: {
  issuance: ForecastIssuanceV1;
  expectedDistributionSemanticDigestExec: Buffer;
}): void {
  const regenerated = computeDistributionSemanticDigest({
    forecastGenerationIdentityDigestHex: digestHex(input.issuance.forecastGenerationIdentityDigest),
    predictivePackageContentDigestHex: digestHex(
      input.issuance.package.predictivePackageContentDigest,
    ),
    k: input.issuance.package.kConfigDec,
    m: input.issuance.package.mConfigDec,
    normalizationVersionDigestHex: input.issuance.normalizationVersionDigestHex,
    targetRoleId: TARGET_ROLE_EXECUTION,
    samples: input.issuance.samples,
  });
  if (!regenerated.equals(input.expectedDistributionSemanticDigestExec)) {
    throw new Error(FORECAST_DISTRIBUTION_REPLAY_MISMATCH);
  }
}

export function verifyReplicaPoolReplayV1(input: {
  family: ReplicaRootFamilyInput;
  canonicalSourceCorpus: readonly SourceAnchor[];
  artifact: ReplicaArtifact;
}): void {
  const replicaRootFamilyIdentityDigest = computeReplicaRootFamilyIdentityDigest(input.family);
  const refit = fitReplicaArtifactV1({
    family: input.family,
    canonicalSourceCorpus: input.canonicalSourceCorpus,
    replicaRootFamilyIdentityDigest,
    replicaOrdinal: input.artifact.replicaOrdinal,
  });
  if (!refit.poolSemanticDigestS0.equals(input.artifact.poolSemanticDigestS0)) {
    throw new Error(FORECAST_POOL_REPLAY_MISMATCH);
  }
  if (!refit.poolSemanticDigestS1.equals(input.artifact.poolSemanticDigestS1)) {
    throw new Error(FORECAST_POOL_REPLAY_MISMATCH);
  }
  if (!refit.poolSemanticDigestS2.equals(input.artifact.poolSemanticDigestS2)) {
    throw new Error(FORECAST_POOL_REPLAY_MISMATCH);
  }
}

export function isModelTransformReady(pkg?: PredictivePackageV1): boolean {
  if (!pkg) {
    return false;
  }
  return (
    pkg.terminalTargetGrid.bucketCount === TERMINAL_BUCKET_COUNT &&
    pkg.terminalTargetGrid.edges.length === 6 &&
    computeTerminalTargetGridIdentityDigestHex(pkg.terminalTargetGrid) ===
      pkg.terminalTargetGridIdentityDigestHex
  );
}

// Re-export canonical corpus helper for permutation regression tests.
export { canonicalizeSourceCorpusV1 } from "./source-corpus-canonical-v1";
export { FEATURE_VERSION, OUTCOME_VERSION, STATE_ASSIGNMENT_VERSION };
