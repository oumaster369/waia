/**
 * Phase 5/8 — execution purpose literal guard (FULL_HISTORICAL only).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  FhvFullHistoricalLaunchError,
  resolveFhvLaunchExecutionPurpose,
  validateFhvFullHistoricalLaunchInput,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import {
  FHV_TEST_ORG_ID,
  FHV_TEST_OPERATOR_ID,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  setupFhvBoundedLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

describe("FHV execution purpose literal (Phase 5/8)", () => {
  it("FHV_PURPOSE_FULL_HISTORICAL_ONLY_PASS: rejects FULL_HISTORICAL_VALIDATION as purpose", () => {
    expect(() =>
      resolveFhvLaunchExecutionPurpose({ executionPurpose: "FULL_HISTORICAL_VALIDATION" }),
    ).toThrow(FhvFullHistoricalLaunchError);

    try {
      resolveFhvLaunchExecutionPurpose({ executionPurpose: "FULL_HISTORICAL_VALIDATION" });
    } catch (error) {
      expect(error).toBeInstanceOf(FhvFullHistoricalLaunchError);
      expect((error as FhvFullHistoricalLaunchError).code).toBe("INVALID_PURPOSE_LITERAL");
    }
  });

  it("accepts FULL_HISTORICAL and defaults undefined to FULL_HISTORICAL", () => {
    expect(resolveFhvLaunchExecutionPurpose({ executionPurpose: "FULL_HISTORICAL" })).toBe(
      "FULL_HISTORICAL",
    );
    expect(resolveFhvLaunchExecutionPurpose({})).toBe("FULL_HISTORICAL");
  });

  it("validateFhvFullHistoricalLaunchInput rejects legacy purpose before consume", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-purpose-literal-"));
    const runId = "fhv-purpose-literal-run";
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: FHV_TEST_OPERATOR_ID,
      });

      expect(() =>
        validateFhvFullHistoricalLaunchInput({
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
          executionPurpose: "FULL_HISTORICAL_VALIDATION" as never,
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_PURPOSE_LITERAL" }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
