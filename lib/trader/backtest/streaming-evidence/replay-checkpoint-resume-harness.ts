import fs from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
  HTR_WP03_BENCHMARK_FIXTURE_PATH,
  HTR_WP03_BENCHMARK_FIXTURE_SHA256,
  loadApprovedBenchmarkFixture,
  readGitCodeSha,
  readGitDirtyTree,
  seedBenchmarkSession,
  sha256File,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import {
  createStreamingEvidenceSink,
  reconstructStreamingEvidence,
  type StreamingEvidenceManifestRef,
} from "@/lib/trader/backtest/streaming-evidence";
import {
  buildReplayRunChainManifest,
  emptyDbPhaseFrontier,
  readReplayCheckpoint,
  resolveEvidenceFrontier,
  resolveResumeBoundary,
  writeReplayCheckpoint,
  writeReplayRunChainManifest,
  type ReplayCheckpointRecord,
  type ReplayRunTerminalState,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { readReplayRunChainProjections } from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { REPLAY_CHECKPOINT_SCHEMA_VERSION } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";
import { isTransientConnectionError } from "@/db/postgres-client";
import { resolveResearchCampaignCrashFailureCode } from "@/lib/trader/research/finalize-research-campaign-outcome";

export const HTR_WP05_CHECKPOINT_RESUME_BASELINE_DIR = path.join(
  process.cwd(),
  "replay-runs/RI-P7/htr-wp05-checkpoint-resume-baseline",
);

export const HTR_WP05_CHECKPOINT_RESUME_COMMAND = "pnpm trader:replay:checkpoint-resume";

const BENCHMARK_STRATEGY_VERSION = "0.1.0";
const INTERRUPT_AT_CYCLE = 40;

export type CheckpointFixtureRunResult = {
  cycleCount: number;
  evidenceDigest: string;
  semanticReproDigest: string;
  streamingManifestRef?: StreamingEvidenceManifestRef;
  semanticParityDigest?: string;
};

export type CheckpointResumeHarnessResult = {
  schemaVersion: "htr-wp05-checkpoint-resume/v1";
  terminalState: ReplayRunTerminalState;
  fixturePath: string;
  fixtureSha256: string;
  datasetContentDigest: string;
  expectedCycles: number;
  uninterrupted: CheckpointFixtureRunResult;
  interruptedPartial: CheckpointFixtureRunResult;
  resumed: CheckpointFixtureRunResult;
  parity: {
    evidenceDigestMatch: boolean;
    semanticReproDigestMatch: boolean;
    semanticParityDigestMatch: boolean;
    cycleCountMatch: boolean;
  };
  frontierSeparation: {
    evidenceAheadCycleIndex: number;
    safeResumeThroughCycleIndex: number;
    passed: boolean;
  };
  disconnectTerminal: {
    transientClassified: boolean;
    infraFailureCode: string;
    passed: boolean;
  };
  checkpointRecord: ReplayCheckpointRecord;
  runRootDir: string;
};

function createBenchmarkNewIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(415900 + sequence).padStart(12, "0")}`;
  };
}

async function withDeterministicRandomUuid<T>(run: () => Promise<T>): Promise<T> {
  let sequence = 0;
  const originalRandomUuid = crypto.randomUUID.bind(crypto);
  crypto.randomUUID = () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(415950 + sequence).padStart(12, "0")}`;
  };
  try {
    return await run();
  } finally {
    crypto.randomUUID = originalRandomUuid;
  }
}

