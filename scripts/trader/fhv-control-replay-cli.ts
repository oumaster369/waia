/**
 * DEE-436 — FHV control replay CLI (two-run digest compare on bounded fixture).
 *
 * Usage: pnpm trader:fhv:control-replay -- --artifact-root /abs/path --release-sha <sha> ...
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION } from "@/lib/trader/observability/fhv-full-historical-auth";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";

const FULL_SHA = /^[0-9a-f]{40}$/;
const BENCHMARK_STRATEGY_VERSION = "0.1.0";

export type FhvControlReplayResult = Readonly<{
  schemaVersion: "fhv-control-replay/v1";
  classification: "CONTROL_REPLAY=PASS" | "CONTROL_REPLAY=FAIL";
  runOneDigest?: string;
  runTwoDigest?: string;
  digestsMatch?: boolean;
  failureReason?: string;
}>;

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
    const digestsMatch =
      runOneDigest != null && runTwoDigest != null && runOneDigest === runTwoDigest;

    if (!digestsMatch) {
      return {
        schemaVersion: "fhv-control-replay/v1",
        classification: "CONTROL_REPLAY=FAIL",
        runOneDigest,
        runTwoDigest,
        digestsMatch: false,
        failureReason: "SEMANTIC_REPRO_DIGEST_MISMATCH",
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
  const releaseSha = process.env.FHV_RELEASE_SHA?.trim() ?? process.argv[3]?.trim();
  const organizationId =
    process.env.FHV_ORGANIZATION_ID?.trim() ?? "00000000-0000-4000-8000-0000000436";
  const operatorId = process.env.FHV_OPERATOR_ID?.trim() ?? "control-replay-operator";
  const artifactRoot = process.env.FHV_ARTIFACT_ROOT?.trim();

  if (!releaseSha) {
    process.stderr.write("[fhv-control-replay] FHV_RELEASE_SHA or --release-sha required\n");
    process.exit(1);
  }

  const result = await runFhvControlReplay({
    releaseSha,
    organizationId,
    operatorId,
    artifactRoot,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${result.classification}\n`);
  process.exitCode = result.classification === "CONTROL_REPLAY=PASS" ? 0 : 1;
}

const invokedDirectly = process.argv[1]?.includes("fhv-control-replay-cli.ts") ?? false;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`[fhv-control-replay] FAILED: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
