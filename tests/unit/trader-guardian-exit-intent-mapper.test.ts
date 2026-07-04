import { describe, expect, it } from "vitest";

import {
  GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
  mapExitIntentToSubmitOrder,
  type ExitIntent,
} from "@/lib/trader/guardian";

describe("mapExitIntentToSubmitOrder (M3)", () => {
  const intent: ExitIntent = {
    intentId: "cycle-1:lot-1:exit",
    evaluationId: "cycle-1:lot-1",
    kind: "CLOSE_LONG",
    positionLotId: "lot-1",
    tradeId: "trade-1",
    symbol: "BTC/USDT",
    side: "sell",
    quantity: "0.01",
    openingStrategySignalId: "signal-open-1",
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.0",
    referencePrice: "65000",
    accountKey: "paper",
    clientOrderId: "client-guardian-cycle-1-lot-1",
    idempotencyKey: "idem-guardian-cycle-1-lot-1",
    reason: {
      schemaVersion: GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
      decision: "EXIT_FULL",
      reasonCode: "GUARDIAN_CLOSE_ONLY_PERMISSION",
      ruleId: "CLOSE_ONLY_PERMISSION",
      cycleId: "cycle-1",
      evaluatedAt: "2026-01-01T00:05:00.000Z",
      symbol: "BTC/USDT",
      positionLotId: "lot-1",
      tradeId: "trade-1",
      strategyId: "mean_reversion_v0",
      openingStrategySignalId: "signal-open-1",
      regime: "RANGE",
      tradingPermission: "ONLY_CLOSE_POSITIONS",
      remainingQty: "0.01",
      avgCost: "64000",
      markPrice: "65000",
      unrealizedPnlUsdt: "10",
      barsHeld: 6,
      slTpLevels: null,
      rMultiple: null,
      invalidation: null,
      patternRefs: [],
      signalRefs: [],
      exitIntelligenceContext: null,
    },
  };

  it("maps sell order preserving opening strategy signal id for M1 pairing", () => {
    const submit = mapExitIntentToSubmitOrder(intent, "mock");
    expect(submit.side).toBe("sell");
    expect(submit.strategySignalId).toBe("signal-open-1");
    expect(submit.quantity).toBe("0.01");
    expect(submit.executionMode).toBe("mock");
  });
});
