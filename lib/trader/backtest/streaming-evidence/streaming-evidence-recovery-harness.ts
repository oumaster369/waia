import fs from "node:fs";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import {
  createStreamingEvidenceSink,
  MAX_BATCH_CYCLES,
  reconstructStreamingEvidence,
  StreamingEvidenceReader,
  type ReplayEvidenceSink,
  type ReplayRetentionMode,
  type StreamingEvidenceManifestRef,
} from "@/lib/trader/backtest/streaming-evidence";
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
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import {
  runResearchValidationBacktest,
  type ResearchValidationBacktestArtifactSink,
} from "@/lib/trader/research/research-backtest-runner";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";

export const HTR_WP04_STREAMING_EVIDENCE_BASELINE_DIR = path.join(
  process.cwd(),
  "replay-runs/RI-P7/htr-wp04-streaming-evidence-baseline",
);

export const HTR_WP04_STREAMING_EVIDENCE_COMMAND = "pnpm trader:replay:evidence-recovery";

const BENCHMARK_STRATEGY_VERSION = "0.1.0";

export type StreamingFixtureBacktestResult = {
  cycleCount: number;
  evidenceDigest: string;
  semanticReproDigest: string;
  cycleResultsLength: number;
  /** Buffered evidence-projection high-water (bounded by MAX_BATCH_CYCLES), not retained cycles. */
  peakBufferedProjections: number;
  streamingManifestRef?: StreamingEvidenceManifestRef;
};

export type StreamingEvidenceRecoveryHarnessResult = {
  schemaVersion: "htr-wp04-streaming-evidence-recovery/v1";
  terminalState: "STREAMING_EVIDENCE_OK" | "STREAMING_EVIDENCE_FAILED";
  fixturePath: string;
  fixtureSha256: string;
  expectedCycles: number;
  completeRun: StreamingFixtureBacktestResult;
  streamOnlyRun: StreamingFixtureBacktestResult;
  parity: {
    evidenceDigestMatch: boolean;
    semanticReproDigestMatch: boolean;
    metricsMatch: boolean;
    cycleCountMatch: boolean;
  };
  sigtermPartialManifest: string | null;
  reconstructionOutcome: string;
  memoryBoundedness: {
    /**
     * Retained PaperCycleResult objects in STREAM_ONLY mode. Invariant: 0 (the runner never pushes
     * to cycleResults and RunBacktestResult.cycleResults is empty).
     */
    retainedPaperCycleResults: number;
    /** Buffered evidence-projection high-water; bounded by maxBatchCycles regardless of cycleCount. */
    peakBufferedProjections: number;
    maxBatchCycles: number;
    cycleCount: number;
    /** Bound observed at multiple cycle counts, proving the high-water does not grow with N. */
    boundedness: Array<{ cycleCount: number; peakBufferedProjections: number }>;
    provenance: { gitSha: string; dirtyTree: boolean };
  };
  evidenceDirs: {
    completeRunDir: string;
    sigtermRunDir: string;
    corruptRunDir: string;
    tempBaseDir: string;
  };
};

function createBenchmarkNewIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(415700 + sequence).padStart(12, "0")}`;
  };
}

async function withDeterministicRandomUuid<T>(run: () => Promise<T>): Promise<T> {
  let sequence = 0;
  const originalRandomUuid = crypto.randomUUID.bind(crypto);
  crypto.randomUUID = () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(415800 + sequence).padStart(12, "0")}`;
  };
  try {
    return await run();
  } finally {
    crypto.randomUUID = originalRandomUuid;
  }
}

