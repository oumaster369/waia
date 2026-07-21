import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  assertFhvCampaignRuntimeIdentity,
  assertFhvTargetSha,
  FhvCampaignRuntimeIdentityError,
} from "@/lib/trader/observability/fhv-campaign-runtime-identity";
import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";

const TARGET_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const RUN_ID = "fhv-runtime-identity-test";
const ORG_ID = "00000000-0000-4000-8000-000000000416";

describe("FHV campaign runtime identity (DEE-431)", () => {
  function expectIdentityCode(fn: () => unknown, code: string): void {
    try {
      fn();
      expect.fail(`expected ${code}`);
    } catch (error) {
      expect(error).toBeInstanceOf(FhvCampaignRuntimeIdentityError);
      expect((error as FhvCampaignRuntimeIdentityError).code).toBe(code);
    }
  }

  it("rejects missing, empty, abbreviated, and invalid target SHA", () => {
    expectIdentityCode(() => assertFhvTargetSha(undefined), "FHV_TARGET_SHA_REQUIRED");
    expectIdentityCode(() => assertFhvTargetSha(""), "FHV_TARGET_SHA_REQUIRED");
    expectIdentityCode(() => assertFhvTargetSha("abc123"), "FHV_TARGET_SHA_INVALID_LENGTH");
    expectIdentityCode(() => assertFhvTargetSha("B".repeat(40)), "FHV_TARGET_SHA_INVALID_CASE");
    expectIdentityCode(() => assertFhvTargetSha("g".repeat(40)), "FHV_TARGET_SHA_INVALID_FORMAT");
    expect(assertFhvTargetSha(TARGET_SHA)).toBe(TARGET_SHA);
  });

  it("validates manifest targetSha, runId, and organizationId", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-runtime-id-"));
    try {
      const config = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
      });
      const { runDir } = materializeFhvRehearsalManifest(config);
      expectIdentityCode(
        () =>
          assertFhvCampaignRuntimeIdentity({
            runRoot: runDir,
            targetSha: "c".repeat(40),
            runId: RUN_ID,
            organizationId: ORG_ID,
          }),
        "MANIFEST_TARGET_SHA_MISMATCH",
      );
      expectIdentityCode(
        () =>
          assertFhvCampaignRuntimeIdentity({
            runRoot: runDir,
            targetSha: TARGET_SHA,
            runId: "other-run",
            organizationId: ORG_ID,
          }),
        "MANIFEST_RUN_ID_MISMATCH",
      );
      expect(
        assertFhvCampaignRuntimeIdentity({
          runRoot: runDir,
          targetSha: TARGET_SHA,
          runId: RUN_ID,
          organizationId: ORG_ID,
        }).targetSha,
      ).toBe(TARGET_SHA);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
