import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import { readReplayRunChainManifest } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";

describe("trader replay continuation segment (HTR-WP05)", () => {
  it("retains immutable partial segment and links continuation via run-chain manifest", async () => {
    const harness = await runCheckpointResumeHarness();
    const partialManifestPath = path.join(
      harness.runRootDir,
      "segments",
      "partial-interrupted",
      "manifest.partial.json",
    );
    const partialCompletePath = path.join(
      harness.runRootDir,
      "segments",
      "partial-interrupted",
      "manifest.json",
    );
    expect(fs.existsSync(partialManifestPath)).toBe(true);
    expect(fs.existsSync(partialCompletePath)).toBe(false);

    const chain = readReplayRunChainManifest(harness.runRootDir);
    expect(chain?.segments).toHaveLength(1);
    expect(chain?.segments[0]?.continuesFromRunDir).toContain("partial-interrupted");
  }, 240_000);
});
