/**
 * Instrumentation-disabled process-parity gate (before A-P0-1).
 *
 * Captures/compares against:
 *   .artifacts/fhv-official-scale-profile/reference/head-1336ed3-process-parity-snapshot.v1.json
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { clearFhvSyntheticProfilingHooks } from "@/lib/trader/observability/fhv-synthetic-profiling-hook";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";

import { TARGET_CYCLE_COUNT } from "@/tests/fhv/official-scale/blocking/fhv-official-scale-constants";
import {
  buildFhvOfficialScaleHarnessContext,
  extractFhvOfficialScaleParitySnapshot,
  setupFhvOfficialScaleLaunchPaths,
  toFhvOfficialScaleLaunchInput,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-harness";
import {
  assertInstrumentationParityAgainstReference,
  enrichParitySnapshotFromRunDir,
  resolveProfileRoot,
  resolveReferenceSnapshotPath,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-profile-harness";

async function main(): Promise<void> {
  clearFhvSyntheticProfilingHooks();

  const profileRoot = resolveProfileRoot();
  const referencePath = resolveReferenceSnapshotPath(profileRoot);
  mkdirSync(join(profileRoot, "reference"), { recursive: true });

  const harnessBase = buildFhvOfficialScaleHarnessContext();
  const gateArtifactRoot = join(profileRoot, "instrumentation-parity-gate");
  mkdirSync(gateArtifactRoot, { recursive: true });

  const harness = {
    ...harnessBase,
    artifactRoot: gateArtifactRoot,
  };

  const runId = `fhv-profile-instrumentation-parity-${Date.now()}`;
  const paths = setupFhvOfficialScaleLaunchPaths({
    harness,
    runId,
    maxCycles: TARGET_CYCLE_COUNT,
    targetCycleCount: TARGET_CYCLE_COUNT,
  });

  console.log("[fhv-profile-parity] running profiling-disabled control at TARGET_CYCLE_COUNT=4509");
  const result = await executeFhvFullHistoricalLaunch(
    toFhvOfficialScaleLaunchInput(paths, { maxCycles: TARGET_CYCLE_COUNT }),
  );

  const base = extractFhvOfficialScaleParitySnapshot({
    runDir: result.runDir,
    sourceFrontier: result.backtest?.sourceFrontier,
    semanticReproDigest: result.semanticReproDigest,
    classification: result.classification,
    accountingSequence: result.backtest?.accountingFrontierState?.accountingSequence,
    fillsCount: result.backtest?.accountingFrontierState?.consumedFillIds.length,
  });
  const enriched = enrichParitySnapshotFromRunDir(result.runDir, base);

  if (enriched.accountingSequence !== 4824 || enriched.fillsCount !== 314) {
    throw new Error(
      `BLOCKED_BY_OFFICIAL_SCALE_PROFILE_INSTRUMENTATION_SEMANTIC_DRIFT: expected accountingSequence=4824 fills=314 got ${enriched.accountingSequence}/${enriched.fillsCount}`,
    );
  }

  const { existsSync } = await import("node:fs");
  if (!existsSync(referencePath)) {
    throw new Error(
      `BLOCKED_BY_OFFICIAL_SCALE_PROFILE_INSTRUMENTATION_SEMANTIC_DRIFT: missing immutable reference at ${referencePath}`,
    );
  }

  assertInstrumentationParityAgainstReference({
    candidate: enriched,
    referencePath,
  });

  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    join(gateArtifactRoot, "candidate-parity-snapshot.v1.json"),
    `${JSON.stringify({ ...enriched, runDir: result.runDir }, null, 2)}\n`,
  );

  console.log("[fhv-profile-parity] PASS — profiling-disabled semantics match reference");
  console.log(`accountingSequence=${enriched.accountingSequence} fills=${enriched.fillsCount}`);
  console.log(`semanticReproDigest=${enriched.semanticReproDigest}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fhv-profile-parity] FAILED: ${message}`);
  process.exitCode = 1;
});
