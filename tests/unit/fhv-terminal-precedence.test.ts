import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  readFhvRehearsalCampaignProgress,
  runFhvRehearsalCampaign,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-terminal-precedence";
const ORG_ID = "00000000-0000-4000-8000-000000000431";

function prepareRunDir(root: string): string {
  const config = buildFhvRehearsalLaunchConfig({
    fixtureId: "HTR_WP03_BENCHMARK",
    targetSha: TARGET_SHA,
    runId: RUN_ID,
    organizationId: ORG_ID,
    artifactRoot: root,
  });
  return materializeFhvRehearsalManifest(config).runDir;
}

function writeResumeMarker(runDir: string): void {
  writeFileSync(
    join(runDir, "control", "resume_from_checkpoint-request.v1.json"),
    `${JSON.stringify(
      {
        schemaVersion: "fhv-campaign-control-request/v1",
        action: "RESUME_FROM_CHECKPOINT",
        runId: RUN_ID,
        organizationId: ORG_ID,
        operatorId: "stale-resume",
        reason: "stale resume marker",
        requestedAtUtc: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

describe("FHV terminal guard precedes resume marker (DEE-431)", () => {
  it("ignores stale resume marker after REHEARSAL_OK", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-terminal-ok-"));
    try {
      const runDir = prepareRunDir(root);
      writeFileAtomic(
        join(runDir, "fhv-rehearsal-terminal.v1.json"),
        `${JSON.stringify({ classification: "REHEARSAL_OK" }, null, 2)}\n`,
      );
      writeFileAtomic(
        join(runDir, "fhv-rehearsal-campaign-progress.v1.json"),
        `${JSON.stringify(
          {
            schemaVersion: "fhv-rehearsal-campaign-progress/v1",
            runId: RUN_ID,
            cyclesProcessed: 100,
            expectedCycles: 100,
            phase: "completed",
            updatedAtUtc: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
      writeResumeMarker(runDir);
      const before = readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed ?? 0;
      const result = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(result.classification).toBe("REHEARSAL_OK");
      expect(readFhvRehearsalCampaignProgress(runDir)?.cyclesProcessed).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores stale resume marker after REHEARSAL_TIMEOUT", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-terminal-timeout-"));
    try {
      const runDir = prepareRunDir(root);
      writeFileAtomic(
        join(runDir, "fhv-rehearsal-terminal.v1.json"),
        `${JSON.stringify({ classification: "REHEARSAL_TIMEOUT" }, null, 2)}\n`,
      );
      writeResumeMarker(runDir);
      const result = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(result.classification).toBe("REHEARSAL_TIMEOUT");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores stale resume marker after REHEARSAL_FAILED", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-terminal-failed-"));
    try {
      const runDir = prepareRunDir(root);
      writeFileAtomic(
        join(runDir, "fhv-rehearsal-terminal.v1.json"),
        `${JSON.stringify({ classification: "REHEARSAL_FAILED" }, null, 2)}\n`,
      );
      writeResumeMarker(runDir);
      const result = await runFhvRehearsalCampaign({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
        targetSha: TARGET_SHA,
      });
      expect(result.classification).toBe("REHEARSAL_FAILED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
