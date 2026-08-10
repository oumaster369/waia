import { createHash } from "node:crypto";

import { ALPHA_EPI_CONFIG_SCALE8, MODEL_TRANSFORM_VERSION } from "./constants";
import {
  computePredictivePackageContentDigest,
  computePredictivePackageGenerationIdentityDigest,
  computeReplicaArtifactDigestK,
  computeReplicaRootFamilyIdentityDigest,
  digestHex,
  type ReplicaRootFamilyInput,
} from "./identity-digests";
import { quantizeScale8HalfUp } from "./quantize-scale8-half-up-v1";
import { deriveBootstrapRootK } from "./waia-cbrng-v1";

export { MODEL_TRANSFORM_VERSION };

export type SourceAnchor = {
  venue: string;
  market: string;
  symbol: string;
  closedBarEpochMs: number;
  barContentDigest: string;
  realizedVol20m_1m: number;
  outcome13d: readonly number[];
};

export type ReplicaArtifactStub = {
  replicaOrdinal: number;
  bootstrapRootK: Buffer;
  blockLength: number;
  q1Scale8: string;
  q2Scale8: string;
  nS0: number;
  nS1: number;
  nS2: number;
  poolSemanticDigestS0: Buffer;
  poolSemanticDigestS1: Buffer;
  poolSemanticDigestS2: Buffer;
  replicaArtifactDigest: Buffer;
};

export type PackageIdentityStub = {
  replicaRootFamilyIdentityDigest: Buffer;
  predictivePackageGenerationIdentityDigest: Buffer;
  predictivePackageContentDigest: Buffer;
  replicaArtifacts: ReplicaArtifactStub[];
};

function line(value: string): Buffer {
  return Buffer.from(`${value}\n`, "utf8");
}

function buildReplicaArtifactStream(
  input: Omit<ReplicaArtifactStub, "replicaArtifactDigest"> & {
    symbol: string;
    primaryHorizonMinutes: number;
  },
): Buffer {
  const chunks: Buffer[] = [
    line("replica-artifact/v1"),
    line(MODEL_TRANSFORM_VERSION),
    line(String(input.replicaOrdinal)),
    line(input.symbol),
    line(String(input.primaryHorizonMinutes)),
    line("development"),
    line(String(input.blockLength)),
  ];

  const withRoot = Buffer.concat([...chunks, input.bootstrapRootK]);
  return Buffer.concat([
    withRoot,
    line(input.q1Scale8),
    line(input.q2Scale8),
    line("type7-tertile/v1"),
    line(String(input.nS0)),
    line(String(input.nS1)),
    line(String(input.nS2)),
    input.poolSemanticDigestS0,
    input.poolSemanticDigestS1,
    input.poolSemanticDigestS2,
  ]);
}

function zeroPoolDigest(label: string): Buffer {
  return createHash("sha256").update(`pool-stub/${label}`, "utf8").digest();
}

/**
 * Minimum viable stub: seals identity digests with placeholder pool semantics.
 * Full DEVELOPMENT refit lands in later WPs; this binds the frozen digest contracts.
 */
export function buildPackageIdentityStub(input: {
  family: ReplicaRootFamilyInput;
  kConfigDec: number;
  mConfigDec?: number;
  alphaEpiConfigScale8?: string;
}): PackageIdentityStub {
  const replicaRootFamilyIdentityDigest = computeReplicaRootFamilyIdentityDigest(input.family);
  const predictivePackageGenerationIdentityDigest =
    computePredictivePackageGenerationIdentityDigest({
      replicaRootFamilyIdentityDigestHex: digestHex(replicaRootFamilyIdentityDigest),
      kConfigDec: input.kConfigDec,
      mConfigDec: input.mConfigDec ?? 80,
      alphaEpiConfigScale8: input.alphaEpiConfigScale8 ?? ALPHA_EPI_CONFIG_SCALE8,
    });

  const replicaArtifacts: ReplicaArtifactStub[] = [];
  for (let replicaOrdinal = 0; replicaOrdinal < input.kConfigDec; replicaOrdinal += 1) {
    const bootstrapRootK = deriveBootstrapRootK(replicaRootFamilyIdentityDigest, replicaOrdinal);
    const artifactBody = buildReplicaArtifactStream({
      replicaOrdinal,
      bootstrapRootK,
      blockLength: 1,
      q1Scale8: quantizeScale8HalfUp(0.01),
      q2Scale8: quantizeScale8HalfUp(0.02),
      nS0: 30,
      nS1: 30,
      nS2: 30,
      poolSemanticDigestS0: zeroPoolDigest(`S0/${replicaOrdinal}`),
      poolSemanticDigestS1: zeroPoolDigest(`S1/${replicaOrdinal}`),
      poolSemanticDigestS2: zeroPoolDigest(`S2/${replicaOrdinal}`),
      symbol: input.family.symbol,
      primaryHorizonMinutes: input.family.primaryHorizonMinutes,
    });
    replicaArtifacts.push({
      replicaOrdinal,
      bootstrapRootK,
      blockLength: 1,
      q1Scale8: quantizeScale8HalfUp(0.01),
      q2Scale8: quantizeScale8HalfUp(0.02),
      nS0: 30,
      nS1: 30,
      nS2: 30,
      poolSemanticDigestS0: zeroPoolDigest(`S0/${replicaOrdinal}`),
      poolSemanticDigestS1: zeroPoolDigest(`S1/${replicaOrdinal}`),
      poolSemanticDigestS2: zeroPoolDigest(`S2/${replicaOrdinal}`),
      replicaArtifactDigest: computeReplicaArtifactDigestK(artifactBody),
    });
  }

  const predictivePackageContentDigest = computePredictivePackageContentDigest(
    predictivePackageGenerationIdentityDigest,
    replicaArtifacts.map((artifact) => artifact.replicaArtifactDigest),
  );

  return {
    replicaRootFamilyIdentityDigest,
    predictivePackageGenerationIdentityDigest,
    predictivePackageContentDigest,
    replicaArtifacts,
  };
}

export function isModelTransformReady(): true {
  return true;
}
