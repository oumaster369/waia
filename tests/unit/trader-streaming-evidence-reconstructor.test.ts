import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";
import { runFixtureBacktestWithRetention } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness";
import { createStreamingEvidenceSink } from "@/lib/trader/backtest/streaming-evidence";

describe("streaming evidence reconstructor (HTR-WP04)", () => {
  it("recovers a complete bundle", async () => {
    const result = await runFixtureBacktestWithRetention({
      retentionMode: "STREAM_ONLY",
      runId: "recon-complete",
    });
    const reconstruction = reconstructStreamingEvidence(result.streamingManifestRef!.runDir);
    expect(reconstruction.outcome).toBe("RECOVERED_COMPLETE");
  }, 120_000);

  it("recovers partial bundle when manifest is missing", async () => {
    const result = await runFixtureBacktestWithRetention({
      retentionMode: "STREAM_ONLY",
      runId: "recon-partial",
    });
    const runDir = result.streamingManifestRef!.runDir;
    fs.unlinkSync(path.join(runDir, "manifest.json"));

    const reconstruction = reconstructStreamingEvidence(runDir);
    expect(reconstruction.outcome).toBe("RECOVERED_PARTIAL");
  }, 120_000);

  it("deletes orphan temp files and quarantines corrupt chunks", async () => {
    const result = await runFixtureBacktestWithRetention({
      retentionMode: "STREAM_ONLY",
      runId: "recon-corrupt",
    });
    const runDir = result.streamingManifestRef!.runDir;
    const chunksDir = path.join(runDir, "chunks");
    const chunkFiles = fs.readdirSync(chunksDir).filter((name) => name.endsWith(".json"));
    expect(chunkFiles.length).toBeGreaterThan(1);
    fs.writeFileSync(path.join(chunksDir, "chunk-000000.json.tmp-1-2-3"), "{}");
    fs.writeFileSync(path.join(chunksDir, chunkFiles[1]!), '{"schemaVersion":"broken"}');

    const reconstruction = reconstructStreamingEvidence(runDir);
    expect(reconstruction.outcome).toBe("QUARANTINED");
    expect(fs.existsSync(path.join(runDir, "orphan-temp-report.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "corruption-report.json"))).toBe(true);
  }, 120_000);

  it("accepts partial manifest terminal state", async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp04-recon-sealed-partial-"));
    const sink = createStreamingEvidenceSink({ runDir, runId: "partial-manifest" });
    await sink.sealPartial(0, "SIGTERM");

    expect(fs.existsSync(path.join(runDir, "manifest.partial.json"))).toBe(true);
    const result = reconstructStreamingEvidence(runDir);
    expect(["RECOVERED_COMPLETE", "RECOVERED_PARTIAL", "EMPTY"]).toContain(result.outcome);
  });
});
