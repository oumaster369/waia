import { createHash } from "node:crypto";

import { ENERGY_MC_VERSION, QUANTIZER_VERSION, SAMPLER_CONTRACT_VERSION } from "./constants";

function line(value: string): Buffer {
  return Buffer.from(`${value}\n`, "utf8");
}

function sha256Buffer(parts: readonly Buffer[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest();
}

export function digestHex(buffer: Buffer): string {
  return buffer.toString("hex");
}

export type RuntimeContractInput = {
  osClass: string;
  arch: string;
  nodeVersionExact: string;
  codeReleaseSha: string;
  modelTransformVersion: string;
};

export function computeRuntimeContractDigest(input: RuntimeContractInput): Buffer {
  return sha256Buffer([
    line("runtime-contract/v1"),
    line(input.osClass),
    line(input.arch),
    line(input.nodeVersionExact),
    line(input.codeReleaseSha),
    line(SAMPLER_CONTRACT_VERSION),
    line(input.modelTransformVersion),
    line(QUANTIZER_VERSION),
    line(ENERGY_MC_VERSION),
  ]);
}

export type ReplicaRootFamilyInput = {
  organizationId: string;
  venue: string;
  market: string;
  symbol: string;
  primaryHorizonMinutes: number;
  executionHorizonMinutes: number;
  packageSubjectVersion: string;
  terminalTargetDefinitionDigestHex: string;
  executionOpportunityTargetDefinitionDigestHex: string;
  modelTransformVersion: string;
  developmentDatasetDigestHex: string;
  featureVersion: string;
  normalizationVersionDigestHex: string;
  codeReleaseSha: string;
};

export function computeReplicaRootFamilyIdentityDigest(input: ReplicaRootFamilyInput): Buffer {
  return sha256Buffer([
    line("replica-root-family/v1"),
    line(input.organizationId),
    line(input.venue),
    line(input.market),
    line(input.symbol),
    line(String(input.primaryHorizonMinutes)),
    line(String(input.executionHorizonMinutes)),
    line(input.packageSubjectVersion),
    line(input.terminalTargetDefinitionDigestHex),
    line(input.executionOpportunityTargetDefinitionDigestHex),
    line(input.modelTransformVersion),
    line(input.developmentDatasetDigestHex),
    line(input.featureVersion),
    line(input.normalizationVersionDigestHex),
    line(SAMPLER_CONTRACT_VERSION),
    line(QUANTIZER_VERSION),
    line(input.codeReleaseSha),
  ]);
}

export type PkgGenIdV2Input = {
  replicaRootFamilyIdentityDigestHex: string;
  kConfigDec: number;
  mConfigDec: number;
  alphaEpiConfigScale8: string;
};

export function computePredictivePackageGenerationIdentityDigest(input: PkgGenIdV2Input): Buffer {
  return sha256Buffer([
    line("pkg-gen-id/v2"),
    line(input.replicaRootFamilyIdentityDigestHex),
    line(String(input.kConfigDec)),
    line(String(input.mConfigDec)),
    line(input.alphaEpiConfigScale8),
  ]);
}

export type ForecastSamplingFamilyInput = {
  replicaRootFamilyIdentityDigestHex: string;
  organizationId: string;
  venue: string;
  market: string;
  symbol: string;
  anchorClosedBarEpochMs: number;
  primaryHorizonMinutes: number;
  executionHorizonMinutes: number;
  runtimeContractDigestHex: string;
};

export function computeForecastSamplingFamilyIdentityDigest(
  input: ForecastSamplingFamilyInput,
): Buffer {
  return sha256Buffer([
    line("forecast-sampling-family/v1"),
    line(input.replicaRootFamilyIdentityDigestHex),
    line(input.organizationId),
    line(input.venue),
    line(input.market),
    line(input.symbol),
    line(String(input.anchorClosedBarEpochMs)),
    line(String(input.primaryHorizonMinutes)),
    line(String(input.executionHorizonMinutes)),
    line(input.runtimeContractDigestHex),
  ]);
}

export type FcstGenIdV1Input = {
  predictivePackageContentDigestHex: string;
  organizationId: string;
  venue: string;
  market: string;
  symbol: string;
  anchorClosedBarEpochMs: number;
  primaryHorizonMinutes: number;
  executionHorizonMinutes: number;
  terminalTargetRoleId: string;
  executionTargetRoleId: string;
  runtimeContractDigestHex: string;
};

export function computeForecastGenerationIdentityDigest(input: FcstGenIdV1Input): Buffer {
  return sha256Buffer([
    line("fcst-gen-id/v1"),
    line(input.predictivePackageContentDigestHex),
    line(input.organizationId),
    line(input.venue),
    line(input.market),
    line(input.symbol),
    line(String(input.anchorClosedBarEpochMs)),
    line(String(input.primaryHorizonMinutes)),
    line(String(input.executionHorizonMinutes)),
    line(input.terminalTargetRoleId),
    line(input.executionTargetRoleId),
    line(input.runtimeContractDigestHex),
  ]);
}

export function computePredictivePackageContentDigest(
  predictivePackageGenerationIdentityDigest: Buffer,
  replicaArtifactDigests: readonly Buffer[],
): Buffer {
  const hash = createHash("sha256");
  hash.update(Buffer.from("pkg-content/v1", "ascii"));
  hash.update(Buffer.from([0x00]));
  hash.update(predictivePackageGenerationIdentityDigest);
  for (const digest of replicaArtifactDigests) {
    if (digest.length !== 32) {
      throw new Error("[forecast-v2/identity] replica artifact digest must be 32 bytes");
    }
    hash.update(digest);
  }
  return hash.digest();
}

export function computeForecastContentDigest(
  forecastGenerationIdentityDigest: Buffer,
  distributionSemanticDigest: Buffer,
): Buffer {
  const hash = createHash("sha256");
  hash.update(Buffer.from("fcst-content/v1", "ascii"));
  hash.update(Buffer.from([0x00]));
  hash.update(forecastGenerationIdentityDigest);
  hash.update(distributionSemanticDigest);
  return hash.digest();
}

export function computeReplicaArtifactDigestK(stream: Buffer): Buffer {
  return createHash("sha256").update(stream).digest();
}
