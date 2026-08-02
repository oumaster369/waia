/**
 * Phase 6/8 — resume launch entrypoint must not rewrite receipt or re-consume authorization.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { readFhvFullHistoricalAuthorizationReceipt } from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  executeFhvFullHistoricalLaunch,
  readFhvFullLaunchReceipt,
  resumeFhvFullHistoricalLaunch,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import {
  FHV_TEST_ORG_ID,
  FHV_TEST_OPERATOR_ID,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  setupFhvBoundedLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const CHECKPOINT_EVERY = 3;

describe("FHV resume entrypoint (Phase 6/8)", () => {
  it("FHV_RESUME_ENTRYPOINT_PASS: resume does not rewrite receipt or re-consume authorization", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-resume-entry-"));
    const runId = "fhv-resume-bounded-run";
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: FHV_TEST_OPERATOR_ID,
      });

      const launchInput = {
        releaseSha: FHV_TEST_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        runId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: FHV_TEST_OPERATOR_ID,
        artifactRoot: root,
        configurationFreezePath: prep.configurationFreezePath,
        authorizationReceiptPath: prep.authorizationReceiptPath,
        authorizationReceiptDigest: prep.authorizationReceiptDigest,
        datasetQualificationReceiptPath: prep.qualificationReceiptPath,
        checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
        boundedFixture: true,
        maxCycles: CHECKPOINT_EVERY,
      };

      const phaseOne = await executeFhvFullHistoricalLaunch(launchInput);
      const receiptPath = join(phaseOne.runDir, "fhv-full-launch-receipt.v1.json");
      const receiptBefore = readFileSync(receiptPath, "utf8");
      const launchReceiptBefore = readFhvFullLaunchReceipt(receiptPath);
      const authBefore = readFhvFullHistoricalAuthorizationReceipt(prep.authorizationReceiptPath);

      expect(authBefore.consumed).toBe(true);

      const authConsumed = readFhvFullHistoricalAuthorizationReceipt(prep.authorizationReceiptPath);
      const phaseTwo = await resumeFhvFullHistoricalLaunch({
        ...launchInput,
        authorizationReceiptDigest: authConsumed.authorizationReceiptDigest,
      });

      const receiptAfter = readFileSync(receiptPath, "utf8");
      expect(receiptAfter).toBe(receiptBefore);

      const launchReceiptAfter = readFhvFullLaunchReceipt(receiptPath);
      expect(launchReceiptAfter.launchReceiptDigest).toBe(launchReceiptBefore.launchReceiptDigest);
      expect(launchReceiptAfter.launchAtUtc).toBe(launchReceiptBefore.launchAtUtc);

      const authAfter = readFhvFullHistoricalAuthorizationReceipt(prep.authorizationReceiptPath);
      expect(authAfter.consumed).toBe(true);
      expect(authAfter.consumedAtUtc).toBe(authBefore.consumedAtUtc);
      expect(authAfter.authorizationReceiptDigest).toBe(authBefore.authorizationReceiptDigest);

      expect(phaseTwo.classification).toBe("BOUNDED_FULL_HISTORICAL_END_TO_END_PASS");
      expect(phaseTwo.backtest?.cycleCount).toBeGreaterThanOrEqual(CHECKPOINT_EVERY);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
