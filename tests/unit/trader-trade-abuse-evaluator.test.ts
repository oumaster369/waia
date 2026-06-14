import { describe, expect, it } from "vitest";

import {
  createInMemoryOrderRateStore,
  evaluateTradeAbuse,
  riskReasonCodes,
  type TradeAbuseLimitsConfig,
} from "@/lib/trader/risk";

const PERMISSIVE_CONFIG: TradeAbuseLimitsConfig = {
  allowedSymbols: ["BTC/USDT", "ETH/USDT"],
  maxNotional: "10000.00",
  maxOrdersPerWindow: 10,
  windowMs: 60_000,
  collarBps: 500,
};

function createDeps(nowMs = 1_700_000_000_000) {
  return {
    nowMs: () => nowMs,
    rateStore: createInMemoryOrderRateStore(),
  };
}

describe("trader trade-abuse evaluator (DEE-238)", () => {
  it("approves an order within all limits", () => {
    const decision = evaluateTradeAbuse(
      {
        order: {
          clientOrderId: "approve-1",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountKey: "org-1:account-1",
      },
      PERMISSIVE_CONFIG,
      createDeps(),
    );

    expect(decision.outcome).toBe("APPROVE");
    expect(decision.reasonCodes).toEqual([]);
    expect(decision.snapshot.computedNotional).toBe("650");
    expect(decision.snapshot.checksApplied).toEqual(["allowlist", "notional", "rate", "collar"]);
  });

  it("rejects symbols outside the allowlist", () => {
    const decision = evaluateTradeAbuse(
      {
        order: {
          clientOrderId: "reject-allowlist",
          symbol: "DOGE/USDT",
          side: "buy",
          type: "limit",
          price: "1.00",
          quantity: "100",
        },
        referencePrice: "1.00",
        accountKey: "org-1:account-1",
      },
      PERMISSIVE_CONFIG,
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([riskReasonCodes.symbolNotAllowed]);
    expect(decision.snapshot.checksApplied).toEqual(["allowlist"]);
  });

  it("rejects all symbols when allowlist is empty", () => {
    const decision = evaluateTradeAbuse(
      {
        order: {
          clientOrderId: "reject-empty-allowlist",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountKey: "org-1:account-1",
      },
      { ...PERMISSIVE_CONFIG, allowedSymbols: [] },
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([riskReasonCodes.symbolNotAllowed]);
  });

  it("resizes when notional exceeds max and quantity can be trimmed", () => {
    const decision = evaluateTradeAbuse(
      {
        order: {
          clientOrderId: "resize-1",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "1",
        },
        referencePrice: "65000.00",
        accountKey: "org-1:account-1",
      },
      { ...PERMISSIVE_CONFIG, maxNotional: "650.00" },
      createDeps(),
    );

    expect(decision.outcome).toBe("RESIZE");
    expect(decision.reasonCodes).toEqual([riskReasonCodes.maxNotionalExceeded]);
    expect(decision.resize?.quantity).toBe("0.01");
    expect(decision.resize?.notional).toBe("650");
  });

  it("rejects when notional exceeds max and quantity trims to zero", () => {
    const decision = evaluateTradeAbuse(
      {
        order: {
          clientOrderId: "reject-notional",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "1",
        },
        referencePrice: "65000.00",
        accountKey: "org-1:account-1",
      },
      { ...PERMISSIVE_CONFIG, maxNotional: "0.00000001" },
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([riskReasonCodes.maxNotionalExceeded]);
  });

  it("rejects when order rate exceeds the configured window", () => {
    const deps = createDeps();
    const config = { ...PERMISSIVE_CONFIG, maxOrdersPerWindow: 2, windowMs: 60_000 };
    const input = {
      order: {
        clientOrderId: "rate-1",
        symbol: "BTC/USDT",
        side: "buy" as const,
        type: "limit" as const,
        price: "65000.00",
        quantity: "0.01",
      },
      referencePrice: "65000.00",
      accountKey: "org-1:account-1",
    };

    expect(evaluateTradeAbuse(input, config, deps).outcome).toBe("APPROVE");
    expect(evaluateTradeAbuse(input, config, deps).outcome).toBe("APPROVE");

    const third = evaluateTradeAbuse(input, config, deps);
    expect(third.outcome).toBe("REJECT");
    expect(third.reasonCodes).toEqual([riskReasonCodes.orderRateExceeded]);
  });

  it("rejects when price is above the collar band", () => {
    const decision = evaluateTradeAbuse(
      {
        order: {
          clientOrderId: "collar-high",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "70000.00",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountKey: "org-1:account-1",
      },
      { ...PERMISSIVE_CONFIG, collarBps: 500 },
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([riskReasonCodes.priceCollarBreached]);
  });

  it("rejects when price is below the collar band", () => {
    const decision = evaluateTradeAbuse(
      {
        order: {
          clientOrderId: "collar-low",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "60000.00",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountKey: "org-1:account-1",
      },
      { ...PERMISSIVE_CONFIG, collarBps: 500 },
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([riskReasonCodes.priceCollarBreached]);
  });

  it("uses referencePrice for market order notional and collar checks", () => {
    const decision = evaluateTradeAbuse(
      {
        order: {
          clientOrderId: "market-1",
          symbol: "BTC/USDT",
          side: "buy",
          type: "market",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountKey: "org-1:account-1",
      },
      PERMISSIVE_CONFIG,
      createDeps(),
    );

    expect(decision.outcome).toBe("APPROVE");
    expect(decision.snapshot.effectivePrice).toBe("65000.00");
    expect(decision.snapshot.computedNotional).toBe("650");
  });

  it("requires referencePrice for market orders", () => {
    expect(() =>
      evaluateTradeAbuse(
        {
          order: {
            clientOrderId: "market-missing-ref",
            symbol: "BTC/USDT",
            side: "buy",
            type: "market",
            quantity: "0.01",
          },
          referencePrice: "0",
          accountKey: "org-1:account-1",
        },
        PERMISSIVE_CONFIG,
        createDeps(),
      ),
    ).toThrow(/referencePrice/);
  });
});
