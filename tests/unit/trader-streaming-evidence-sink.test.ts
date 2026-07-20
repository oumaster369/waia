import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createShutdownCoordinator,
  createStreamingEvidenceSink,
  NOOP_REPLAY_EVIDENCE_SINK,
} from "@/lib/trader/backtest/streaming-evidence";
import { runFixtureBacktestWithRetention } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness";

describe("streaming evidence sink + shutdown coordinator (HTR-WP04)", () => {
  it("NOOP sink is inert", async () => {
    await NOOP_REPLAY_EVIDENCE_SINK.onCycle(0, {} as never);
    const ref = await NOOP_REPLAY_EVIDENCE_SINK.sealComplete(0);
    expect(ref.manifest.terminalState).toBe("STREAMING_EVIDENCE_OK");
    expect(NOOP_REPLAY_EVIDENCE_SINK.peakBufferedProjections()).toBe(0);
  });

  it("seals exactly once then exits with the signal exit code after cleanup", async () => {
    const exit = vi.fn<(code: number) => void>();
    const order: string[] = [];
    const coordinator = createShutdownCoordinator({ timeoutMs: 1000, exit });
    const seal = vi.fn(async () => {
      order.push("seal");
    });
    coordinator.onShutdown(seal);

    coordinator.requestShutdown("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seal).toHaveBeenCalledTimes(1);
    expect(coordinator.isShuttingDown()).toBe(true);
    // Exit happens only after the seal callback resolves (no exit before required cleanup).
    expect(exit).toHaveBeenCalledWith(143);
    expect(order).toEqual(["seal"]);
  });

  it("escalates a second signal without a duplicate seal", async () => {
    const exit = vi.fn<(code: number) => void>();
    const coordinator = createShutdownCoordinator({ timeoutMs: 1000, exit });
    const seal = vi.fn(async () => undefined);
    coordinator.onShutdown(seal);

    coordinator.requestShutdown("SIGINT");
    coordinator.requestShutdown("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seal).toHaveBeenCalledTimes(1);
    // First (post-seal) exit 130 for SIGINT, plus the immediate second-signal escalation 130.
    expect(exit).toHaveBeenCalledWith(130);
  });

  it("seals partial evidence through sink", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp04-sink-"));
    const sink = createStreamingEvidenceSink({ runDir, runId: "sink-test" });
    const partial = await sink.sealPartial(0, "SIGTERM");
    expect(partial.manifest.terminalState).toBe("STREAMING_EVIDENCE_SEALED_PARTIAL");
    expect(fs.existsSync(path.join(runDir, "manifest.partial.json"))).toBe(true);
  });

  it("tracks peak buffered projections during fixture replay", async () => {
    const peakTracker: { sink?: typeof NOOP_REPLAY_EVIDENCE_SINK } = {};
    await runFixtureBacktestWithRetention({
      retentionMode: "STREAM_ONLY",
      runId: "sink-peak",
      peakSink: peakTracker,
    });
    expect(peakTracker.sink?.peakBufferedProjections()).toBeLessThanOrEqual(32);
  }, 120_000);
});
