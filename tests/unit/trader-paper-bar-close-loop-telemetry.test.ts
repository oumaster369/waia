import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_TRADER_TELEMETRY_KEYS,
  emitTraderTelemetry,
} from "@/lib/observability/waia-trader-telemetry";
import type { SubmitOrderResult } from "@/lib/trader/execution/execution-service.types";
import type { ReconciliationReport } from "@/lib/trader/execution/reconciliation.types";
import {
  buildPaperBarCloseCycleCompletePayload,
  emitPaperBarCloseCycleComplete,
  type PaperBarCloseCycleCompleteInput,
} from "@/lib/trader/paper/paper-bar-close-loop-telemetry";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { RiskEngineDecision } from "@/lib/trader/risk/evaluate.types";

const ORG = "00000000-0000-4000-8000-0000000266";

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

const REFRESHED_STATE: AccountRiskState = {
  positions: [{ symbol: "BTC/USDT", quantity: "0.01" }],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: { USDT: "650" },
};

function mockEvaluation(outcome: "SIGNAL" | "NO_SIGNAL" = "SIGNAL"): EvaluationCycleResult {
  return {
    features: {
      featureSetId: "feature-set-266",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-01T00:25:00.000Z",
      features: {
        close: "64000",
        sma20: "65000",
        zscoreVsSma20: "-2.5",
        realizedVol20: "300",
        spreadBps: "1.5",
      },
      dataQualityScore: 0.9,
      inputs: { barCount: 25 },
    },
    msv: {
      msvId: "msv-266",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-01T00:25:00.000Z",
      featureSetId: "feature-set-266",
      physics: { close: "64000", zscoreVsSma20: "-2.5", realizedVol20: "300" },
      liquidity: { spreadBps: "1.5" },
      crowd: { fearGreedIndex: null, newsSentiment: "0" },
      futureContext: { eventRiskScore: "0" },
      derived: {
        regime: "TREND_BEAR",
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: ["mean_reversion_v0"],
        riskMultiplier: "1.0",
        dataQualityScore: 0.9,
        reasonCodes: ["CDE_QUALITY_ALLOW_TRADING"],
      },
    },
    signal: {
      strategySignalId: "signal-266",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      organizationId: ORG,
      symbol: "BTC/USDT",
      outcome,
      side: "buy",
      confidence: "0.8",
      expectedEdge: "0.01",
      horizon: "1h",
      maxRisk: "100",
      reasonCodes: ["STRAT_MR_ZSCORE_BUY"],
      msvId: "msv-266",
      featureSetId: "feature-set-266",
      evaluatedAt: "2026-01-01T00:25:00.000Z",
    },
  };
}

function mockReconciliation(
  classification: ReconciliationReport["outcomes"][number]["classification"] = "IN_SYNC",
): ReconciliationReport {
  return {
    organizationId: ORG,
    runStartedAt: new Date(0),
    outcomes: [
      {
        clientOrderId: "client-paper-cycle-test-0",
        classification,
        recordedFills: [],
        markedReconciliationRequired: false,
      },
    ],
    counts: {
      IN_SYNC: classification === "IN_SYNC" ? 1 : 0,
      VENUE_ACKED: 0,
      FILL_PROGRESS: 0,
      VENUE_TERMINALIZED: 0,
      NOT_FOUND_AT_VENUE: 0,
      UNKNOWN_POSITION: classification === "UNKNOWN_POSITION" ? 1 : 0,
      AMBIGUOUS_STALE: 0,
      TERMINAL_DRIFT: 0,
      SKIPPED_CONFLICT: 0,
    },
  };
}

function mockRiskDecision(outcome: RiskEngineDecision["decision"]["outcome"]): RiskEngineDecision {
  return {
    riskDecisionId: "risk-decision-266",
    organizationId: ORG,
    configVersion: 1,
    decision: {
      outcome,
      reasonCodes: ["RISK_MAX_POSITION_PER_SYMBOL"],
      snapshot: {
        symbol: "BTC/USDT",
        side: "buy",
        orderType: "market",
        requestedQuantity: "0.01",
        checksApplied: ["position"],
      },
      evaluatedAt: "2026-01-01T00:25:00.000Z",
    },
  };
}

function baseInput(
  overrides: Partial<Omit<PaperBarCloseCycleCompleteInput, "result">> & {
    result: PaperCycleResult;
  },
): PaperBarCloseCycleCompleteInput {
  return {
    organizationId: ORG,
    cycleId: "test-cycle-266-0",
    cyclesRun: 1,
    durationMs: 42,
    stateRefreshed: false,
    accountStateAfterCycle: EMPTY_STATE,
    ...overrides,
  };
}

