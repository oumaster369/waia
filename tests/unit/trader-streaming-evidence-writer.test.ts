import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import {
  computeChunkDigest,
  computePayloadDigest,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  createStreamingEvidenceWriter,
  serializeStreamingEvidenceChunkEnvelope,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-writer";
import {
  MAX_BATCH_CYCLES,
  STREAMING_EVIDENCE_SCHEMA_VERSION,
  StreamingEvidenceError,
  StreamingEvidenceReader,
  type ReplayCycleEvidenceProjection,
} from "@/lib/trader/backtest/streaming-evidence";
import { runFixtureBacktestWithRetention } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness";
import { HTR_WP03_BENCHMARK_EXPECTED_CYCLES } from "@/lib/trader/backtest/replay-benchmark-harness";

describe("streaming evidence writer (HTR-WP04)", () => {
  it("writes atomically and seals a complete manifest from fixture replay", async () => {
    const result = await runFixtureBacktestWithRetention({
      retentionMode: "STREAM_ONLY",
      runId: "writer-fixture-run",
    });

    expect(result.streamingManifestRef?.manifest.terminalState).toBe("STREAMING_EVIDENCE_OK");
    expect(result.peakBufferedProjections).toBeLessThanOrEqual(MAX_BATCH_CYCLES);
    expect(result.cycleResultsLength).toBe(0);
    expect(result.cycleCount).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);

    const runDir = result.streamingManifestRef!.runDir;
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(true);
    expect(new StreamingEvidenceReader(runDir).projectionCount()).toBe(
      HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    );
  }, 120_000);

  it("does not overwrite a partial seal with a later complete seal", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp04-seal-once-"));
    const writer = createStreamingEvidenceWriter({ runDir, runId: "seal-once" });

    const partial = writer.sealPartial(1, "SIGTERM");
    expect(partial.manifest.terminalState).toBe("STREAMING_EVIDENCE_SEALED_PARTIAL");

    // A subsequent complete seal must be idempotent — the first (partial) seal wins.
    const afterComplete = writer.sealComplete(1);
    expect(afterComplete.manifest.terminalState).toBe("STREAMING_EVIDENCE_SEALED_PARTIAL");
    expect(fs.existsSync(path.join(runDir, "manifest.partial.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(false);
  });

  it("throws on atomic write failure", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp04-writer-fail-"));
    fs.mkdirSync(runDir, { recursive: true });
    fs.chmodSync(runDir, 0o500);

    expect(() => writeFileAtomic(path.join(runDir, "nested.txt"), "payload")).toThrow(
      StreamingEvidenceError,
    );

    fs.chmodSync(runDir, 0o755);
  });

  it("detects seq conflicts with different payload digests", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp04-writer-conflict-"));
    const writer = createStreamingEvidenceWriter({ runDir, runId: "conflict-test" });
    writer.onCycle(0, {
      evaluation: {
        features: { evaluatedAt: "2026-01-01T00:00:00.000Z", featureSetId: "a", values: {} },
        msv: {
          instrumentId: "BTC/USDT",
          evaluatedAt: "2026-01-01T00:00:00.000Z",
          derived: {
            regime: "RANGE",
            tradingPermission: "ALLOW_TRADING",
            riskMultiplier: "1",
            reasonCodes: [],
            allowedStrategyIds: [],
            dataQualityScore: 1,
            conviction: 0,
            opportunityAuthorized: false,
            activeHypothesisType: null,
            eligibleStrategyFamilies: [],
          },
          crowd: { newsSentiment: null, fearGreedIndex: null },
        },
        signal: {
          strategyId: "mean_reversion_v0",
          strategySignalId: "sig-1",
          strategyVersion: "0.1.0",
          organizationId: "org",
          symbol: "BTC/USDT",
          outcome: "no_trade",
          side: undefined,
          confidence: "0.5",
          evaluatedAt: "2026-01-01T00:00:00.000Z",
        },
        signals: [],
      },
      strategyExecutions: [],
      submitBlocked: false,
      execution: null,
      reconciliation: null,
    } as never);
    writer.sealComplete(1);

    const writer2 = createStreamingEvidenceWriter({ runDir, runId: "conflict-test-2" });
    writer2.onCycle(0, {
      evaluation: {
        features: { evaluatedAt: "2026-01-01T00:00:00.000Z", featureSetId: "b", values: {} },
        msv: {
          instrumentId: "BTC/USDT",
          evaluatedAt: "2026-01-01T00:00:00.000Z",
          derived: {
            regime: "TREND_BULL",
            tradingPermission: "ALLOW_TRADING",
            riskMultiplier: "1",
            reasonCodes: [],
            allowedStrategyIds: [],
            dataQualityScore: 1,
            conviction: 0,
            opportunityAuthorized: false,
            activeHypothesisType: null,
            eligibleStrategyFamilies: [],
          },
          crowd: { newsSentiment: null, fearGreedIndex: null },
        },
        signal: {
          strategyId: "mean_reversion_v0",
          strategySignalId: "sig-1",
          strategyVersion: "0.1.0",
          organizationId: "org",
          symbol: "BTC/USDT",
          outcome: "no_trade",
          side: undefined,
          confidence: "0.5",
          evaluatedAt: "2026-01-01T00:00:00.000Z",
        },
        signals: [],
      },
      strategyExecutions: [],
      submitBlocked: false,
      execution: null,
      reconciliation: null,
    } as never);
    expect(() => writer2.sealComplete(1)).toThrow(StreamingEvidenceError);
  });

  it("GS-10 flush serialization matches historical JSON.stringify digests", () => {
    const batch: ReplayCycleEvidenceProjection[] = [
      {
        schemaVersion: "htr-wp04-cycle-projection/v1",
        cycleIndex: 0,
        evaluatedAtMs: 1_700_000_000_000,
        regime: "RANGE",
        skipReason: "no_signal",
        strategyExecutions: [],
        guardian: null,
        msv: { instrumentId: "BTC/USDT", evaluatedAt: "2026-01-01T00:00:00.000Z" },
        m9Trace: { evaluatedAt: "2026-01-01T00:00:00.000Z", signal: null },
      },
      {
        schemaVersion: "htr-wp04-cycle-projection/v1",
        cycleIndex: 1,
        evaluatedAtMs: 1_700_000_060_000,
        regime: "TREND_BULL",
        skipReason: null,
        strategyExecutions: [],
        guardian: { evaluationCount: 0, exitIntentCount: 0, guardianExecutionCount: 0 },
        msv: { instrumentId: "ETH/USDT", evaluatedAt: "2026-01-01T00:01:00.000Z" },
        m9Trace: null,
      },
    ];
    const legacyPayloadDigest = computePayloadDigest(batch);
    const legacyEnvelopeWithoutDigest = {
      schemaVersion: STREAMING_EVIDENCE_SCHEMA_VERSION,
      seq: 7,
      cycleIndexRange: { startInclusive: 0, endInclusive: 1 },
      payload: batch,
      payloadDigest: legacyPayloadDigest,
      prevChunkDigest: "a".repeat(64),
    };
    const legacyChunkDigest = computeChunkDigest(legacyEnvelopeWithoutDigest);
    const legacyEnvelopeJson = JSON.stringify({
      ...legacyEnvelopeWithoutDigest,
      chunkDigest: legacyChunkDigest,
    });

    const optimized = serializeStreamingEvidenceChunkEnvelope({
      seq: 7,
      batch,
      prevChunkDigest: "a".repeat(64),
    });
    expect(optimized.payloadDigest).toBe(legacyPayloadDigest);
    expect(optimized.chunkDigest).toBe(legacyChunkDigest);
    expect(optimized.envelopeJson).toBe(legacyEnvelopeJson);
  });
});
