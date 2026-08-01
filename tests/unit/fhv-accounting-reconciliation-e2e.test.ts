/**
 * DEE-436 — FHV bounded launch accounting reconciliation E2E.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createInitialAccountingState } from "@/lib/trader/accounting";
import { reconcileAccountingInvariants } from "@/lib/trader/accounting/accounting-reconciliation";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";
import {
  createHtrInitialAccountRiskState,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  FHV_TEST_RELEASE_SHA,
  setupFhvBoundedLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-accounting-e2e-operator";

describe("DEE-436 FHV accounting reconciliation E2E", () => {
  it("initial portfolio state and bounded full launch reconcile accounting invariants", async () => {
    const initial = createHtrInitialAccountRiskState();
    const initialReconciliation = reconcileAccountingInvariants({
      state: createInitialAccountingState({
        organizationId: ORG_ID,
        accountKey: "fhv-accounting-e2e",
        runId: "fhv-accounting-e2e-run",
      }),
      startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    });
    expect(initialReconciliation.pass).toBe(true);
    expect(initial.positions).toEqual([]);

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
        boundedFixture: true,
        skipCheckoutIdentityVerification: true,
        maxCycles: 10,
      });

      expect(result.classification).toBe("BOUNDED_FULL_HISTORICAL_END_TO_END_PASS");
      expect(result.backtest?.cycleCount).toBeGreaterThan(0);
      expect(result.semanticReproDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
