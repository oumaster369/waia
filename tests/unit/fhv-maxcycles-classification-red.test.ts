/**
 * Phase 5/8 — maxCycles gated by synthetic scale authority on OFFICIAL_MULTI_YEAR.
 */

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { readFhvConfigurationFreezeArtifact } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import type { FhvDatasetQualificationReceiptV1 } from "@/lib/trader/observability/fhv-dataset-qualification";
import {
  assertFhvSyntheticScaleAuthorityForLaunch,
  buildFhvSyntheticScaleAuthority,
  FHV_SYNTHETIC_SCALE_AUTHORITY_FILENAME,
  writeFhvSyntheticScaleAuthorityAtomic,
} from "@/lib/trader/observability/fhv-synthetic-scale-authority";
import {
  assertFhvSyntheticScaleAuthorityRequired,
  resolveFhvFullHistoricalTerminalClassification,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import { FHV_EXECUTION_PURPOSE_FULL_HISTORICAL } from "@/lib/trader/observability/fhv-execution-purpose";
import {
  FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
  FHV_TEST_ORG_ID,
  FHV_TEST_OPERATOR_ID,
  setupFhvBoundedLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const OFFICIAL_MULTI_YEAR_RECEIPT = {
  qualificationMode: "OFFICIAL_MULTI_YEAR",
} as FhvDatasetQualificationReceiptV1;

describe("FHV maxCycles classification (Phase 5/8)", () => {
  it("FHV_MAXCYCLES_AUTHORITY_REQUIRED: OFFICIAL_MULTI_YEAR maxCycles without authority fails", () => {
    expect(() =>
      assertFhvSyntheticScaleAuthorityRequired({
        qualificationReceipt: OFFICIAL_MULTI_YEAR_RECEIPT,
        maxCycles: 10,
      }),
    ).toThrow(expect.objectContaining({ code: "SYNTHETIC_AUTHORITY_REQUIRED" }));
  });

  it("FHV_MAXCYCLES_SYNTHETIC_CLASS_PASS: authority binds and yields synthetic terminal classification", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-maxcycles-auth-"));
    const runId = "fhv-maxcycles-auth-run";
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: FHV_TEST_ORG_ID,
        operatorId: FHV_TEST_OPERATOR_ID,
      });
      const freezeArtifact = readFhvConfigurationFreezeArtifact(prep.configurationFreezePath);
      const authorityDir = join(root, "prep", runId);
      mkdirSync(authorityDir, { recursive: true });
      const authorityPath = join(authorityDir, FHV_SYNTHETIC_SCALE_AUTHORITY_FILENAME);
      const authority = buildFhvSyntheticScaleAuthority({
        runId,
        organizationId: FHV_TEST_ORG_ID,
        releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
        datasetContentDigest: freezeArtifact.configurationFreeze.datasetDigest,
        manifestSemanticDigest: freezeArtifact.configurationFreeze.manifestDigest,
        maxCycles: 10,
        targetCycleCount: 10,
        checkpointEveryCycles: 5,
      });
      writeFhvSyntheticScaleAuthorityAtomic(authorityPath, authority);

      expect(() =>
        assertFhvSyntheticScaleAuthorityForLaunch({
          authority,
          executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
          runId,
          organizationId: FHV_TEST_ORG_ID,
          releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
          datasetContentDigest: freezeArtifact.configurationFreeze.datasetDigest,
          manifestSemanticDigest: freezeArtifact.configurationFreeze.manifestDigest,
          maxCycles: 10,
        }),
      ).not.toThrow();

      const classification = resolveFhvFullHistoricalTerminalClassification({
        qualificationReceipt: OFFICIAL_MULTI_YEAR_RECEIPT,
        maxCycles: 10,
        syntheticScaleAuthority: authority,
        sourceExhausted: false,
      });
      expect(classification).toBe("FHV_SYNTHETIC_SCALE_PROBE_COMPLETED");
      expect(classification).not.toBe("FULL_HISTORICAL_VALIDATION_COMPLETED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("OFFICIAL_MULTI_YEAR full corpus completion maps to FULL_HISTORICAL_TECHNICAL_COMPLETION", () => {
    const classification = resolveFhvFullHistoricalTerminalClassification({
      qualificationReceipt: OFFICIAL_MULTI_YEAR_RECEIPT,
      sourceExhausted: true,
    });
    expect(classification).toBe("FULL_HISTORICAL_TECHNICAL_COMPLETION");
    expect(classification).not.toBe("FULL_HISTORICAL_VALIDATION_COMPLETED");
  });

  it("technicalObservationMode pause at checkpoint maps to FHV_SYNTHETIC_PROCESS_PARITY_PAUSED", () => {
    const authority = buildFhvSyntheticScaleAuthority({
      runId: "fhv-pause-class",
      organizationId: FHV_TEST_ORG_ID,
      releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
      datasetContentDigest: "d".repeat(64),
      manifestSemanticDigest: "m".repeat(64),
      maxCycles: 3997,
      targetCycleCount: 4509,
      checkpointEveryCycles: 3997,
      technicalObservationMode: true,
    });
    expect(
      resolveFhvFullHistoricalTerminalClassification({
        qualificationReceipt: OFFICIAL_MULTI_YEAR_RECEIPT,
        maxCycles: 3997,
        syntheticScaleAuthority: authority,
        sourceExhausted: false,
        paused: true,
      }),
    ).toBe("FHV_SYNTHETIC_PROCESS_PARITY_PAUSED");
  });

  it("technicalObservationMode segment completion maps to FHV_SYNTHETIC_PROCESS_PARITY_SEGMENT_COMPLETED", () => {
    const authority = buildFhvSyntheticScaleAuthority({
      runId: "fhv-segment-class",
      organizationId: FHV_TEST_ORG_ID,
      releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
      datasetContentDigest: "d".repeat(64),
      manifestSemanticDigest: "m".repeat(64),
      maxCycles: 4509,
      targetCycleCount: 4509,
      checkpointEveryCycles: 3997,
      technicalObservationMode: true,
    });
    expect(
      resolveFhvFullHistoricalTerminalClassification({
        qualificationReceipt: OFFICIAL_MULTI_YEAR_RECEIPT,
        maxCycles: 4509,
        syntheticScaleAuthority: authority,
        sourceExhausted: false,
        paused: false,
      }),
    ).toBe("FHV_SYNTHETIC_PROCESS_PARITY_SEGMENT_COMPLETED");
  });
});
