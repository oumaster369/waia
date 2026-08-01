import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  assertFhvConfigurationFreezeMatch,
  buildFhvConfigurationFreeze,
  computeFhvConfigurationFreezeDigest,
  type FhvConfigurationFreezeV1,
} from "@/lib/trader/observability/fhv-configuration-freeze";

export const FHV_CONFIGURATION_FREEZE_ARTIFACT_SCHEMA_VERSION =
  "fhv-configuration-freeze-artifact/v1" as const;
export const FHV_CONFIGURATION_FREEZE_ARTIFACT_FILENAME =
  "fhv-configuration-freeze.v1.json" as const;

export type FhvConfigurationFreezeArtifactV1 = Readonly<{
  schemaVersion: typeof FHV_CONFIGURATION_FREEZE_ARTIFACT_SCHEMA_VERSION;
  configurationFreeze: FhvConfigurationFreezeV1;
  datasetQualificationReceiptDigest: string;
  sourceReceiptDigests: readonly string[];
  contentDigest: string;
  rawSha256: string;
}>;

export class FhvConfigurationFreezeArtifactError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvConfigurationFreezeArtifactError";
  }
}

function computeRawSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function computeArtifactContentDigest(
  artifact: Omit<FhvConfigurationFreezeArtifactV1, "contentDigest" | "rawSha256">,
): string {
  return computePayloadDigest(artifact);
}

export function buildFhvConfigurationFreezeArtifact(input: {
  configurationFreeze: FhvConfigurationFreezeV1;
  datasetQualificationReceiptDigest: string;
  sourceReceiptDigests?: readonly string[];
}): FhvConfigurationFreezeArtifactV1 {
  const withoutDigests = {
    schemaVersion: FHV_CONFIGURATION_FREEZE_ARTIFACT_SCHEMA_VERSION,
    configurationFreeze: input.configurationFreeze,
    datasetQualificationReceiptDigest: input.datasetQualificationReceiptDigest,
    sourceReceiptDigests: [...(input.sourceReceiptDigests ?? [])],
  };
  const withContentDigest = {
    ...withoutDigests,
    contentDigest: computeArtifactContentDigest(withoutDigests),
  };
  const jsonWithoutRaw = `${JSON.stringify(withContentDigest, null, 2)}\n`;
  return {
    ...withContentDigest,
    rawSha256: computeRawSha256(jsonWithoutRaw),
  };
}

export function readFhvConfigurationFreezeArtifact(
  artifactPath: string,
): FhvConfigurationFreezeArtifactV1 {
  const raw = readFileSync(artifactPath, "utf8");
  const parsed = JSON.parse(raw) as FhvConfigurationFreezeArtifactV1;
  const { contentDigest, rawSha256, ...withoutDigests } = parsed;
  const expectedContent = computeArtifactContentDigest(withoutDigests);
  if (expectedContent !== contentDigest) {
    throw new FhvConfigurationFreezeArtifactError(
      "CONFIGURATION_FREEZE_ARTIFACT_DIGEST_MISMATCH",
      "Configuration freeze artifact contentDigest mismatch.",
    );
  }
  const jsonWithoutRaw = `${JSON.stringify({ ...withoutDigests, contentDigest }, null, 2)}\n`;
  if (computeRawSha256(jsonWithoutRaw) !== rawSha256) {
    throw new FhvConfigurationFreezeArtifactError(
      "CONFIGURATION_FREEZE_ARTIFACT_RAW_SHA256_MISMATCH",
      "Configuration freeze artifact rawSha256 mismatch.",
    );
  }
  assertFhvConfigurationFreezeMatch(
    parsed.configurationFreeze,
    parsed.configurationFreeze.configurationFreezeDigest,
  );
  return parsed;
}

export function writeFhvConfigurationFreezeArtifactAtomic(input: {
  artifactDir: string;
  releaseSha: string;
  releaseTag?: string;
  runId: string;
  organizationId: string;
  operatorId: string;
  datasetDigest: string;
  manifestDigest: string;
  strategyVersions: readonly string[];
  strategyDigests: readonly string[];
  checkpointDigest: string;
  datasetQualificationReceiptDigest: string;
  sourceReceiptDigests?: readonly string[];
}): { artifactPath: string; artifact: FhvConfigurationFreezeArtifactV1 } {
  mkdirSync(input.artifactDir, { recursive: true });
  const artifactPath = join(input.artifactDir, FHV_CONFIGURATION_FREEZE_ARTIFACT_FILENAME);
  if (existsSync(artifactPath)) {
    return { artifactPath, artifact: readFhvConfigurationFreezeArtifact(artifactPath) };
  }

  const configurationFreeze = buildFhvConfigurationFreeze({
    releaseSha: input.releaseSha,
    releaseTag: input.releaseTag,
    runId: input.runId,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    datasetDigest: input.datasetDigest,
    manifestDigest: input.manifestDigest,
    strategyVersions: input.strategyVersions,
    strategyDigests: input.strategyDigests,
    checkpointDigest: input.checkpointDigest,
  });

  const artifact = buildFhvConfigurationFreezeArtifact({
    configurationFreeze,
    datasetQualificationReceiptDigest: input.datasetQualificationReceiptDigest,
    sourceReceiptDigests: input.sourceReceiptDigests,
  });
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  writeFileAtomicExclusive(artifactPath, json);
  return { artifactPath, artifact: readFhvConfigurationFreezeArtifact(artifactPath) };
}

export function resolveConfigurationFreezeFromArtifact(
  artifactPath: string,
): FhvConfigurationFreezeV1 {
  return readFhvConfigurationFreezeArtifact(artifactPath).configurationFreeze;
}

export { computeFhvConfigurationFreezeDigest };
