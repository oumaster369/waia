/**
 * DEE-436/DEE-416 — FHV final parity closure (R1–R10).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { reconcileAccountingInvariants } from "@/lib/trader/accounting/accounting-reconciliation";
import {
  mergeFhvSharedPortfolioBarsChronologically,
  FhvSharedPortfolioBarReplaySource,
} from "@/lib/trader/market-data/fhv-shared-portfolio-bar-replay-source";
import {
  loadOfficialSharedPortfolioBars,
  qualifyFhvOfficialDataset,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import { revalidateFhvDatasetAtLaunch } from "@/lib/trader/observability/fhv-dataset-launch-guard";
import {
  consumeFhvFullHistoricalAuthorizationReceipt,
  readFhvFullHistoricalAuthorizationReceipt,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";
import { readFhvControlReplayReceipt } from "@/lib/trader/observability/fhv-control-replay-receipt";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { runFhvControlReplay } from "@/scripts/trader/fhv-control-replay-cli";
import {
  FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
  FHV_OFFICIAL_REAL_SCHEMA_ROOT,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  setupFhvBoundedLaunchArtifacts,
  setupFhvControlReplayArtifacts,
  setupFhvOfficialSchemaLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";
import { postgresTestOnlyExecutionV2Authority } from "@/tests/helpers/execution-v2-test-only-postgres";

const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-final-parity-operator";

const pgEnabled =
  process.env.WAIA_PG_INTEGRATION === "1" && !!process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!pgEnabled)("DEE-436/DEE-416 FHV final parity R1–R10", () => {
  it("R1: shared portfolio replay merges BTC and ETH chronologically", () => {
    const bars = loadOfficialSharedPortfolioBars({
      datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
      includeHoldout: true,
    });
    expect(bars.some((bar) => bar.symbol === "BTC/USDT")).toBe(true);
    expect(bars.some((bar) => bar.symbol === "ETH/USDT")).toBe(true);
    const merged = mergeFhvSharedPortfolioBarsChronologically(bars);
    expect(new FhvSharedPortfolioBarReplaySource(merged)).toBeDefined();
  });

  it("R2-R3: official schema launch activates HTR accounting terminal state", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-r2-r3-"));
    const runId = "fhv-r2-r3-official";
    try {
      const prep = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
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
        checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
        controlReplayReceiptPath: prep.controlReplayReceiptPath,
        maxCycles: 10,
      });
      expect(result.backtest?.accountingState).toBeDefined();
      expect(result.backtest?.htrPnlReportV1).toBeDefined();
      expect(result.backtest?.accountingFrontierState).toBeDefined();
      const reconciliation = reconcileAccountingInvariants({
        state: result.backtest!.accountingState!,
        startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      });
      expect(reconciliation.pass).toBe(true);
      const launchResult = JSON.parse(
        readFileSync(join(result.runDir, "fhv-full-launch-result.v1.json"), "utf8"),
      );
      expect(launchResult.evidenceChain.accountingStateDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("R4-R5: control replay uses checkout proof and dual auth without skip bypass", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-r4-r5-"));
    try {
      const prep = setupFhvControlReplayArtifacts({
        artifactRoot: root,
        releaseSha: FHV_TEST_RELEASE_SHA,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const result = await runFhvControlReplay({
        releaseSha: FHV_TEST_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
        artifactRoot: join(root, "runs"),
        configurationFreezePath: prep.configurationFreezePathRunOne,
        configurationFreezePathRunTwo: prep.configurationFreezePathRunTwo,
        authorizationReceiptPath: prep.authorizationReceiptPathRunOne,
        authorizationReceiptPathRunTwo: prep.authorizationReceiptPathRunTwo,
        checkoutIdentityProofPathRunOne: prep.checkoutIdentityProofPathRunOne,
        datasetQualificationReceiptPath: prep.qualificationReceiptPath,
        boundedFixture: true,
        maxCycles: 10,
        runOneId: `fhv-control-replay-1-${FHV_TEST_RELEASE_SHA.slice(0, 8)}`,
        runTwoId: `fhv-control-replay-2-${FHV_TEST_RELEASE_SHA.slice(0, 8)}`,
        testOnlyExecutionV2Authority: postgresTestOnlyExecutionV2Authority,
      });
      expect(result.classification).toBe("CONTROL_REPLAY=PASS");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("R6-R8: schema integration qualification binds fixture classification and launch revalidates digests", () => {
    const qualified = qualifyFhvOfficialDataset({
      datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
      manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
      qualificationMode: "SCHEMA_INTEGRATION_FIXTURE",
      releaseSha: FHV_TEST_RELEASE_SHA,
      releaseTag: "fhv-test-release",
      organizationId: ORG_ID,
      operatorId: OPERATOR_ID,
    });
    expect(qualified.qualificationMode).toBe("SCHEMA_INTEGRATION_FIXTURE");
    expect(qualified.fixtureClassification).toBe("SCHEMA_INTEGRATION_FIXTURE");
    expect(qualified.partitionEvidence?.length).toBe(6);
    expect(qualified.symbolDigests?.BTCUSDT).toMatch(/^[a-f0-9]{64}$/);

    const root = mkdtempSync(join(tmpdir(), "fhv-r6-r8-"));
    try {
      const prep = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-r6-r8-revalidate",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      expect(() =>
        revalidateFhvDatasetAtLaunch({
          datasetQualificationReceiptPath: prep.qualificationReceiptPath,
          datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
          manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("R9: holdout launch requires control replay receipt binding", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-r9-"));
    const runId = "fhv-r9-holdout-gate";
    try {
      const prep = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const auth = readFhvFullHistoricalAuthorizationReceipt(prep.authorizationReceiptPath);
      expect(auth.controlReplayReceiptDigest).toBe(prep.controlReplayReceiptDigest);
      expect(readFhvControlReplayReceipt(prep.controlReplayReceiptPath).classification).toBe(
        "CONTROL_REPLAY=PASS",
      );
      await expect(
        executeFhvFullHistoricalLaunch({
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
          checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
          maxCycles: 5,
        }),
      ).rejects.toMatchObject({ code: "CONTROL_REPLAY_RECEIPT_REQUIRED" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("R10: authorization consumption is atomic and rejects double consume", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-r10-"));
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-r10-auth",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const before = readFileSync(prep.authorizationReceiptPath, "utf8");
      consumeFhvFullHistoricalAuthorizationReceipt(prep.authorizationReceiptPath);
      const after = readFileSync(prep.authorizationReceiptPath, "utf8");
      expect(after).not.toBe(before);
      expect(() =>
        consumeFhvFullHistoricalAuthorizationReceipt(prep.authorizationReceiptPath),
      ).toThrow(/already been consumed/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
