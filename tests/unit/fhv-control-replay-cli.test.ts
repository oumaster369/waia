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
import {
  setupFhvControlReplayArtifacts,
  FHV_TEST_RELEASE_TAG,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const RELEASE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ORG_ID = "00000000-0000-4000-8000-000000000436";

describe("DEE-436 FHV control-replay CLI", () => {
  it("parses --release-sha from argv (not argv[3] positional)", () => {
    expect(() =>
      resolveFhvControlReplayCliConfig({}, [
        "--",
        "--release-sha",
        RELEASE_SHA,
        "--organization-id",
        ORG_ID,
        "--operator-id",
        "unit-operator",
        "--configuration-freeze-path",
        "/tmp/freeze.json",
        "--authorization-receipt-path",
        "/tmp/auth.json",
        "--dataset-qualification-receipt-path",
        "/tmp/qualify.json",
        "--artifact-root",
        "/tmp/fhv-control-replay-parse",
        "--bounded-fixture",
      ]),
    ).not.toThrow();
    const config = resolveFhvControlReplayCliConfig({}, [
      "--",
      "--release-sha",
      RELEASE_SHA,
      "--organization-id",
      ORG_ID,
      "--operator-id",
      "unit-operator",
      "--configuration-freeze-path",
      "/tmp/freeze.json",
      "--authorization-receipt-path",
      "/tmp/auth.json",
      "--dataset-qualification-receipt-path",
      "/tmp/qualify.json",
      "--artifact-root",
      "/tmp/fhv-control-replay-parse",
      "--bounded-fixture",
    ]);
    expect(config.releaseSha).toBe(RELEASE_SHA);
    expect(config.organizationId).toBe(ORG_ID);
    expect(config.operatorId).toBe("unit-operator");
    expect(config.artifactRoot).toBe("/tmp/fhv-control-replay-parse");
    expect(config.boundedFixture).toBe(true);
  });

  it("rejects invalid release sha", () => {
    expect(() => resolveFhvControlReplayCliConfig({}, ["--release-sha", "not-a-sha"])).toThrow(
      /INVALID_RELEASE_SHA/,
    );
  });

  it("two-run bounded control replay yields CONTROL_REPLAY=PASS", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-control-replay-unit-"));
    try {
      const prep = setupFhvControlReplayArtifacts({
        artifactRoot: root,
        releaseSha: RELEASE_SHA,
        organizationId: ORG_ID,
        operatorId: "unit-control-replay-operator",
      });
      const result = await runFhvControlReplay({
        releaseSha: RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        organizationId: ORG_ID,
        operatorId: "unit-control-replay-operator",
        artifactRoot: join(root, "runs"),
        configurationFreezePath: prep.configurationFreezePathRunOne,
        configurationFreezePathRunTwo: prep.configurationFreezePathRunTwo,
        authorizationReceiptPath: prep.authorizationReceiptPathRunOne,
        authorizationReceiptPathRunTwo: prep.authorizationReceiptPathRunTwo,
        checkoutIdentityProofPathRunOne: prep.checkoutIdentityProofPathRunOne,
        checkoutIdentityProofPathRunTwo: prep.checkoutIdentityProofPathRunTwo,
        datasetQualificationReceiptPath: prep.qualificationReceiptPath,
        boundedFixture: true,
        maxCycles: 10,
        runOneId: `fhv-control-replay-1-${RELEASE_SHA.slice(0, 8)}`,
        runTwoId: `fhv-control-replay-2-${RELEASE_SHA.slice(0, 8)}`,
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