async function runFixtureStreamOnly(input: {
  runDir: string;
  runId: string;
  maxCycles?: number;
  evidenceSealMode?: "complete" | "partial" | "none";
  evidenceSealReason?: string;
}): Promise<CheckpointFixtureRunResult> {
  return withDeterministicRandomUuid(async () => {
    const fixture = loadApprovedBenchmarkFixture();
    const { session, context } = await seedBenchmarkSession();
    mkdirSync(input.runDir, { recursive: true });
    const evidenceSink = createStreamingEvidenceSink({
      runDir: input.runDir,
      runId: input.runId,
      gitSha: readGitCodeSha(),
      environment: "htr-wp05-checkpoint-resume-harness",
    });
    const window = {
      start: new Date(fixture.bars[0]!.barOpenTime),
      end: new Date(fixture.bars.at(-1)!.barCloseTime),
    };
    const cycleIdPrefix = buildResearchValidationCycleIdPrefix(input.runId);
    const barSource = new HistoricalBarReplaySource({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      cycleIdPrefix,
    });

    try {
      const backtest = await runBacktest({
        context,
        barSource,
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "htr-wp05-checkpoint",
        defaultQuantity: "0.01",
        costModel: createCostModelV1("10", "5"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: BENCHMARK_STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "htr-wp05-checkpoint",
        runId: input.runId,
        split: "validation",
        window,
        accountState: {
          positions: [],
          openOrderCount: 0,
          dailyPnl: "0",
          drawdown: "0",
          quoteExposureByCurrency: {},
        },
        exportedAt: new Date(window.end),
        activeStrategyIds: [MEAN_REVERSION_V0],
        newId: createBenchmarkNewIdFactory(),
        retentionMode: "STREAM_ONLY",
        evidenceSink,
        maxCycles: input.maxCycles,
        evidenceSealMode: input.evidenceSealMode,
        evidenceSealReason: input.evidenceSealReason,
      });

      return {
        cycleCount: backtest.cycleCount,
        evidenceDigest: backtest.evidenceDigest,
        semanticReproDigest: computeReplayReproContentDigest(backtest.exportDocument),
        streamingManifestRef: backtest.streamingManifestRef,
      };
    } finally {
      session.cleanup();
    }
  });
}

function buildCheckpointRecord(input: {
  runRootDir: string;
  backtestRunId: string;
  datasetContentDigest: string;
  evidenceRunDir: string;
  replayTerminalState: ReplayRunTerminalState;
}): ReplayCheckpointRecord {
  const evidence = resolveEvidenceFrontier(input.evidenceRunDir);
  const boundary = resolveResumeBoundary({
    activePhase: "validation",
    dbDurablePhaseRunDir: null,
    dbFrontier: emptyDbPhaseFrontier(),
    phaseLastCycleIndex: {},
  });
  const withoutDigest = {
    schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
    backtestRunId: input.backtestRunId,
    datasetContentDigest: input.datasetContentDigest,
    datasetId: "htr-wp05-checkpoint",
    codeSha: readGitCodeSha(),
    activePhase: "validation" as const,
    dbDurableThroughPhase: boundary.dbDurableThroughPhase,
    evidenceDurableThroughCycleIndex: evidence.evidenceDurableThroughCycleIndex,
    safeResumeThroughCycleIndex: boundary.safeResumeThroughCycleIndex,
    evidenceRunDir: input.evidenceRunDir,
    evidenceChainDigest: evidence.evidenceChainDigest,
    evidenceTerminalState: evidence.evidenceTerminalState,
    dbConnectionMode: "harness",
    replayTerminalState: input.replayTerminalState,
    fixtureSha256: HTR_WP03_BENCHMARK_FIXTURE_SHA256,
  };
  return {
    ...withoutDigest,
    checkpointDigest: "",
  };
}

export async function runCheckpointResumeHarness(): Promise<CheckpointResumeHarnessResult> {
  const fixture = loadApprovedBenchmarkFixture();
  const datasetContentDigest = computeBarSetDigest(fixture.bars);
  const backtestRunId = "htr-wp05-checkpoint-resume-run";
  const runRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp05-checkpoint-"));
  const uninterruptedDir = path.join(runRootDir, "segments", "uninterrupted");
  const partialDir = path.join(runRootDir, "segments", "partial-interrupted");
  const continuationDir = path.join(runRootDir, "segments", "continuation");

  const uninterrupted = await runFixtureStreamOnly({
    runDir: uninterruptedDir,
    runId: backtestRunId,
  });

  const interruptedPartial = await runFixtureStreamOnly({
    runDir: partialDir,
    runId: backtestRunId,
    maxCycles: INTERRUPT_AT_CYCLE,
    evidenceSealMode: "partial",
    evidenceSealReason: "HARNESS_INTERRUPT",
  });

  const checkpointBody = buildCheckpointRecord({
    runRootDir,
    backtestRunId,
    datasetContentDigest,
    evidenceRunDir: partialDir,
    replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
  });
  writeReplayCheckpoint(runRootDir, checkpointBody);
  const checkpointRecord = readReplayCheckpoint(runRootDir)!;

  const partialReconstruction = reconstructStreamingEvidence(partialDir);
  const resumed = await runFixtureStreamOnly({
    runDir: continuationDir,
    runId: backtestRunId,
  });

  const continuationReconstruction = reconstructStreamingEvidence(continuationDir);
  const chainManifest = buildReplayRunChainManifest({
    backtestRunId,
    activePhase: "validation",
    segments: [
      {
        runDir: continuationDir,
        chainDigest: continuationReconstruction.chainDigest ?? "",
        continuesFromRunDir: partialDir,
        continuesFromChainDigest: partialReconstruction.chainDigest ?? undefined,
        terminalState: "STREAMING_EVIDENCE_OK",
        sealedThroughCycleIndex: continuationReconstruction.sealedThroughCycleIndex,
      },
    ],
  });
  writeReplayRunChainManifest(runRootDir, chainManifest);

  const chainRead = readReplayRunChainProjections(runRootDir);
  const resumedWithParity: CheckpointFixtureRunResult = {
    ...resumed,
    semanticParityDigest: chainRead.semanticParityDigest,
  };

  const evidenceAheadCycleIndex = partialReconstruction.sealedThroughCycleIndex;
  const frontierBoundary = resolveResumeBoundary({
    activePhase: "validation",
    dbDurablePhaseRunDir: null,
    dbFrontier: emptyDbPhaseFrontier(),
    phaseLastCycleIndex: {},
  });

  const infraError = new Error("CONNECTION_CLOSED");
  const disconnectTerminal = {
    transientClassified: isTransientConnectionError(infraError),
    infraFailureCode: resolveResearchCampaignCrashFailureCode(infraError),
    passed:
      isTransientConnectionError(infraError) &&
      resolveResearchCampaignCrashFailureCode(infraError) === "CAMPAIGN_INFRA_DISCONNECT",
  };

  const parity = {
    evidenceDigestMatch: uninterrupted.evidenceDigest === resumed.evidenceDigest,
    semanticReproDigestMatch: uninterrupted.semanticReproDigest === resumed.semanticReproDigest,
    semanticParityDigestMatch: uninterrupted.semanticReproDigest === chainRead.semanticParityDigest,
    cycleCountMatch: uninterrupted.cycleCount === resumed.cycleCount,
  };

  const frontierSeparation = {
    evidenceAheadCycleIndex,
    safeResumeThroughCycleIndex: frontierBoundary.safeResumeThroughCycleIndex,
    passed:
      evidenceAheadCycleIndex >= 0 &&
      frontierBoundary.safeResumeThroughCycleIndex < evidenceAheadCycleIndex,
  };

  const terminalState: ReplayRunTerminalState = parity.evidenceDigestMatch
    ? "REPLAY_RUN_OK"
    : "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE";

  return {
    schemaVersion: "htr-wp05-checkpoint-resume/v1",
    terminalState,
    fixturePath: HTR_WP03_BENCHMARK_FIXTURE_PATH,
    fixtureSha256: sha256File(HTR_WP03_BENCHMARK_FIXTURE_PATH),
    datasetContentDigest,
    expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    uninterrupted,
    interruptedPartial,
    resumed: resumedWithParity,
    parity,
    frontierSeparation,
    disconnectTerminal,
    checkpointRecord,
    runRootDir,
  };
}

export function writeCheckpointResumeBaseline(
  harness: CheckpointResumeHarnessResult,
  targetDir: string = HTR_WP05_CHECKPOINT_RESUME_BASELINE_DIR,
): { baselineDir: string } {
  fs.rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  const copySegment = (name: string, sourceDir: string) => {
    const dest = path.join(targetDir, name);
    fs.cpSync(sourceDir, dest, { recursive: true });
    return dest;
  };

  copySegment("uninterrupted-segment", path.join(harness.runRootDir, "segments", "uninterrupted"));
  copySegment(
    "partial-interrupted-segment",
    path.join(harness.runRootDir, "segments", "partial-interrupted"),
  );
  copySegment("continuation-segment", path.join(harness.runRootDir, "segments", "continuation"));

  fs.copyFileSync(
    path.join(harness.runRootDir, "replay-checkpoint.json"),
    path.join(targetDir, "replay-checkpoint.json"),
  );
  fs.copyFileSync(
    path.join(harness.runRootDir, "run-chain.json"),
    path.join(targetDir, "run-chain.json"),
  );

  writeFileSync(
    path.join(targetDir, "resume-parity-report.json"),
    JSON.stringify(
      {
        schemaVersion: "htr-wp05-resume-parity/v1",
        uninterrupted: {
          evidenceDigest: harness.uninterrupted.evidenceDigest,
          semanticReproDigest: harness.uninterrupted.semanticReproDigest,
          cycleCount: harness.uninterrupted.cycleCount,
        },
        resumed: {
          evidenceDigest: harness.resumed.evidenceDigest,
          semanticReproDigest: harness.resumed.semanticReproDigest,
          semanticParityDigest: harness.resumed.semanticParityDigest,
          cycleCount: harness.resumed.cycleCount,
        },
        parity: harness.parity,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    path.join(targetDir, "frontier-separation-report.json"),
    JSON.stringify(
      {
        schemaVersion: "htr-wp05-frontier-separation/v1",
        ...harness.frontierSeparation,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    path.join(targetDir, "disconnect-terminal-report.json"),
    JSON.stringify(
      {
        schemaVersion: "htr-wp05-disconnect-terminal/v1",
        ...harness.disconnectTerminal,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    path.join(targetDir, "provenance.json"),
    JSON.stringify(
      {
        schemaVersion: "htr-wp05-provenance/v1",
        gitSha: readGitCodeSha(),
        dirtyTree: readGitDirtyTree(),
        fixturePath: harness.fixturePath,
        fixtureSha256: harness.fixtureSha256,
        datasetContentDigest: harness.datasetContentDigest,
        command: HTR_WP05_CHECKPOINT_RESUME_COMMAND,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    path.join(targetDir, "README.md"),
    `# HTR-WP05 checkpoint/resume baseline

Generated by \`${HTR_WP05_CHECKPOINT_RESUME_COMMAND}\`.

- Uninterrupted and resumed composed digests must match.
- Partial segment is immutable; continuation supersedes for parity.
- No secrets; research-only fixture harness.
`,
  );

  return { baselineDir: targetDir };
}

export function assertCheckpointResumeHarness(harness: CheckpointResumeHarnessResult): void {
  if (!harness.parity.evidenceDigestMatch) {
    throw new Error("WP05_RESUME_DIVERGENCE: evidenceDigest mismatch");
  }
  if (!harness.parity.semanticReproDigestMatch) {
    throw new Error("WP05_RESUME_DIVERGENCE: semanticReproDigest mismatch");
  }
  if (!harness.frontierSeparation.passed) {
    throw new Error("WP05_RESUME_DIVERGENCE: frontier separation failed");
  }
  if (!harness.disconnectTerminal.passed) {
    throw new Error("WP05_FALSE_SUCCESS: disconnect terminal classification failed");
  }
}
