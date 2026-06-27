import { describe, expect, it } from "vitest";

import {
  approveDecision,
  buildRiskSnapshot,
  closeOnlyDecision,
  isTerminalReject,
  mergeReasonCodes,
  rejectDecision,
  resizeDecision,
  riskReasonCodes,
  stopAccountDecision,
} from "@/lib/trader/risk";

const BASE_ORDER = {
  clientOrderId: "risk-decision-1",
  symbol: "BTC/USDT",
  side: "buy" as const,
  type: "limit" as const,
  price: "65000.00",
  quantity: "0.01",
};

describe("trader risk decision contract (DEE-238)", () => {
  it("buildRiskSnapshot captures order metadata", () => {
    const snapshot = buildRiskSnapshot({
      order: BASE_ORDER,
      effectivePrice: "65000.00",
      computedNotional: "650.00",
      checksApplied: ["allowlist", "notional"],
    });

    expect(snapshot.symbol).toBe("BTC/USDT");
    expect(snapshot.side).toBe("buy");
    expect(snapshot.orderType).toBe("limit");
    expect(snapshot.requestedQuantity).toBe("0.01");
    expect(snapshot.effectivePrice).toBe("65000.00");
    expect(snapshot.computedNotional).toBe("650.00");
    expect(snapshot.checksApplied).toEqual(["allowlist", "notional"]);
  });

  it("approveDecision returns APPROVE with empty reason codes", () => {
    const snapshot = buildRiskSnapshot({
      order: BASE_ORDER,
      checksApplied: ["allowlist"],
    });
    const decision = approveDecision(snapshot, "2026-06-14T12:00:00.000Z");

    expect(decision.outcome).toBe("APPROVE");
    expect(decision.reasonCodes).toEqual([]);
    expect(decision.evaluatedAt).toBe("2026-06-14T12:00:00.000Z");
  });

  it("rejectDecision preserves reason codes", () => {
    const snapshot = buildRiskSnapshot({
      order: BASE_ORDER,
      checksApplied: ["allowlist"],
    });
    const decision = rejectDecision(
      [riskReasonCodes.symbolNotAllowed],
      snapshot,
      "2026-06-14T12:00:00.000Z",
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([riskReasonCodes.symbolNotAllowed]);
  });

  it("resizeDecision includes resize hints", () => {
    const snapshot = buildRiskSnapshot({
      order: BASE_ORDER,
      checksApplied: ["notional"],
    });
    const decision = resizeDecision(
      [riskReasonCodes.maxNotionalExceeded],
      snapshot,
      { quantity: "0.005", notional: "325.00" },
      "2026-06-14T12:00:00.000Z",
    );

    expect(decision.outcome).toBe("RESIZE");
    expect(decision.resize).toEqual({ quantity: "0.005", notional: "325.00" });
  });

  it("isTerminalReject identifies hard stops", () => {
    expect(isTerminalReject("REJECT")).toBe(true);
    expect(isTerminalReject("CLOSE_ONLY")).toBe(true);
    expect(isTerminalReject("STOP_ACCOUNT")).toBe(true);
    expect(isTerminalReject("APPROVE")).toBe(false);
    expect(isTerminalReject("RESIZE")).toBe(false);
  });

  it("mergeReasonCodes deduplicates while preserving order", () => {
    expect(
      mergeReasonCodes(
        [riskReasonCodes.symbolNotAllowed],
        [riskReasonCodes.symbolNotAllowed, riskReasonCodes.orderRateExceeded],
      ),
    ).toEqual([riskReasonCodes.symbolNotAllowed, riskReasonCodes.orderRateExceeded]);
  });

  it("closeOnlyDecision returns CLOSE_ONLY with reason codes", () => {
    const snapshot = buildRiskSnapshot({
      order: BASE_ORDER,
      checksApplied: ["position"],
    });
    const decision = closeOnlyDecision(
      [riskReasonCodes.maxPositionPerSymbolExceeded],
      snapshot,
      "2026-06-14T12:00:00.000Z",
    );

    expect(decision.outcome).toBe("CLOSE_ONLY");
    expect(decision.reasonCodes).toEqual([riskReasonCodes.maxPositionPerSymbolExceeded]);
  });

  it("stopAccountDecision returns STOP_ACCOUNT with reason codes", () => {
    const snapshot = buildRiskSnapshot({
      order: BASE_ORDER,
      checksApplied: ["drawdown"],
    });
    const decision = stopAccountDecision(
      [riskReasonCodes.maxDrawdownExceeded],
      snapshot,
      "2026-06-14T12:00:00.000Z",
    );

    expect(decision.outcome).toBe("STOP_ACCOUNT");
    expect(decision.reasonCodes).toEqual([riskReasonCodes.maxDrawdownExceeded]);
  });
});
