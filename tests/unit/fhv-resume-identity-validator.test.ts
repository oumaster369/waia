import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  assertFhvRehearsalResumeIdentity,
  FhvResumeIdentityError,
} from "@/lib/trader/observability/fhv-resume-identity-validator";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";

const TARGET_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const RUN_ID = "fhv-resume-identity";
const ORG_ID = "00000000-0000-4000-8000-000000000431";

describe("FHV resume identity validator (DEE-431)", () => {
  it("rejects resume when checkpoint is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-resume-id-"));
    try {
      const config = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
      });
      const runDir = materializeFhvRehearsalManifest(config).runDir;
      expect(() =>
        assertFhvRehearsalResumeIdentity({
          runRoot: runDir,
          manifest: config,
          targetSha: TARGET_SHA,
        }),
      ).toThrow(FhvResumeIdentityError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
