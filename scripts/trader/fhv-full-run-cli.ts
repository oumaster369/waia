/**
 * DEE-436 — Full Historical Validation launch CLI (`pnpm trader:fhv:run`).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { buildFhvConfigurationFreeze } from "@/lib/trader/observability/fhv-configuration-freeze";
import {
  executeFhvFullHistoricalLaunch,
  FhvFullHistoricalLaunchError,
  type FhvFullHistoricalLaunchInput,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN } from "@/lib/trader/readiness/htr-fhv-run-contract-v0";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ABSOLUTE_SAFE_PATH = /^\/(?:[^\0/]+\/)*[^\0/]+$/;
const BENCHMARK_STRATEGY_VERSION = "0.1.0";

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      throw new FhvFullHistoricalLaunchError(
        "UNKNOWN_ARG",
        `Unexpected positional argument: ${token}`,
      );
    }
    if (token === "--bounded-fixture") {
      parsed.set(token, true);
      continue;
    }
    const value = argv[index + 1]?.trim();
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
): FhvFullHistoricalLaunchInput {
  const flags = parseArgv(argv);
  const allowed = new Set([
    "--release-sha",
    "--release-tag",
    "--run-id",
    "--organization-id",
    "--operator-id",
    "--artifact-root",
    "--dataset-digest",
    "--manifest-digest",
    "--checkpoint-digest",
    "--configuration-freeze-digest",
    "--strategy-version",
    "--strategy-digest",
    "--bounded-fixture",
  ]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) {
      throw new FhvFullHistoricalLaunchError("UNKNOWN_FLAG", `Unknown flag: ${key}`);
    }
  }

  const boundedFixture = flags.has("--bounded-fixture");
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
  const datasetDigest =
    (flags.get("--dataset-digest") as string | undefined) ??
    env.FHV_DATASET_DIGEST?.trim() ??
    (boundedFixture ? "bounded-fixture-digest" : HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN);
  const manifestDigest =
    (flags.get("--manifest-digest") as string | undefined) ??
    env.FHV_MANIFEST_DIGEST?.trim() ??
    (boundedFixture ? "bounded-fixture-manifest" : HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN);
  const checkpointDigest =
    (flags.get("--checkpoint-digest") as string | undefined) ??
    env.FHV_CHECKPOINT_DIGEST?.trim() ??
    "fhv-full-launch-checkpoint-v0";
  const strategyVersion =
    (flags.get("--strategy-version") as string | undefined) ??
    `${MEAN_REVERSION_V0}@${BENCHMARK_STRATEGY_VERSION}`;
  const strategyDigest =
    (flags.get("--strategy-digest") as string | undefined) ??
    computeSemanticSha256Hex({ strategyVersion });

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

  const configurationFreezeDigest =
    (flags.get("--configuration-freeze-digest") as string | undefined) ??
    env.FHV_CONFIGURATION_FREEZE_DIGEST?.trim() ??
    buildFhvConfigurationFreeze({
      releaseSha,
      releaseTag,
      runId,
      organizationId,
      operatorId,
      datasetDigest,
      manifestDigest,
      strategyVersions: [strategyVersion],
      strategyDigests: [strategyDigest],
      checkpointDigest,
    }).configurationFreezeDigest;

  return {
    authorization: env.FHV_FULL_HISTORICAL_AUTHORIZATION ?? "",
    releaseSha,
    releaseTag,
    runId,
    organizationId,
    operatorId,
    datasetDigest,
    manifestDigest,
    strategyVersions: [strategyVersion],
    strategyDigests: [strategyDigest],
    checkpointDigest,
    configurationFreezeDigest,
    artifactRoot,
    rehearsalMode: env.FHV_REHEARSAL_MODE === "true",
    livePathInvoked: env.FHV_LIVE_PATH_INVOKED === "true",
    holdoutAccessRequested: env.FHV_HOLDOUT_ACCESS_REQUESTED === "true",
    boundedFixture,
  };
}

async function main(): Promise<void> {
  const config = resolveFhvFullRunCliConfig();
  mkdirSync(join(config.artifactRoot, "RI-P7", "fhv-full-historical"), { recursive: true });
  const result = await executeFhvFullHistoricalLaunch(config);
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
