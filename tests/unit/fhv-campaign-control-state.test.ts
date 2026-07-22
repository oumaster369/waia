import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  assertFhvCampaignActionAllowed,
  resolveFhvCampaignState,
} from "@/lib/trader/observability/fhv-campaign-state";
import { resolveFhvControlRequestDisposition } from "@/lib/trader/observability/fhv-control-request-validator";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-control-state";
const ORG_ID = "00000000-0000-4000-8000-000000000431";

describe("FHV corrupt control state resolution (DEE-431)", () => {
  it("classifies malformed control requests as corrupt", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-control-corrupt-"));
    try {
      const config = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
      });
      const runDir = materializeFhvRehearsalManifest(config).runDir;
      writeFileSync(join(runDir, "control", "pause_at_checkpoint-request.v1.json"), "{not-json");
      expect(
        resolveFhvControlRequestDisposition({
          runRoot: runDir,
          action: "PAUSE_AT_CHECKPOINT",
          runId: RUN_ID,
          organizationId: ORG_ID,
        }),
      ).toBe("corrupt");
      const snapshot = resolveFhvCampaignState({
        runRoot: runDir,
        runId: RUN_ID,
        organizationId: ORG_ID,
      });
      expect(snapshot.state).toBe("INCONSISTENT");
      expect(snapshot.corruptControlReason).toBe("FHV_CONTROL_PAUSE_CORRUPT");
      expect(() =>
        assertFhvCampaignActionAllowed({ action: "PAUSE_AT_CHECKPOINT", snapshot }),
      ).toThrow(/corrupt/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
