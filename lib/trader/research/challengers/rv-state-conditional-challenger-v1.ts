import { createHash } from "node:crypto";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import { stationaryBootstrapV1 } from "@/lib/trader/intelligence/forecast-v2/stationary-bootstrap-v1";
import { quantizeScale8HalfUp } from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";
import {
  deriveBootstrapRootK,
  waiaUnbiasedInt,
} from "@/lib/trader/intelligence/forecast-v2/waia-cbrng-v1";
import { CBRNG_DOMAIN_ALEDRAW1 } from "@/lib/trader/intelligence/forecast-v2/constants";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import {
  buildPackageIdentityStub,
  type PackageIdentityStub,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { type7TertileEdgesV1 } from "@/lib/trader/research/benchmark/type7-quantile-v1";

export const CHALLENGER_EXECUTOR_READY_STATUS = "EXECUTOR_READY" as const;
export const MIN_STATE_POOL_COUNT = 30 as const;
export const FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT =
  "FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT" as const;
export const FORECAST_EPISTEMIC_REPLICA_INVALID = "FORECAST_EPISTEMIC_REPLICA_INVALID" as const;
export const SOURCE_CORPUS_DUPLICATE_ANCHOR = "SOURCE_CORPUS_DUPLICATE_ANCHOR" as const;

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

export function assertSourceCorpusUnique(anchors: readonly SourceAnchor[]): void {
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const id = `${anchor.venue}|${anchor.market}|${anchor.symbol}|${anchor.closedBarEpochMs}`;
    if (seen.has(id)) {
      throw new Error(SOURCE_CORPUS_DUPLICATE_ANCHOR);
    }
    seen.add(id);
  }
}

export function assignRvStateTertileV1(rv: number, q1: number, q2: number): "S0" | "S1" | "S2" {
  if (rv <= q1) {
    return "S0";
  }
  if (rv <= q2) {
    return "S1";
  }
  return "S2";
}

export function fitRvStateConditionalReplicaV1(input: {
  sourceCorpus: readonly SourceAnchor[];
  replicaRootFamilyIdentityDigest: Buffer;
  replicaOrdinal: number;
}): RvStateConditionalReplicaFit {
  assertSourceCorpusUnique(input.sourceCorpus);
  const bootstrapRootK = deriveBootstrapRootK(
    input.replicaRootFamilyIdentityDigest,
    input.replicaOrdinal,
  );
  const bootstrap = stationaryBootstrapV1({
    source: [...input.sourceCorpus],
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
  for (let pos = 0; pos < bootstrap.resampled.length; pos += 1) {
    const anchor = bootstrap.resampled[pos]!;
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

export function drawAleatoricSampleV1(input: {
  aleatoricRoot: Buffer;
  replicaOrdinal: number;
  drawOrdinal: number;
  pool: readonly SourceAnchor[];
}): SourceAnchor {
  if (input.pool.length === 0) {
    throw new Error(FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT);
  }
  const index = waiaUnbiasedInt(
    aleDrawAddress(input.aleatoricRoot, input.replicaOrdinal, input.drawOrdinal, 0),
    input.pool.length,
  );
  return input.pool[index]!;
}

export function terminalMarginalFromJointSamplesV1(
  jointSamples: readonly SourceAnchor[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sample of jointSamples) {
    const rH = sample.outcome13d[3];
    if (rH === undefined) {
      continue;
    }
    const key = quantizeScale8HalfUp(rH);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = jointSamples.length;
  const masses = new Map<string, number>();
  for (const [key, count] of counts) {
    masses.set(key, count / total);
  }
  return masses;
}

export function assertTerminalMarginalCoherenceV1(input: {
  jointSamples: readonly SourceAnchor[];
  terminalBucketMasses: ReadonlyMap<string, number>;
  tolerance?: number;
}): void {
  const marginal = terminalMarginalFromJointSamplesV1(input.jointSamples);
  const tolerance = input.tolerance ?? 1e-12;
  for (const [key, mass] of input.terminalBucketMasses) {
    const computed = marginal.get(key) ?? 0;
    if (Math.abs(computed - mass) > tolerance) {
      throw new Error(
        `[challenger] terminal marginal incoherent key=${key} expected=${mass} computed=${computed}`,
      );
    }
  }
}

export function isRvStateConditionalExecutorReady(): true {
  return true;
}

export function buildExecutorReadyPackageStub(input: {
  family: Parameters<typeof buildPackageIdentityStub>[0]["family"];
  kConfigDec: number;
}): PackageIdentityStub {
  return buildPackageIdentityStub(input);
}

export function challengerModelRegistryV1(): ReadonlyArray<{
  modelTransformVersion: string;
  status: typeof CHALLENGER_EXECUTOR_READY_STATUS | "RESEARCH_ONLY_UNIMPLEMENTED";
}> {
  return [
    { modelTransformVersion: MODEL_TRANSFORM_VERSION, status: CHALLENGER_EXECUTOR_READY_STATUS },
    {
      modelTransformVersion: "har-rv-terminal/v1",
      status: "RESEARCH_ONLY_UNIMPLEMENTED",
    },
    {
      modelTransformVersion: "joint-locscale-execopp/v1",
      status: "RESEARCH_ONLY_UNIMPLEMENTED",
    },
  ];
}

export function computeChallengerArtifactDigest(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