export async function runFixtureBacktestWithRetention(input: {
  retentionMode: ReplayRetentionMode;
  evidenceRunDir?: string;
  runId?: string;
  peakSink?: { sink?: ReplayEvidenceSink };
  cycleIdPrefix?: string;
}): Promise<StreamingFixtureBacktestResult> {
  return withDeterministicRandomUuid(async () => {
    const fixture = loadApprovedBenchmarkFixture();
    const { session, context } = await seedBenchmarkSession();
    const runId = input.runId ?? "htr-wp04-parity";
    const cycleIdPrefix = input.cycleIdPrefix ?? "htr-wp04-parity";
    let evidenceSink: ReplayEvidenceSink | undefined;
    let peakBufferedProjections = 0;

    if (input.retentionMode === "STREAM_ONLY") {
      const baseDir =
        input.evidenceRunDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp04-evidence-"));
      const runDir = path.join(baseDir, runId);
      mkdirSync(runDir, { recursive: true });
      evidenceSink = createStreamingEvidenceSink({
        runDir,
        runId,
        gitSha: readGitCodeSha(),
        environment: "streaming-evidence-fixture-harness",
      });
      if (input.peakSink) {
        input.peakSink.sink = evidenceSink;
      }
    }

    try {
      const window = {
        start: new Date(fixture.bars[0]!.barOpenTime),
        end: new Date(fixture.bars.at(-1)!.barCloseTime),
      };
      const costModel = createCostModelV1("10", "5");
      const barSource = new HistoricalBarReplaySource({
        bars: fixture.bars,
        quote: fixture.latestQuote,
        cycleIdPrefix,
      });

      const backtest = await runBacktest({
        context,
        barSource,
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "htr-wp04-streaming",
        defaultQuantity: "0.01",
        costModel,
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: BENCHMARK_STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "htr-wp04-streaming",
        runId,
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
        retentionMode: input.retentionMode,
        evidenceSink,
      });

      if (evidenceSink) {
        peakBufferedProjections = Math.max(
          peakBufferedProjections,
          evidenceSink.peakBufferedProjections(),
        );
      }

      return {
        cycleCount: backtest.cycleCount,
        evidenceDigest: backtest.evidenceDigest,
        semanticReproDigest: computeReplayReproContentDigest(backtest.exportDocument),
        cycleResultsLength: backtest.cycleResults.length,
        peakBufferedProjections,
        streamingManifestRef: backtest.streamingManifestRef,
      };
    } finally {
      session.cleanup();
    }
  });
}

export async function runFixtureResearchValidationStreamOnly(input: {
  evidenceRunDir: string;
  runId: string;
}): Promise<{
  metrics: Awaited<ReturnType<typeof runResearchValidationBacktest>>;
  artifactSink: ResearchValidationBacktestArtifactSink;
}> {
  return withDeterministicRandomUuid(async () => {
    const fixture = loadApprovedBenchmarkFixture();
    const { session, context } = await seedBenchmarkSession();
    const runDir = path.join(input.evidenceRunDir, input.runId);
    mkdirSync(runDir, { recursive: true });
    const evidenceSink = createStreamingEvidenceSink({
      runDir,
      runId: input.runId,
      gitSha: readGitCodeSha(),
      environment: "streaming-evidence-research-integration",
    });
    const artifactSink: ResearchValidationBacktestArtifactSink = {};

    try {
      const metrics = await runResearchValidationBacktest({
        context,
        bars: fixture.bars,
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: BENCHMARK_STRATEGY_VERSION,
        datasetId: "htr-wp04-streaming",
        runId: input.runId,
        split: "validation",
        costModel: createCostModelV1("10", "5"),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "htr-wp04-research",
        defaultQuantity: "0.01",
        newId: createBenchmarkNewIdFactory(),
        cycleIdPrefix: buildResearchValidationCycleIdPrefix(input.runId),
        metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
        artifactSink,
        retentionMode: "STREAM_ONLY",
        evidenceSink,
      });
      return { metrics, artifactSink };
    } finally {
      session.cleanup();
    }
  });
}

