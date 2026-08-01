/**
 * DEE-436 — bounded Full-mode two-run control replay must pass determinism.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveFhvControlReplayCliConfig,
  runFhvControlReplay,
} from "@/scripts/trader/fhv-control-replay-cli";

const RELEASE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ORG_ID = "00000000-0000-4000-8000-000000000436";

describe("DEE-436 FHV control-replay CLI", () => {
  it("parses --release-sha from argv (not argv[3] positional)", () => {
    const config = resolveFhvControlReplayCliConfig({}, [
      "--",
      "--release-sha",
      RELEASE_SHA,
      "--organization-id",
      ORG_ID,
      "--operator-id",
      "unit-operator",
      "--artifact-root",
      "/tmp/fhv-control-replay-parse",
    ]);
    expect(config.releaseSha).toBe(RELEASE_SHA);
    expect(config.organizationId).toBe(ORG_ID);
    expect(config.operatorId).toBe("unit-operator");
    expect(config.artifactRoot).toBe("/tmp/fhv-control-replay-parse");
  });

  it("rejects invalid release sha", () => {
    expect(() => resolveFhvControlReplayCliConfig({}, ["--release-sha", "not-a-sha"])).toThrow(
      /INVALID_RELEASE_SHA/,
    );
  });

  it("two-run bounded control replay yields CONTROL_REPLAY=PASS", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-control-replay-unit-"));
    try {
      const result = await runFhvControlReplay({
        releaseSha: RELEASE_SHA,
        organizationId: ORG_ID,
        operatorId: "unit-control-replay-operator",
        artifactRoot: root,
      });
      expect(result, JSON.stringify(result)).toMatchObject({
        classification: "CONTROL_REPLAY=PASS",
        digestsMatch: true,
      });
      expect(result.runOneDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(result.runTwoDigest).toBe(result.runOneDigest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
