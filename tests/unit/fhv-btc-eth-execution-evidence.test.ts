/**
 * DEE-436 — FHV BTC/ETH real execution and economic evidence.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { reconcileAccountingInvariants } from "@/lib/trader/accounting/accounting-reconciliation";
import { readSegmentProjections } from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";
import { runScientificControlReplayV2Ceremony } from "@/lib/trader/observability/control-replay-scientific-v2-driver-v1";
import {
  FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
  FHV_OFFICIAL_REAL_SCHEMA_ROOT,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  setupFhvOfficialSchemaLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { postgresTestOnlyExecutionV2Authority } from "@/tests/helpers/execution-v2-test-only-postgres";

const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-btc-eth-evidence-operator";
const pgEnabled =
  process.env.WAIA_PG_INTEGRATION === "1" && !!process.env.DATABASE_URL_POSTGRES?.trim();

type SymbolEvidence = {
  evaluationCount: number;
  submittedOrderCount: number;
  simulatedFillCount: number;
};

function normalizeEvidenceSymbol(symbol: string): "BTC" | "ETH" | null {
  const normalized = symbol.replace("/", "").toUpperCase();
  if (normalized.startsWith("BTC")) {
    return "BTC";
  }
  if (normalized.startsWith("ETH")) {
    return "ETH";
  }
  return null;
}

function collectSymbolEvidence(input: {
  projections: ReturnType<typeof readSegmentProjections>;
  accountingPositions: Record<string, { quantity: string }> | undefined;
}): Map<"BTC" | "ETH", SymbolEvidence> {
  const evidence = new Map<"BTC" | "ETH", SymbolEvidence>();
  const ensure = (symbol: "BTC" | "ETH"): SymbolEvidence => {
    const existing = evidence.get(symbol);
    if (existing) {
      return existing;
    }
    const created = { evaluationCount: 0, submittedOrderCount: 0, simulatedFillCount: 0 };
    evidence.set(symbol, created);
    return created;
  };

  for (const projection of input.projections) {
    const msv = projection.msv as { instrumentId?: string };
    const symbol = normalizeEvidenceSymbol(msv.instrumentId ?? "");
    if (!symbol) {
      continue;
    }
    const bucket = ensure(symbol);
    bucket.evaluationCount += 1;
    for (const execution of projection.strategyExecutions) {
      if (execution.executionStatus === "submitted" || execution.orderId) {
        bucket.submittedOrderCount += 1;
      }
      if (
        execution.executionStatus === "filled" ||
        execution.orderState === "FILLED" ||
        execution.orderState === "PARTIALLY_FILLED"
      ) {
        bucket.simulatedFillCount += 1;
      }
    }
  }

  for (const symbol of ["BTC", "ETH"] as const) {
    const instrumentKey = `${symbol}USDT`;
    const quantity = input.accountingPositions?.[instrumentKey]?.quantity ?? "0";
    if (Number.parseFloat(quantity) > 0) {
      ensure(symbol).simulatedFillCount = Math.max(ensure(symbol).simulatedFillCount, 1);
    }
  }

  return evidence;
}

describe.skipIf(!pgEnabled)("DEE-436 FHV BTC/ETH execution evidence", () => {
  it("FHV_BTC_ETH_V2_AUTHORITY_AND_LEGACY_EFFECT_FAIL_CLOSED", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-btc-eth-"));
    const runId = "fhv-btc-eth-evidence-run";
    try {
      const prep = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const result = await executeFhvFullHistoricalLaunch({
        releaseSha: FHV_TEST_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
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
      });

      expect(result.classification).toBe("FHV_SCHEMA_INTEGRATION_CEREMONY_PASS");
      expect(result.backtest?.cycleCount).toBeGreaterThan(0);

      const bySymbol = collectSymbolEvidence({
        projections: readSegmentProjections(result.runDir),
        accountingPositions: result.backtest!.accountingState?.positions,
      });

      for (const symbol of ["BTC", "ETH"] as const) {
        const bucket = bySymbol.get(symbol);
        expect(bucket?.evaluationCount, `${symbol} decisions`).toBeGreaterThan(0);
        expect(bucket?.submittedOrderCount, `${symbol} legacy submitted orders`).toBe(0);
        expect(bucket?.simulatedFillCount, `${symbol} fabricated fills`).toBe(0);
      }

      expect(result.backtest?.exportBundle?.historicalExecutionCost?.fills ?? []).toHaveLength(0);
      expect(result.backtest!.accountingState?.cash).toBe(
        HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      );

      for (const symbol of ["BTCUSDT", "ETHUSDT"] as const) {
        const authority = await runScientificControlReplayV2Ceremony({
          organizationId: ORG_ID,
          symbol,
          testOnlyExecutionV2Authority: postgresTestOnlyExecutionV2Authority,
        });
        expect(authority.executionV2AuthorityProof).toMatchObject({
          reservationTransferredToPending: true,
          restartPreservedEffectIdentity: true,
          networkSubmissionCalls: 1,
          restartSubmissionCalls: 0,
          terminalStatus: "RECONCILIATION_REQUIRED",
        });
        expect(authority.executionQuantity).toBe("0");
        expect(authority.fillId).toBeNull();
      }

      expect(result.backtest?.exportBundle?.cycleCount).toBeGreaterThan(0);
      expect(result.backtest?.exportBundle?.strategyEvaluations.length).toBeGreaterThan(0);

      const reconciliation = reconcileAccountingInvariants({
        state: result.backtest!.accountingState!,
        startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      });
      expect(reconciliation.pass).toBe(true);
      expect(result.backtest?.htrPnlReportV1).toBeDefined();
      expect(result.backtest?.drawdownHwmState).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