export async function runStreamingEvidenceRecoveryHarness(): Promise<StreamingEvidenceRecoveryHarnessResult> {
  const fixtureSha256 = sha256File(HTR_WP03_BENCHMARK_FIXTURE_PATH);
  if (fixtureSha256 !== HTR_WP03_BENCHMARK_FIXTURE_SHA256) {
    throw new Error(
      `[htr-wp04-evidence] fixture sha256 mismatch: expected ${HTR_WP03_BENCHMARK_FIXTURE_SHA256}, got ${fixtureSha256}`,
    );
  }

  const evidenceBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp04-recovery-harness-"));
  const fixture = loadApprovedBenchmarkFixture();
  const completeRun = await runFixtureBacktestWithRetention({
    retentionMode: "FULL",
    runId: "htr-wp04-parity",
    cycleIdPrefix: "htr-wp04-parity",
  });

  const peakTracker: { sink?: ReplayEvidenceSink } = {};
  const streamOnlyRun = await runFixtureBacktestWithRetention({
    retentionMode: "STREAM_ONLY",
    evidenceRunDir: evidenceBaseDir,
    runId: "htr-wp04-parity",
    cycleIdPrefix: "htr-wp04-parity",
    peakSink: peakTracker,
  });

  const researchIntegration = await runFixtureResearchValidationStreamOnly({
    evidenceRunDir: path.join(evidenceBaseDir, "research-integration"),
    runId: "validation-v2",
  });

  // SIGTERM simulation: seal a genuine PARTIAL bundle. We feed a truncated prefix of the completed
  // stream-only run's durable cycles into a fresh sink and call sealPartial WITHOUT any prior
  // sealComplete, so only manifest.partial.json is written (a faithful graceful-shutdown seal).
  const sigtermDir = path.join(evidenceBaseDir, "sigterm-run");
  mkdirSync(sigtermDir, { recursive: true });
  const sigtermSink = createStreamingEvidenceSink({
    runDir: sigtermDir,
    runId: "sigterm-run",
    gitSha: readGitCodeSha(),
    environment: "sigterm-simulation",
  });
  const SIGTERM_PREFIX_CYCLES = 40;
  let sigtermCycleCount = 0;
  const sigtermSource = await seedBenchmarkSession();
  try {
    const window = {
      start: new Date(fixture.bars[0]!.barOpenTime),
      end: new Date(fixture.bars.at(-1)!.barCloseTime),
    };
    // FULL mode retains raw PaperCycleResults so we can feed a truncated prefix into the sink.
    const rawRun = await runBacktest({
      context: sigtermSource.context,
      barSource: new HistoricalBarReplaySource({
        bars: fixture.bars,
        quote: fixture.latestQuote,
        cycleIdPrefix: "htr-wp04-sigterm",
      }),
      deps: sigtermSource.session.deps,
      orderRepository: sigtermSource.session.orderRepository,
      accountKey: "htr-wp04-sigterm",
      defaultQuantity: "0.01",
      costModel: createCostModelV1("10", "5"),
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: BENCHMARK_STRATEGY_VERSION,
      regimeLabel: "AGGREGATE",
      datasetId: "htr-wp04-sigterm",
      runId: "sigterm-source",
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
      retentionMode: "FULL",
    });
    for (const cycle of rawRun.cycleResults) {
      if (sigtermCycleCount >= SIGTERM_PREFIX_CYCLES) {
        break;
      }
      sigtermSink.onCycle(sigtermCycleCount, cycle);
      sigtermCycleCount += 1;
    }
  } finally {
    sigtermSource.session.cleanup();
  }
  const sigtermPeakBufferedProjections = sigtermSink.peakBufferedProjections();
  // expectedCycleCount is the full run target; the partial seal is durable only through the
  // interrupted prefix, so sealedThroughCycleIndex < expectedCycleCount - 1 (a faithful partial).
  await sigtermSink.sealPartial(streamOnlyRun.cycleCount, "SIGTERM");
  const sigtermPartialManifest = path.join(sigtermDir, "manifest.partial.json");

  const hardKillDir = streamOnlyRun.streamingManifestRef?.runDir;
  if (!hardKillDir) {
    throw new Error("[htr-wp04-evidence] missing stream-only run dir for reconstruction");
  }
  const manifestPath = path.join(hardKillDir, "manifest.json");
  const manifestBackup = readFileSync(manifestPath, "utf8");
  fs.unlinkSync(manifestPath);
  const reconstruction = reconstructStreamingEvidence(hardKillDir);
  writeFileSync(manifestPath, manifestBackup);

  const corruptDir = path.join(evidenceBaseDir, "corrupt-run");
  fs.cpSync(hardKillDir, corruptDir, { recursive: true });
  const chunkFiles = readdirSync(path.join(corruptDir, "chunks")).filter((name) =>
    name.endsWith(".json"),
  );
  if (chunkFiles.length > 0) {
    const corruptPath = path.join(corruptDir, "chunks", chunkFiles.at(-1)!);
    writeFileSync(corruptPath, '{"schemaVersion":"corrupt"}\n');
  }
  const corruptReconstruction = reconstructStreamingEvidence(corruptDir);

  const fullMetrics = await (async () => {
    const { session, context } = await seedBenchmarkSession();
    try {
      return runResearchValidationBacktest({
        context,
        bars: fixture.bars,
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: BENCHMARK_STRATEGY_VERSION,
        datasetId: "htr-wp04-streaming",
        runId: "full-metrics",
        split: "validation",
        costModel: createCostModelV1("10", "5"),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "htr-wp04-research-full",
        defaultQuantity: "0.01",
        newId: createBenchmarkNewIdFactory(),
        cycleIdPrefix: buildResearchValidationCycleIdPrefix("full-metrics"),
        metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
      });
    } finally {
      session.cleanup();
    }
  })();

  const parity = {
    evidenceDigestMatch: completeRun.evidenceDigest === streamOnlyRun.evidenceDigest,
    semanticReproDigestMatch: completeRun.semanticReproDigest === streamOnlyRun.semanticReproDigest,
    metricsMatch: JSON.stringify(fullMetrics) === JSON.stringify(researchIntegration.metrics),
    cycleCountMatch: completeRun.cycleCount === streamOnlyRun.cycleCount,
  };

  const terminalState =
    parity.evidenceDigestMatch &&
    parity.semanticReproDigestMatch &&
    parity.metricsMatch &&
    parity.cycleCountMatch &&
    streamOnlyRun.cycleResultsLength === 0 &&
    streamOnlyRun.peakBufferedProjections <= MAX_BATCH_CYCLES &&
    reconstruction.outcome !== "QUARANTINED" &&
    corruptReconstruction.outcome === "QUARANTINED"
      ? "STREAMING_EVIDENCE_OK"
      : "STREAMING_EVIDENCE_FAILED";

  return {
    schemaVersion: "htr-wp04-streaming-evidence-recovery/v1",
    terminalState,
    fixturePath: HTR_WP03_BENCHMARK_FIXTURE_PATH,
    fixtureSha256: HTR_WP03_BENCHMARK_FIXTURE_SHA256,
    expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    completeRun,
    streamOnlyRun,
    parity,
    sigtermPartialManifest: fs.existsSync(sigtermPartialManifest) ? sigtermPartialManifest : null,
    reconstructionOutcome: reconstruction.outcome,
    memoryBoundedness: {
      retainedPaperCycleResults: streamOnlyRun.cycleResultsLength,
      peakBufferedProjections:
        peakTracker.sink?.peakBufferedProjections() ?? streamOnlyRun.peakBufferedProjections,
      maxBatchCycles: MAX_BATCH_CYCLES,
      cycleCount: streamOnlyRun.cycleCount,
      boundedness: [
        {
          cycleCount: streamOnlyRun.cycleCount,
          peakBufferedProjections:
            peakTracker.sink?.peakBufferedProjections() ?? streamOnlyRun.peakBufferedProjections,
        },
        {
          cycleCount: sigtermCycleCount,
          peakBufferedProjections: sigtermPeakBufferedProjections,
        },
      ],
      provenance: { gitSha: readGitCodeSha(), dirtyTree: readGitDirtyTree() },
    },
    evidenceDirs: {
      completeRunDir: streamOnlyRun.streamingManifestRef?.runDir ?? "",
      sigtermRunDir: sigtermDir,
      corruptRunDir: corruptDir,
      tempBaseDir: evidenceBaseDir,
    },
  };
}

