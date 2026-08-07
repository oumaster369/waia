/**
 * DEE-436 — FHV configuration freeze artifact CLI (`pnpm trader:fhv:freeze-config`).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import {
  assertFhvDatasetQualificationReceiptForExecution,
  type FhvExecutionIdentity,
} from "@/lib/trader/observability/fhv-artifact-authority-chain";
import { writeFhvConfigurationFreezeArtifactAtomic } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function parseArgv(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const value = tokens[index + 1]?.trim();
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    parsed.set(token, value);
    index += 1;
  }
  return parsed;
}

export function resolveFhvFreezeConfigCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
) {
  const flags = parseArgv(argv);
  const releaseSha = flags.get("--release-sha") ?? env.FHV_RELEASE_SHA?.trim();
  const releaseTag = flags.get("--release-tag") ?? env.FHV_RELEASE_TAG?.trim();
  const runId = flags.get("--run-id") ?? env.FHV_RUN_ID?.trim();
  const organizationId = flags.get("--organization-id") ?? env.FHV_ORGANIZATION_ID?.trim();
  const operatorId = flags.get("--operator-id") ?? env.FHV_OPERATOR_ID?.trim();
  const artifactDir = flags.get("--artifact-dir") ?? env.FHV_ARTIFACT_DIR?.trim();
  const qualificationReceiptPath =
    flags.get("--qualification-receipt-path") ?? env.FHV_QUALIFICATION_RECEIPT_PATH?.trim();
  const checkpointDigest =
    flags.get("--checkpoint-digest") ??
    env.FHV_CHECKPOINT_DIGEST?.trim() ??
    "fhv-full-launch-checkpoint-v0";
  const strategyVersion = flags.get("--strategy-version") ?? `${MEAN_REVERSION_V0}@0.1.0`;
  const strategyDigest =
    flags.get("--strategy-digest") ?? computeSemanticSha256Hex({ strategyVersion });

  if (!releaseSha || !FULL_SHA.test(releaseSha)) {
    throw new Error("release-sha must be a full git SHA.");
  }
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("run-id is invalid.");
  }
  if (!organizationId || !UUID_V4.test(organizationId)) {
    throw new Error("organization-id must be UUID v4.");
  }
  if (!operatorId?.trim()) {
    throw new Error("operator-id is required.");
  }
  if (!artifactDir) {
    throw new Error("--artifact-dir is required.");
  }
  if (!qualificationReceiptPath) {
    throw new Error("--qualification-receipt-path is required.");
  }
  if (!releaseTag?.trim()) {
    throw new Error("release-tag is required.");
  }

  const identity: FhvExecutionIdentity = {
    releaseSha,
    releaseTag,
    organizationId,
    operatorId,
  };
  const qualificationReceipt = assertFhvDatasetQualificationReceiptForExecution({
    receiptPath: qualificationReceiptPath,
    identity,
  });

  return {
    releaseSha,
    releaseTag,
    runId,
    organizationId,
    operatorId,
    artifactDir,
    qualificationReceipt,
    checkpointDigest,
    strategyVersion,
    strategyDigest,
  };
}

async function main(): Promise<void> {
  const config = resolveFhvFreezeConfigCliConfig();
  mkdirSync(config.artifactDir, { recursive: true });
  const { artifactPath, artifact } = writeFhvConfigurationFreezeArtifactAtomic({
    artifactDir: config.artifactDir,
    releaseSha: config.releaseSha,
    releaseTag: config.releaseTag,
    runId: config.runId,
    organizationId: config.organizationId,
    operatorId: config.operatorId,
    datasetDigest: config.qualificationReceipt.datasetContentDigest,
    manifestDigest: config.qualificationReceipt.manifestSemanticDigest,
    strategyVersions: [config.strategyVersion],
    strategyDigests: [config.strategyDigest],
    checkpointDigest: config.checkpointDigest,
    datasetQualificationReceiptDigest: config.qualificationReceipt.qualificationReceiptDigest,
  });
  process.stdout.write(
    `[fhv-freeze-config] artifact=${artifactPath} digest=${artifact.configurationFreeze.configurationFreezeDigest}\n`,
  );
}

const invokedDirectly = process.argv[1]?.includes("fhv-freeze-config-cli.ts") ?? false;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`[fhv-freeze-config] FAILED: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
