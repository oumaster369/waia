/**
 * DEE-436 — Full Historical Validation launch CLI (`pnpm trader:fhv:run`).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  executeFhvFullHistoricalLaunch,
  FhvFullHistoricalLaunchError,
  resolveFhvFullLaunchRunDirectory,
  resumeFhvFullHistoricalLaunch,
  type FhvFullHistoricalLaunchInput,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import { readFhvConfigurationFreezeArtifact } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import { readFhvControlReplayReceipt } from "@/lib/trader/observability/fhv-control-replay-receipt";
import { readFhvDatasetQualificationReceipt } from "@/lib/trader/observability/fhv-dataset-qualification";
import { readFhvFullHistoricalAuthorizationReceipt } from "@/lib/trader/observability/fhv-full-historical-auth";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ABSOLUTE_SAFE_PATH = /^\/(?:[^\0/]+\/)*[^\0/]+$/;

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      throw new FhvFullHistoricalLaunchError(
        "UNKNOWN_ARG",
        `Unexpected positional argument: ${token}`,
      );
    }
    if (token === "--bounded-fixture" || token === "--resume") {
      parsed.set(token, true);
      continue;
    }
    const value = tokens[index + 1]?.trim();
    if (!value) {
      throw new FhvFullHistoricalLaunchError("MISSING_FLAG_VALUE", `Missing value for ${token}`);
    }
    parsed.set(token, value);
    index += 1;
  }
  return parsed;
}

export function resolveFhvFullRunCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): FhvFullHistoricalLaunchInput & { resume?: boolean } {
  const flags = parseArgv(argv);
  const allowed = new Set([
    "--release-sha",
    "--release-tag",
    "--run-id",
    "--organization-id",
    "--operator-id",
    "--artifact-root",
    "--configuration-freeze-path",
    "--authorization-receipt-path",
    "--authorization-receipt-digest",
    "--dataset-qualification-receipt-path",
    "--dataset-root",
    "--manifest-path",
    "--checkout-identity-proof-path",
    "--control-replay-receipt-path",
    "--repo-path",
    "--bounded-fixture",
    "--resume",
    "--synthetic-scale-authority-path",
    "--run-dir",
    "--max-cycles",
    "--throughput-host-qualification-receipt-path",
  ]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) {
      throw new FhvFullHistoricalLaunchError("UNKNOWN_FLAG", `Unknown flag: ${key}`);
    }
  }

  const boundedFixture = flags.has("--bounded-fixture");
  const resume = flags.has("--resume");
  const releaseSha =
    (flags.get("--release-sha") as string | undefined) ?? env.FHV_RELEASE_SHA?.trim();
  const releaseTag =
    (flags.get("--release-tag") as string | undefined) ?? env.FHV_RELEASE_TAG?.trim();
  const runId = (flags.get("--run-id") as string | undefined) ?? env.FHV_RUN_ID?.trim();
  const organizationId =
    (flags.get("--organization-id") as string | undefined) ?? env.FHV_ORGANIZATION_ID?.trim();
  const operatorId =
    (flags.get("--operator-id") as string | undefined) ?? env.FHV_OPERATOR_ID?.trim();
  const artifactRoot =
    (flags.get("--artifact-root") as string | undefined) ?? env.FHV_ARTIFACT_ROOT?.trim();
  const configurationFreezePath =
    (flags.get("--configuration-freeze-path") as string | undefined) ??
    env.FHV_CONFIGURATION_FREEZE_PATH?.trim();
  const authorizationReceiptPath =
    (flags.get("--authorization-receipt-path") as string | undefined) ??
    env.FHV_AUTHORIZATION_RECEIPT_PATH?.trim();
  const authorizationReceiptDigest =
    (flags.get("--authorization-receipt-digest") as string | undefined) ??
    env.FHV_AUTHORIZATION_RECEIPT_DIGEST?.trim();
  const datasetQualificationReceiptPath =
    (flags.get("--dataset-qualification-receipt-path") as string | undefined) ??
    env.FHV_DATASET_QUALIFICATION_RECEIPT_PATH?.trim();
  const datasetRoot =
    (flags.get("--dataset-root") as string | undefined) ?? env.FHV_DATASET_ROOT?.trim();
  const manifestPath =
    (flags.get("--manifest-path") as string | undefined) ?? env.FHV_MANIFEST_PATH?.trim();
  const checkoutIdentityProofPath =
    (flags.get("--checkout-identity-proof-path") as string | undefined) ??
    env.FHV_CHECKOUT_IDENTITY_PROOF_PATH?.trim();
  const controlReplayReceiptPath =
    (flags.get("--control-replay-receipt-path") as string | undefined) ??
    env.FHV_CONTROL_REPLAY_RECEIPT_PATH?.trim();
  const repoPath = (flags.get("--repo-path") as string | undefined) ?? env.FHV_REPO_PATH?.trim();
  const syntheticScaleAuthorityPath =
    (flags.get("--synthetic-scale-authority-path") as string | undefined) ??
    env.FHV_SYNTHETIC_SCALE_AUTHORITY_PATH?.trim();
  const runDirOverride = (flags.get("--run-dir") as string | undefined) ?? env.FHV_RUN_DIR?.trim();
  const throughputHostQualificationReceiptPath = (
    flags.get("--throughput-host-qualification-receipt-path") as string | undefined
  )?.trim();
  const maxCyclesRaw =
    (flags.get("--max-cycles") as string | undefined) ?? env.FHV_MAX_CYCLES?.trim();
  const maxCycles = maxCyclesRaw ? Number.parseInt(maxCyclesRaw, 10) : undefined;
  if (maxCyclesRaw && (!Number.isFinite(maxCycles) || maxCycles! < 1)) {
    throw new FhvFullHistoricalLaunchError(
      "INVALID_MAX_CYCLES",
      "max-cycles must be a positive integer.",
    );
  }

  if (!releaseSha || !FULL_SHA.test(releaseSha)) {
    throw new FhvFullHistoricalLaunchError(
      "INVALID_RELEASE_SHA",
      "release-sha must be a full git SHA.",
    );
  }
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new FhvFullHistoricalLaunchError("INVALID_RUN_ID", "run-id is invalid.");
  }
  if (!organizationId || !UUID_V4.test(organizationId)) {
    throw new FhvFullHistoricalLaunchError(
      "INVALID_ORGANIZATION_ID",
      "organization-id must be UUID v4.",
    );
  }
  if (!operatorId?.trim()) {
    throw new FhvFullHistoricalLaunchError("INVALID_OPERATOR_ID", "operator-id is required.");
  }
  if (!artifactRoot || !ABSOLUTE_SAFE_PATH.test(artifactRoot) || artifactRoot.includes("..")) {
    throw new FhvFullHistoricalLaunchError(
      "INVALID_ARTIFACT_ROOT",
      "--artifact-root must be an absolute safe path.",
    );
  }
  if (!configurationFreezePath) {
    throw new FhvFullHistoricalLaunchError(
      "CONFIGURATION_FREEZE_PATH_REQUIRED",
      "--configuration-freeze-path is required.",
    );
  }
  if (!authorizationReceiptPath) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_RECEIPT_PATH_REQUIRED",
      "--authorization-receipt-path is required.",
    );
  }
  if (!datasetQualificationReceiptPath) {
    throw new FhvFullHistoricalLaunchError(
      "DATASET_QUALIFICATION_RECEIPT_PATH_REQUIRED",
      "--dataset-qualification-receipt-path is required.",
    );
  }

  const resolvedAuthorizationReceiptDigest =
    authorizationReceiptDigest ??
    readFhvFullHistoricalAuthorizationReceipt(authorizationReceiptPath).authorizationReceiptDigest;

  if (!boundedFixture && (!datasetRoot || !manifestPath)) {
    throw new FhvFullHistoricalLaunchError(
      "OFFICIAL_DATASET_PATHS_REQUIRED",
      "Official run requires --dataset-root and --manifest-path.",
    );
  }

  if (!boundedFixture && !checkoutIdentityProofPath && !(repoPath && releaseTag)) {
    throw new FhvFullHistoricalLaunchError(
      "CHECKOUT_IDENTITY_REQUIRED",
      "Official run requires --checkout-identity-proof-path or --repo-path with --release-tag.",
    );
  }

  if (!boundedFixture && !controlReplayReceiptPath) {
    throw new FhvFullHistoricalLaunchError(
      "CONTROL_REPLAY_RECEIPT_PATH_REQUIRED",
      "Official run requires --control-replay-receipt-path with PASS receipt.",
    );
  }

  readFhvConfigurationFreezeArtifact(configurationFreezePath);
  readFhvDatasetQualificationReceipt(datasetQualificationReceiptPath);
  if (controlReplayReceiptPath) {
    readFhvControlReplayReceipt(controlReplayReceiptPath);
  }

  if (
    runDirOverride &&
    (!ABSOLUTE_SAFE_PATH.test(runDirOverride) || runDirOverride.includes(".."))
  ) {
    throw new FhvFullHistoricalLaunchError(
      "INVALID_RUN_DIR",
      "--run-dir must be an absolute safe path.",
    );
  }

  const runDir =
    runDirOverride ??
    (runId && artifactRoot ? resolveFhvFullLaunchRunDirectory(artifactRoot, runId) : undefined);

  return {
    releaseSha,
    releaseTag,
    runId,
    organizationId,
    operatorId,
    artifactRoot,
    configurationFreezePath,
    authorizationReceiptPath,
    authorizationReceiptDigest: resolvedAuthorizationReceiptDigest,
    datasetQualificationReceiptPath,
    datasetRoot,
    manifestPath,
    checkoutIdentityProofPath,
    controlReplayReceiptPath,
    repoPath,
    rehearsalMode: env.FHV_REHEARSAL_MODE === "true",
    livePathInvoked: env.FHV_LIVE_PATH_INVOKED === "true",
    holdoutAccessRequested: env.FHV_HOLDOUT_ACCESS_REQUESTED === "true",
    boundedFixture,
    ...(maxCycles != null ? { maxCycles } : {}),
    ...(syntheticScaleAuthorityPath ? { syntheticScaleAuthorityPath } : {}),
    ...(runDir ? { runDir } : {}),
    ...(throughputHostQualificationReceiptPath ? { throughputHostQualificationReceiptPath } : {}),
    resume,
  };
}

async function main(): Promise<void> {
  const { resume, ...config } = resolveFhvFullRunCliConfig();
  mkdirSync(join(config.artifactRoot, "RI-P7", "fhv-full-historical"), { recursive: true });
  const result = resume
    ? await resumeFhvFullHistoricalLaunch(config)
    : await executeFhvFullHistoricalLaunch(config);
  process.stdout.write(
    `[fhv-full-run] classification=${result.classification} receipt=${result.receiptPath}\n`,
  );
  if (result.semanticReproDigest) {
    process.stdout.write(`[fhv-full-run] semanticReproDigest=${result.semanticReproDigest}\n`);
  }
}

const invokedDirectly = process.argv[1]?.includes("fhv-full-run-cli.ts") ?? false;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    const code =
      error instanceof FhvFullHistoricalLaunchError
        ? error.code
        : error instanceof Error && "code" in error
          ? String((error as { code?: string }).code)
          : "FAILED";
    process.stderr.write(`[fhv-full-run] ${code}: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
