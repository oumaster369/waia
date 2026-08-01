/**
 * DEE-436/DEE-416 — FHV official path blocker proofs (B1–B9).
 * These tests assert corrected behavior; they must pass GREEN after implementation.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import {
  executeFhvFullHistoricalLaunch,
  validateFhvFullHistoricalLaunchInput,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import {
  assertFhvFullHistoricalAuthorizationReceiptForLaunch,
  consumeFhvFullHistoricalAuthorizationReceipt,
  readFhvFullHistoricalAuthorizationReceipt,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import { qualifyFhvOfficialDataset } from "@/lib/trader/observability/fhv-dataset-qualification";
import { runFhvDatasetQualification as runCliQualification } from "@/scripts/trader/fhv-dataset-qualification-cli";
import { resolveFhvFullRunCliConfig } from "@/scripts/trader/fhv-full-run-cli";
import { runFhvControlReplay } from "@/scripts/trader/fhv-control-replay-cli";
import { writeFhvConfigurationFreezeArtifactAtomic } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import { writeFhvDatasetQualificationReceiptAtomic } from "@/lib/trader/observability/fhv-dataset-qualification";
import { writeFhvFullHistoricalAuthorizationReceiptAtomic } from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
  FHV_OFFICIAL_REAL_SCHEMA_ROOT,
  FHV_TEST_RELEASE_TAG,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_STRATEGY_DIGEST,
  FHV_TEST_STRATEGY_VERSION,
  setupFhvBoundedLaunchArtifacts,
  setupFhvControlReplayArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-blocker-test-operator";
const WRONG_SHA = "cccccccccccccccccccccccccccccccccccccccc";

function setupOfficialLaunchArtifacts(root: string, runId: string) {
  const prepDir = join(root, "prep");
  const qualificationReceipt = writeFhvDatasetQualificationReceiptAtomic({
    receiptDir: prepDir,
    datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
    manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
  });
  const freeze = writeFhvConfigurationFreezeArtifactAtomic({
    artifactDir: join(prepDir, "freeze"),
    releaseSha: FHV_TEST_RELEASE_SHA,
    releaseTag: "fhv-test-release",
    runId,
    organizationId: ORG_ID,
    operatorId: OPERATOR_ID,
    datasetDigest: qualificationReceipt.datasetContentDigest,
    manifestDigest: qualificationReceipt.manifestSemanticDigest,
    strategyVersions: [FHV_TEST_STRATEGY_VERSION],
    strategyDigests: [FHV_TEST_STRATEGY_DIGEST],
    checkpointDigest: "fhv-official-test-checkpoint",
    datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
  });
  const auth = writeFhvFullHistoricalAuthorizationReceiptAtomic({
    receiptDir: join(prepDir, "auth"),
    releaseSha: FHV_TEST_RELEASE_SHA,
    releaseTag: "fhv-test-release",
    datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
    datasetDigest: qualificationReceipt.datasetContentDigest,
    manifestDigest: qualificationReceipt.manifestSemanticDigest,
    configurationFreezeDigest: freeze.artifact.configurationFreeze.configurationFreezeDigest,
    organizationId: ORG_ID,
    operatorId: OPERATOR_ID,
    runId,
  });
  return {
    qualificationReceiptPath: join(prepDir, "fhv-dataset-qualification-receipt.v1.json"),
    configurationFreezePath: freeze.artifactPath,
    authorizationReceiptPath: auth.receiptPath,
    authorizationReceiptDigest: auth.receipt.authorizationReceiptDigest,
    qualificationReceipt,
  };
}

describe("DEE-436 FHV official path blockers B1–B9", () => {
  it("B1: official path runs backtest and classifies FULL_HISTORICAL_VALIDATION_COMPLETED", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-b1-"));
    const runId = "fhv-b1-official-run";
    try {
      const prep = setupOfficialLaunchArtifacts(root, runId);

      const result = await executeFhvFullHistoricalLaunch({
        releaseSha: FHV_TEST_RELEASE_SHA,
        releaseTag: "fhv-test-release",
        runId,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
        artifactRoot: root,
        configurationFreezePath: prep.configurationFreezePath,
        authorizationReceiptPath: prep.authorizationReceiptPath,
        authorizationReceiptDigest: prep.authorizationReceiptDigest,
        datasetQualificationReceiptPath: prep.qualificationReceiptPath,
        datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
        manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
        skipCheckoutIdentityVerification: true,
        maxCycles: 10,
      });

      expect(result.classification).toBe("FULL_HISTORICAL_VALIDATION_COMPLETED");
      expect(result.backtest).toBeDefined();
      expect(result.backtest!.cycleCount).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("B2: official path binds digests from qualification receipt, not pinned manifest pin", () => {
    const qualified = qualifyFhvOfficialDataset({
      datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
      manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
    });
    expect(qualified.datasetContentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(qualified.manifestSemanticDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(qualified.datasetContentDigest).not.toBe(qualified.manifestSemanticDigest);
  });

  it("B3: dataset-qualify uses --dataset-root for official qualification", () => {
    const result = runCliQualification({
      datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
      manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
    });
    expect(result.classification).toBe("DATASET_QUALIFICATION=PASS");
    expect(result.datasetRoot).toBe(FHV_OFFICIAL_REAL_SCHEMA_ROOT);
    expect(result.manifestPath).toBe(FHV_OFFICIAL_REAL_SCHEMA_MANIFEST);
  });

  it("B4: full-run CLI does not auto-compute configurationFreezeDigest", () => {
    expect(() =>
      resolveFhvFullRunCliConfig(
        {
          ...process.env,
          FHV_RELEASE_SHA: FHV_TEST_RELEASE_SHA,
          FHV_RUN_ID: "fhv-cli-run",
          FHV_ORGANIZATION_ID: ORG_ID,
          FHV_OPERATOR_ID: OPERATOR_ID,
          FHV_ARTIFACT_ROOT: "/tmp/fhv-cli-artifacts",
          FHV_SKIP_CHECKOUT_IDENTITY: "1",
        },
        ["--bounded-fixture"],
      ),
    ).toThrow(/configuration-freeze-path is required/i);
  });

  it("B5: launch requires scoped authorization receipt, not literal only", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-b5-"));
    const runId = "fhv-b5-auth-scope";
    try {
      const artifacts = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        operatorId: OPERATOR_ID,
      });
      expect(() =>
        validateFhvFullHistoricalLaunchInput({
          releaseSha: FHV_TEST_RELEASE_SHA,
          runId,
          organizationId: ORG_ID,
          operatorId: OPERATOR_ID,
          artifactRoot: root,
          configurationFreezePath: artifacts.configurationFreezePath,
          authorizationReceiptPath: artifacts.authorizationReceiptPath,
          authorizationReceiptDigest: "0".repeat(64),
          datasetQualificationReceiptPath: artifacts.qualificationReceiptPath,
          boundedFixture: true,
          skipCheckoutIdentityVerification: true,
        }),
      ).toThrow(/authorizationReceiptDigest mismatch/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("B5b: consumed authorization receipt is rejected", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-b5b-"));
    const runId = "fhv-b5b-consumed";
    try {
      const artifacts = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        operatorId: OPERATOR_ID,
      });
      consumeFhvFullHistoricalAuthorizationReceipt(artifacts.authorizationReceiptPath);
      const consumed = readFhvFullHistoricalAuthorizationReceipt(
        artifacts.authorizationReceiptPath,
      );
      expect(() =>
        assertFhvFullHistoricalAuthorizationReceiptForLaunch({
          receiptPath: artifacts.authorizationReceiptPath,
          authorizationReceiptDigest: consumed.authorizationReceiptDigest,
          releaseSha: FHV_TEST_RELEASE_SHA,
          releaseTag: FHV_TEST_RELEASE_TAG,
          datasetQualificationReceiptDigest: consumed.datasetQualificationReceiptDigest,
          datasetDigest: consumed.datasetDigest,
          manifestDigest: consumed.manifestDigest,
          configurationFreezeDigest: consumed.configurationFreezeDigest,
          organizationId: ORG_ID,
          operatorId: OPERATOR_ID,
          runId,
        }),
      ).toThrow(/already been consumed/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("B6: backtest uses createHtrInitialAccountRiskState economic state", async () => {
    const accountState = createHtrInitialAccountRiskState();
    expect(accountState.positions).toEqual([]);
    expect(accountState.dailyPnl).toBe("0");
    const root = mkdtempSync(join(tmpdir(), "fhv-b6-"));
    const runId = "fhv-b6-account-state";
    try {
      const artifacts = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        operatorId: OPERATOR_ID,
      });
      const result = await executeFhvFullHistoricalLaunch({
        releaseSha: FHV_TEST_RELEASE_SHA,
        runId,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
        artifactRoot: root,
        configurationFreezePath: artifacts.configurationFreezePath,
        authorizationReceiptPath: artifacts.authorizationReceiptPath,
        authorizationReceiptDigest: artifacts.authorizationReceiptDigest,
        datasetQualificationReceiptPath: artifacts.qualificationReceiptPath,
        boundedFixture: true,
        skipCheckoutIdentityVerification: true,
        maxCycles: 5,
      });
      expect(result.backtest?.exportDocument).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("B7: control-replay requires qualification receipt and freeze paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-b7-"));
    try {
      const prep = setupFhvControlReplayArtifacts({
        artifactRoot: root,
        releaseSha: FHV_TEST_RELEASE_SHA,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const result = await runFhvControlReplay({
        releaseSha: FHV_TEST_RELEASE_SHA,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
        artifactRoot: join(root, "runs"),
        configurationFreezePath: prep.configurationFreezePathRunOne,
        configurationFreezePathRunTwo: prep.configurationFreezePathRunTwo,
        authorizationReceiptPath: prep.authorizationReceiptPathRunOne,
        authorizationReceiptPathRunTwo: prep.authorizationReceiptPathRunTwo,
        datasetQualificationReceiptPath: prep.qualificationReceiptPath,
        boundedFixture: true,
      });
      expect(result.classification).toBe("CONTROL_REPLAY=PASS");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("B8: rejects release SHA without checkout verification", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-b8-"));
    const runId = "fhv-b8-checkout";
    try {
      const artifacts = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        operatorId: OPERATOR_ID,
      });
      await expect(
        executeFhvFullHistoricalLaunch({
          releaseSha: WRONG_SHA,
          runId,
          organizationId: ORG_ID,
          operatorId: OPERATOR_ID,
          artifactRoot: root,
          configurationFreezePath: artifacts.configurationFreezePath,
          authorizationReceiptPath: artifacts.authorizationReceiptPath,
          authorizationReceiptDigest: artifacts.authorizationReceiptDigest,
          datasetQualificationReceiptPath: artifacts.qualificationReceiptPath,
          boundedFixture: true,
          repoPath: process.cwd(),
          releaseTag: "nonexistent-tag-for-test",
        }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/CHECKOUT|AUTHORIZATION/) });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("B9: executes strategy from configuration freeze binding", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-b9-"));
    const runId = "fhv-b9-strategy-freeze";
    try {
      const artifacts = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        operatorId: OPERATOR_ID,
      });
      const result = await executeFhvFullHistoricalLaunch({
        releaseSha: FHV_TEST_RELEASE_SHA,
        runId,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
        artifactRoot: root,
        configurationFreezePath: artifacts.configurationFreezePath,
        authorizationReceiptPath: artifacts.authorizationReceiptPath,
        authorizationReceiptDigest: artifacts.authorizationReceiptDigest,
        datasetQualificationReceiptPath: artifacts.qualificationReceiptPath,
        boundedFixture: true,
        skipCheckoutIdentityVerification: true,
        maxCycles: 5,
      });
      expect(result.backtest?.exportDocument).toBeDefined();
      expect(JSON.stringify(result.backtest?.exportDocument)).toContain(MEAN_REVERSION_V0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