export function writeStreamingEvidenceBaseline(
  harness: StreamingEvidenceRecoveryHarnessResult,
  streamOnlyRunDir: string,
  sigtermRunDir: string,
  corruptRunDir: string,
): { baselineDir: string; readmePath: string; validationPath: string } {
  const baselineDir = HTR_WP04_STREAMING_EVIDENCE_BASELINE_DIR;
  mkdirSync(baselineDir, { recursive: true });

  const completeTarget = path.join(baselineDir, "complete-run");
  fs.rmSync(completeTarget, { recursive: true, force: true });
  fs.cpSync(streamOnlyRunDir, completeTarget, { recursive: true });

  const sigtermTarget = path.join(baselineDir, "sigterm");
  fs.rmSync(sigtermTarget, { recursive: true, force: true });
  fs.cpSync(sigtermRunDir, sigtermTarget, { recursive: true });

  const corruptTarget = path.join(baselineDir, "corrupt-run");
  fs.rmSync(corruptTarget, { recursive: true, force: true });
  fs.cpSync(corruptRunDir, corruptTarget, { recursive: true });

  writeFileSync(
    path.join(baselineDir, "parity-report.json"),
    `${JSON.stringify(
      {
        ...harness.parity,
        digests: {
          fullEvidenceDigest: harness.completeRun.evidenceDigest,
          streamEvidenceDigest: harness.streamOnlyRun.evidenceDigest,
          fullSemanticReproDigest: harness.completeRun.semanticReproDigest,
          streamSemanticReproDigest: harness.streamOnlyRun.semanticReproDigest,
          streamChainDigest:
            harness.streamOnlyRun.streamingManifestRef?.manifest.chainDigest ?? null,
          fixtureSha256: harness.fixtureSha256,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(baselineDir, "memory-boundedness.json"),
    `${JSON.stringify(harness.memoryBoundedness, null, 2)}\n`,
  );
  writeFileSync(
    path.join(baselineDir, "research-path-validation.json"),
    `${JSON.stringify(
      {
        schemaVersion: "htr-wp04-research-path-validation/v1",
        metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
        terminalState: harness.terminalState,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(baselineDir, "reconstruction-report.json"),
    `${JSON.stringify({ outcome: harness.reconstructionOutcome }, null, 2)}\n`,
  );

  const readmePath = path.join(baselineDir, "README.md");
  writeFileSync(
    readmePath,
    `# HTR-WP04 streaming evidence baseline

Fixture: \`${HTR_WP03_BENCHMARK_FIXTURE_PATH}\`
Fixture SHA256: \`${HTR_WP03_BENCHMARK_FIXTURE_SHA256}\`
Expected cycles: ${HTR_WP03_BENCHMARK_EXPECTED_CYCLES}

Reproduce:

\`\`\`bash
${HTR_WP04_STREAMING_EVIDENCE_COMMAND}
\`\`\`

Terminal state: \`${harness.terminalState}\`
`,
  );

  const validationPath = path.join(baselineDir, "VALIDATION.md");
  writeFileSync(
    validationPath,
    `# HTR-WP04 validation

- Command: \`${HTR_WP04_STREAMING_EVIDENCE_COMMAND}\`
- Fixture digest verified before run
- FULL vs STREAM_ONLY parity: evidenceDigest=${harness.parity.evidenceDigestMatch}, metrics=${harness.parity.metricsMatch}
- Retained PaperCycleResult objects (STREAM_ONLY): ${harness.memoryBoundedness.retainedPaperCycleResults}
- Peak buffered projections: ${harness.memoryBoundedness.peakBufferedProjections} (max batch ${harness.memoryBoundedness.maxBatchCycles})
- Boundedness at multiple cycle counts: ${harness.memoryBoundedness.boundedness
      .map((entry) => `${entry.cycleCount}→${entry.peakBufferedProjections}`)
      .join(", ")}
- Evidence provenance: gitSha=${harness.memoryBoundedness.provenance.gitSha}, dirtyTree=${harness.memoryBoundedness.provenance.dirtyTree}
`,
  );

  return { baselineDir, readmePath, validationPath };
}

export function countStreamingProjections(runDir: string): number {
  return new StreamingEvidenceReader(runDir).projectionCount();
}