describe("paper bar-close loop telemetry (DEE-266)", () => {
  it("maps NO_SIGNAL skip to null execution_status and skip_reason no_signal", () => {
    const result: PaperCycleResult = {
      evaluation: mockEvaluation("NO_SIGNAL"),
      submitBlocked: true,
      skipReason: "no_signal",
      execution: null,
      reconciliation: null,
    };

    const payload = buildPaperBarCloseCycleCompletePayload(
      baseInput({ result, stateRefreshed: false }),
    );

    expect(payload.kind).toBe("paper_loop");
    expect(payload.outcome).toBe("cycle_complete");
    expect(payload.signal_outcome).toBe("NO_SIGNAL");
    expect(payload.skip_reason).toBe("no_signal");
    expect(payload.execution_status).toBeNull();
    expect(payload.risk_outcome).toBeNull();
    expect(payload.severity).toBe("info");
  });

  it("maps no_submit skip", () => {
    const result: PaperCycleResult = {
      evaluation: mockEvaluation("SIGNAL"),
      submitBlocked: true,
      skipReason: "no_submit",
      execution: null,
      reconciliation: null,
    };

    const payload = buildPaperBarCloseCycleCompletePayload(baseInput({ result }));

    expect(payload.skip_reason).toBe("no_submit");
    expect(payload.execution_status).toBeNull();
  });

  it("maps risk_rejected with risk_outcome and info severity for CLOSE_ONLY", () => {
    const execution: SubmitOrderResult = {
      status: "risk_rejected",
      riskDecision: mockRiskDecision("CLOSE_ONLY"),
      order: null,
    };
    const result: PaperCycleResult = {
      evaluation: mockEvaluation("SIGNAL"),
      submitBlocked: false,
      execution,
      reconciliation: null,
    };

    const payload = buildPaperBarCloseCycleCompletePayload(baseInput({ result }));

    expect(payload.execution_status).toBe("risk_rejected");
    expect(payload.risk_outcome).toBe("CLOSE_ONLY");
    expect(payload.severity).toBe("info");
  });

  it("maps submitted with IN_SYNC reconciliation", () => {
    const execution: SubmitOrderResult = {
      status: "submitted",
      order: {} as never,
    };
    const result: PaperCycleResult = {
      evaluation: mockEvaluation("SIGNAL"),
      submitBlocked: false,
      execution,
      reconciliation: mockReconciliation("IN_SYNC"),
    };

    const payload = buildPaperBarCloseCycleCompletePayload(baseInput({ result }));

    expect(payload.execution_status).toBe("submitted");
    expect(payload.reconciliation_classification).toBe("IN_SYNC");
    expect(payload.severity).toBe("info");
  });

  it("uses critical severity for UNKNOWN_POSITION reconciliation", () => {
    const execution: SubmitOrderResult = {
      status: "submitted",
      order: {} as never,
    };
    const result: PaperCycleResult = {
      evaluation: mockEvaluation("SIGNAL"),
      submitBlocked: false,
      execution,
      reconciliation: mockReconciliation("UNKNOWN_POSITION"),
    };

    const payload = buildPaperBarCloseCycleCompletePayload(baseInput({ result }));

    expect(payload.reconciliation_classification).toBe("UNKNOWN_POSITION");
    expect(payload.severity).toBe("critical");
  });

  it("includes refresh metadata with position_symbol_count cardinality only", () => {
    const result: PaperCycleResult = {
      evaluation: mockEvaluation("NO_SIGNAL"),
      submitBlocked: true,
      skipReason: "no_signal",
      execution: null,
      reconciliation: null,
    };

    const payload = buildPaperBarCloseCycleCompletePayload(
      baseInput({
        result,
        stateRefreshed: true,
        accountStateAfterCycle: REFRESHED_STATE,
      }),
    );

    expect(payload.state_refreshed).toBe(true);
    expect(payload.position_symbol_count).toBe(1);
    expect(payload.open_order_count).toBe(0);
    expect(payload).not.toHaveProperty("positions");
    expect(payload).not.toHaveProperty("quote_exposure");
  });

  it("accepts payload through emitTraderTelemetry without forbidden keys", () => {
    const execution: SubmitOrderResult = {
      status: "submitted",
      order: {} as never,
    };
    const result: PaperCycleResult = {
      evaluation: mockEvaluation("SIGNAL"),
      submitBlocked: false,
      execution,
      reconciliation: mockReconciliation("IN_SYNC"),
    };

    const payload = buildPaperBarCloseCycleCompletePayload(
      baseInput({ result, stateRefreshed: true, accountStateAfterCycle: REFRESHED_STATE }),
    );

    const payloadKeys = Object.keys(payload);
    for (const key of FORBIDDEN_TRADER_TELEMETRY_KEYS) {
      expect(payloadKeys).not.toContain(key);
    }

    const explicitForbidden = [
      "account_key",
      "accountKey",
      "symbol",
      "side",
      "notional",
      "pnl",
      "daily_pnl",
      "drawdown",
      "equity",
      "exposure",
      "quote_exposure",
      "positions",
      "balance",
      "ledger",
    ];
    for (const key of explicitForbidden) {
      expect(payloadKeys).not.toContain(key);
    }

    const lines: string[] = [];
    emitPaperBarCloseCycleComplete(
      baseInput({ result, stateRefreshed: true, accountStateAfterCycle: REFRESHED_STATE }),
      (line) => lines.push(line),
    );
    expect(() => emitTraderTelemetry(payload)).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).kind).toBe("paper_loop");
  });
});
