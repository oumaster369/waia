/**
 * DEE-436 — FHV control replay CLI (two-run digest compare on bounded fixture).
 *
 * Usage:
 *   pnpm trader:fhv:control-replay -- \
 *     --release-sha <40-hex> \
 *     --organization-id <uuid> \
 *     --operator-id <id> \
 *     [--artifact-root /abs/path]
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION } from "@/lib/trader/observability/fhv-full-historical-auth";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BENCHMARK_STRATEGY_VERSION = "0.1.0";

export type FhvControlReplayResult = Readonly<{
  schemaVersion: "fhv-control-replay/v1";
  classification: "CONTROL_REPLAY=PASS" | "CONTROL_REPLAY=FAIL";
  runOneDigest?: string;
  runTwoDigest?: string;
  digestsMatch?: boolean;
  failureReason?: string;
}>;

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

export function resolveFhvControlReplayCliConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv.slice(2),
): {
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  artifactRoot?: string;
} {
  const flags = parseArgv(argv);
  const allowed = new Set([
    "--release-sha",
    "--organization-id",
    "--operator-id",
    "--artifact-root",
  ]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown flag: ${key}`);
    }
  }

  const releaseSha = flags.get("--release-sha") ?? env.FHV_RELEASE_SHA?.trim();
  const organizationId =
    flags.get("--organization-id") ??
    env.FHV_ORGANIZATION_ID?.trim() ??
    "00000000-0000-4000-8000-000000000436";
  const operatorId =
    flags.get("--operator-id") ?? env.FHV_OPERATOR_ID?.trim() ?? "control-replay-operator";
  const artifactRoot = flags.get("--artifact-root") ?? env.FHV_ARTIFACT_ROOT?.trim();

  if (!releaseSha) {
    throw new Error("FHV_RELEASE_SHA or --release-sha required");
  }
  if (!FULL_SHA.test(releaseSha)) {
    throw new Error(`INVALID_RELEASE_SHA: ${releaseSha}`);
  }
  if (!UUID_V4.test(organizationId)) {
    throw new Error(`INVALID_ORGANIZATION_ID: ${organizationId}`);
  }

  return {
    releaseSha,
    organizationId,
    operatorId,
    ...(artifactRoot ? { artifactRoot } : {}),
  };
}

export async function runFhvControlReplay(input: {
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  artifactRoot?: string;
}): Promise<FhvControlReplayResult> {
  if (!FULL_SHA.test(input.releaseSha)) {
    return {
      schemaVersion: "fhv-control-replay/v1",
      classification: "CONTROL_REPLAY=FAIL",
      failureReason: "INVALID_RELEASE_SHA",
    };
  }

  const artifactRoot = input.artifactRoot ?? mkdtempSync(join(tmpdir(), "fhv-control-replay-"));
  const shouldCleanup = !input.artifactRoot;
  const strategyVersion = `${MEAN_REVERSION_V0}@${BENCHMARK_STRATEGY_VERSION}`;
  const strategyDigest = computeSemanticSha256Hex({ strategyVersion });
  const datasetDigest = "bounded-control-replay-digest";
  const manifestDigest = "bounded-control-replay-manifest";
  const checkpointDigest = "bounded-control-replay-checkpoint";

  const { buildFhvConfigurationFreeze } =
    await import("@/lib/trader/observability/fhv-configuration-freeze");

  try {
    const base = {
      authorization: FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION,
      releaseSha: input.releaseSha,
      organizationId: input.organizationId,
      operatorId: input.operatorId,
      datasetDigest,
      manifestDigest,
      strategyVersions: [strategyVersion] as const,
      strategyDigests: [strategyDigest] as const,
      checkpointDigest,
      artifactRoot,
      boundedFixture: true,
      maxCycles: 15,
    };

    const runOneId = `fhv-control-replay-1-${input.releaseSha.slice(0, 8)}`;
    const runTwoId = `fhv-control-replay-2-${input.releaseSha.slice(0, 8)}`;

    const freezeOne = buildFhvConfigurationFreeze({
      ...base,
      runId: runOneId,
    });
    const freezeTwo = buildFhvConfigurationFreeze({
      ...base,
      runId: runTwoId,
    });

    const resultOne = await executeFhvFullHistoricalLaunch({
      ...base,
      runId: runOneId,
      configurationFreezeDigest: freezeOne.configurationFreezeDigest,
    });
    const resultTwo = await executeFhvFullHistoricalLaunch({
      ...base,
      runId: runTwoId,
      configurationFreezeDigest: freezeTwo.configurationFreezeDigest,
    });

    const runOneDigest = resultOne.semanticReproDigest;
    const runTwoDigest = resultTwo.semanticReproDigest;
    const cycleCountsMatch =
      resultOne.backtest?.cycleCount != null &&
      resultTwo.backtest?.cycleCount != null &&
      resultOne.backtest.cycleCount === resultTwo.backtest.cycleCount;
    const digestsMatch =
      runOneDigest != null &&
      runTwoDigest != null &&
      runOneDigest === runTwoDigest &&
      cycleCountsMatch;

    if (!digestsMatch) {
      return {
        schemaVersion: "fhv-control-replay/v1",
        classification: "CONTROL_REPLAY=FAIL",
        runOneDigest,
        runTwoDigest,
        digestsMatch: false,
        failureReason: cycleCountsMatch ? "SEMANTIC_REPRO_DIGEST_MISMATCH" : "CYCLE_COUNT_MISMATCH",
      };
    }

    return {
      schemaVersion: "fhv-control-replay/v1",
      classification: "CONTROL_REPLAY=PASS",
      runOneDigest,
      runTwoDigest,
      digestsMatch: true,
    };
  } catch (error) {
    return {
      schemaVersion: "fhv-control-replay/v1",
      classification: "CONTROL_REPLAY=FAIL",
      failureReason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (shouldCleanup) {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  try {
    const config = resolveFhvControlReplayCliConfig();
    const result = await runFhvControlReplay(config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${result.classification}\n`);
    process.exitCode = result.classification === "CONTROL_REPLAY=PASS" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`[fhv-control-replay] FAILED: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1]?.includes("fhv-control-replay-cli.ts") ?? false;

if (invokedDirectly) {
  void main();
}
