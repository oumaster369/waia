import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  executeFhvFullHistoricalLaunch,
  validateFhvFullHistoricalLaunchInput,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import {
  FHV_TEST_RELEASE_SHA,
  setupFhvBoundedLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-full-launch-test-operator";

function buildBaseInput(artifactRoot: string, runId: string) {
  const artifacts = setupFhvBoundedLaunchArtifacts({
    artifactRoot,
    runId,
    releaseSha: FHV_TEST_RELEASE_SHA,
    organizationId: ORG_ID,
    operatorId: OPERATOR_ID,
  });
  return {
    releaseSha: FHV_TEST_RELEASE_SHA,
    runId,
    organizationId: ORG_ID,
    operatorId: OPERATOR_ID,
    artifactRoot,
    configurationFreezePath: artifacts.configurationFreezePath,
    authorizationReceiptPath: artifacts.authorizationReceiptPath,
    authorizationReceiptDigest: artifacts.authorizationReceiptDigest,
    datasetQualificationReceiptPath: artifacts.qualificationReceiptPath,
    boundedFixture: true as const,
    skipCheckoutIdentityVerification: true,
    maxCycles: 10,
  };
}

describe("DEE-436 FHV full launch fail-closed gates", () => {
  it("rejects wrong authorization receipt digest", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    try {
      const input = buildBaseInput(root, "fhv-full-no-auth");
      expect(() =>
        validateFhvFullHistoricalLaunchInput({
          ...input,
          authorizationReceiptDigest: "0".repeat(64),
        }),
      ).toThrow(/authorizationReceiptDigest mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects rehearsal mode", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    try {
      const input = buildBaseInput(root, "fhv-full-rehearsal");
      expect(() => validateFhvFullHistoricalLaunchInput({ ...input, rehearsalMode: true })).toThrow(
        /FHV_REHEARSAL_MODE=true is rejected/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects live exchange path tripwire", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    try {
      const input = buildBaseInput(root, "fhv-full-live-path");
      expect(() =>
        validateFhvFullHistoricalLaunchInput({ ...input, livePathInvoked: true }),
      ).toThrow(/Live exchange path invoked during FHV replay/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects premature holdout access on bounded fixture", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    try {
      const input = buildBaseInput(root, "fhv-full-holdout");
      expect(() =>
        validateFhvFullHistoricalLaunchInput({
          ...input,
          holdoutAccessRequested: true,
        }),
      ).toThrow(/Premature blind holdout access is prohibited/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects reused runId after receipt written", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-"));
    const runId = "fhv-full-reuse-run";
    try {
      const input = buildBaseInput(root, runId);
      await executeFhvFullHistoricalLaunch(input);
      const secondArtifacts = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        prepSuffix: `${runId}-retry-auth`,
        releaseSha: FHV_TEST_RELEASE_SHA,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      await expect(
        executeFhvFullHistoricalLaunch({
          ...input,
          authorizationReceiptPath: secondArtifacts.authorizationReceiptPath,
          authorizationReceiptDigest: secondArtifacts.authorizationReceiptDigest,
          configurationFreezePath: secondArtifacts.configurationFreezePath,
          datasetQualificationReceiptPath: secondArtifacts.qualificationReceiptPath,
        }),
      ).rejects.toMatchObject({
        code: "RUN_ID_REUSED",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("DEE-436 FHV bounded full launch end-to-end", () => {
  it("executes bounded fixture and classifies BOUNDED_FULL_HISTORICAL_END_TO_END_PASS", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-full-launch-e2e-"));
    const runId = `fhv-bounded-e2e-${Date.now()}`;
    try {
      const result = await executeFhvFullHistoricalLaunch(buildBaseInput(root, runId));
      expect(result.classification).toBe("BOUNDED_FULL_HISTORICAL_END_TO_END_PASS");
      expect(result.semanticReproDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
