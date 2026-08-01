/**
 * DEE-436 — FHV full historical authorization receipt CLI (`pnpm trader:fhv:authorize-full`).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION } from "@/lib/trader/observability/fhv-full-historical-auth";
import { writeFhvFullHistoricalAuthorizationReceiptAtomic } from "@/lib/trader/observability/fhv-full-historical-auth";
import { readFhvConfigurationFreezeArtifact } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import { readFhvControlReplayReceipt } from "@/lib/trader/observability/fhv-control-replay-receipt";
import { readFhvDatasetQualificationReceipt } from "@/lib/trader/observability/fhv-dataset-qualification";

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

export function resolveFhvAuthorizeFullCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
) {
  const flags = parseArgv(argv);
  const authorization = env.FHV_FULL_HISTORICAL_AUTHORIZATION?.trim();
  if (authorization !== FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION) {
    throw new Error(
      "FHV_FULL_HISTORICAL_AUTHORIZATION must be AUTHORIZE-FULL-HISTORICAL-VALIDATION.",
    );
  }

  const releaseSha = flags.get("--release-sha") ?? env.FHV_RELEASE_SHA?.trim();
  const releaseTag = flags.get("--release-tag") ?? env.FHV_RELEASE_TAG?.trim();
  const runId = flags.get("--run-id") ?? env.FHV_RUN_ID?.trim();
  const organizationId = flags.get("--organization-id") ?? env.FHV_ORGANIZATION_ID?.trim();
  const operatorId = flags.get("--operator-id") ?? env.FHV_OPERATOR_ID?.trim();
  const receiptDir = flags.get("--receipt-dir") ?? env.FHV_RECEIPT_DIR?.trim();
  const freezeArtifactPath =
    flags.get("--configuration-freeze-path") ?? env.FHV_CONFIGURATION_FREEZE_PATH?.trim();
  const qualificationReceiptPath =
    flags.get("--qualification-receipt-path") ?? env.FHV_QUALIFICATION_RECEIPT_PATH?.trim();
  const controlReplayReceiptPath =
    flags.get("--control-replay-receipt-path") ?? env.FHV_CONTROL_REPLAY_RECEIPT_PATH?.trim();

  if (!releaseSha || !FULL_SHA.test(releaseSha)) {
    throw new Error("release-sha must be a full git SHA.");
  }
  if (!releaseTag?.trim()) {
    throw new Error("release-tag is required.");
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
  if (!receiptDir) {
    throw new Error("--receipt-dir is required.");
  }
  if (!freezeArtifactPath) {
    throw new Error("--configuration-freeze-path is required.");
  }
  if (!qualificationReceiptPath) {
    throw new Error("--qualification-receipt-path is required.");
  }
  const freezeArtifact = readFhvConfigurationFreezeArtifact(freezeArtifactPath);
  const qualificationReceipt = readFhvDatasetQualificationReceipt(qualificationReceiptPath);
  const controlReplayReceipt = controlReplayReceiptPath
    ? readFhvControlReplayReceipt(controlReplayReceiptPath)
    : undefined;

  return {
    releaseSha,
    releaseTag,
    runId,
    organizationId,
    operatorId,
    receiptDir,
    freezeArtifact,
    qualificationReceipt,
    controlReplayReceipt,
  };
}

async function main(): Promise<void> {
  const config = resolveFhvAuthorizeFullCliConfig();
  mkdirSync(config.receiptDir, { recursive: true });
  const { receiptPath, receipt } = writeFhvFullHistoricalAuthorizationReceiptAtomic({
    receiptDir: config.receiptDir,
    releaseSha: config.releaseSha,
    releaseTag: config.releaseTag,
    datasetQualificationReceiptDigest: config.qualificationReceipt.qualificationReceiptDigest,
    datasetDigest: config.freezeArtifact.configurationFreeze.datasetDigest,
    manifestDigest: config.freezeArtifact.configurationFreeze.manifestDigest,
    configurationFreezeDigest: config.freezeArtifact.configurationFreeze.configurationFreezeDigest,
    ...(config.controlReplayReceipt
      ? {
          controlReplayReceiptDigest: config.controlReplayReceipt.controlReplayReceiptDigest,
        }
      : {}),
    organizationId: config.organizationId,
    operatorId: config.operatorId,
    runId: config.runId,
  });
  process.stdout.write(
    `[fhv-authorize-full] receipt=${receiptPath} digest=${receipt.authorizationReceiptDigest}\n`,
  );
}

const invokedDirectly = process.argv[1]?.includes("fhv-authorize-full-cli.ts") ?? false;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`[fhv-authorize-full] FAILED: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
