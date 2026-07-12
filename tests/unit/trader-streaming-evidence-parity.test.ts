import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createStreamingEvidenceSink } from "@/lib/trader/backtest/streaming-evidence";
import {
  HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
  loadApprovedBenchmarkFixture,
  seedBenchmarkSession,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import { runFixtureBacktestWithRetention } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness";
import { runResearchValidationBacktest } from "@/lib/trader/research/research-backtest-runner";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";

const SHARED_RUN_ID = "htr-wp04-parity-validation";

function createParityNewIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(415900 + sequence).padStart(12, "0")}`;
  };
}

async function runValidationMetricsForMode(
  retentionMode: "FULL" | "STREAM_ONLY",
): Promise<Awaited<ReturnType<typeof runResearchValidationBacktest>>> {
  const fixture = loadApprovedBenchmarkFixture();
  const { session, context } = await seedBenchmarkSession();
  const streamRunDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp04-parity-metrics-"));
  fs.mkdirSync(path.join(streamRunDir, SHARED_RUN_ID), { recursive: true });

  try {
    return await runResearchValidationBacktest({
      context,
      bars: fixture.bars,
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: "0.1.0",
      datasetId: "htr-wp04-parity",
      runId: SHARED_RUN_ID,
      split: "validation",
      costModel: createCostModelV1("10", "5"),
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "htr-wp04-parity",
      defaultQuantity: "0.01",
      newId: createParityNewIdFactory(),
      cycleIdPrefix: buildResearchValidationCycleIdPrefix(SHARED_RUN_ID),
      metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
      retentionMode,
      evidenceSink:
        retentionMode === "STREAM_ONLY"
          ? createStreamingEvidenceSink({
              runDir: path.join(streamRunDir, SHARED_RUN_ID),
              runId: SHARED_RUN_ID,
              environment: "parity-test",
            })
          : undefined,
    });
  } finally {
    session.cleanup();
  }
}

describe("streaming evidence parity (HTR-WP04)", () => {
  it("matches FULL vs STREAM_ONLY digests and validation metrics", async () => {
    const fullBacktest = await runFixtureBacktestWithRetention({
      retentionMode: "FULL",
      runId: "htr-wp04-parity",
      cycleIdPrefix: "htr-wp04-parity",
    });
    const streamBacktest = await runFixtureBacktestWithRetention({
      retentionMode: "STREAM_ONLY",
      runId: "htr-wp04-parity",
      cycleIdPrefix: "htr-wp04-parity",
    });

    expect(fullBacktest.cycleCount).toBe(streamBacktest.cycleCount);
    expect(fullBacktest.cycleCount).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
    expect(fullBacktest.evidenceDigest).toBe(streamBacktest.evidenceDigest);
    expect(fullBacktest.semanticReproDigest).toBe(streamBacktest.semanticReproDigest);

    const fullMetrics = await runValidationMetricsForMode("FULL");
    const streamMetrics = await runValidationMetricsForMode("STREAM_ONLY");

    expect(streamMetrics).toEqual(fullMetrics);
  }, 180_000);
});
