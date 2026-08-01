/**
 * DEE-436 — FHV bounded launch accounting reconciliation E2E.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { reconcileAccountingInvariants } from "@/lib/trader/accounting/accounting-reconciliation";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  FHV_TEST_RELEASE_SHA,
  setupFhvBoundedLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-accounting-e2e-operator";

describe("DEE-436 FHV accounting reconciliation E2E", () => {
  it("bounded full launch reconciles terminal accounting, PnL, drawdown, and frontier state", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-accounting-e2e-"));
    const runId = "fhv-accounting-e2e-run";
    try {
      const artifacts = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: ORG_ID,
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
        checkoutIdentityProofPath: artifacts.checkoutIdentityProofPath,
        boundedFixture: true,
        maxCycles: 10,
      });

      expect(result.classification).toBe("BOUNDED_FULL_HISTORICAL_END_TO_END_PASS");
      expect(result.backtest?.cycleCount).toBeGreaterThan(0);
      expect(result.semanticReproDigest).toMatch(/^[a-f0-9]{64}$/);

      const state = result.backtest!.accountingState!;
      expect(state.cash).toBeDefined();
      expect(state.equity).toBeDefined();
      expect(state.positions).toBeDefined();
      expect(state.grossRealizedPnl).toBeDefined();
      expect(state.netRealizedPnl).toBeDefined();
      expect(state.equityHwm).toBeDefined();
      expect(state.accountDrawdownBps).toBeTypeOf("number");
      expect(result.backtest?.htrPnlReportV1?.totalExecutionCostUsdt).toBeDefined();
      expect(result.backtest?.htrPnlReportV1).toBeDefined();
      expect(result.backtest?.accountingFrontierState).toBeDefined();

      const reconciliation = reconcileAccountingInvariants({
        state,
        startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      });
      expect(reconciliation.pass).toBe(true);

      const launchResult = JSON.parse(
        readFileSync(join(result.runDir, "fhv-full-launch-result.v1.json"), "utf8"),
      );
      expect(launchResult.evidenceChain.accountingStateDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(launchResult.evidenceChain.htrPnlReportDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
