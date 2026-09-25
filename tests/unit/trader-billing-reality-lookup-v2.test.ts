import { describe, expect, it, vi } from "vitest";

import {
  lookupClosedTradeSettlementsFromRealityV2,
  NAKED_REALIZED_PNL_REFUSED,
  refuseNakedRealizedPnl,
} from "@/lib/trader/billing/v2";
import { proveLiveFillReportingReadable } from "@/lib/trader/live/reporting-bridge";
import {
  createTruthRecordV2,
  type RealityPrimitiveAssertionV2,
  type TruthRecordV2Draft,
} from "@/lib/trader/reality/v2/contracts";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

const ORG = "00000000-0000-4000-8000-000000001027";
const ACCOUNT = "htx-spot-1027";
const STRATEGY = "strat-1027";
// Synthetic same-group USD facts exercise the pure projection only.
// They do not prove real HTX cross-order lifecycle attribution or conversion.
const ORDER = "htx-order-1027";

function digest(label: string): string {
  return computeSemanticSha256Hex({ label });
}

function truth(
  assertion: RealityPrimitiveAssertionV2,
  label: string,
  at: string,
): ReturnType<typeof createTruthRecordV2> {
  const sourceReportId = digest(`source:${label}`);
  const draft: TruthRecordV2Draft = {
    organizationId: ORG,
    accountId: ACCOUNT,
    sourceReportId,
    sourceReportDigestHex: sourceReportId,
    sourceKind: "HTX_SPOT_FILL_REST",
    sourceNativeIdentity: {
      identityKind: assertion.kind === "FILL" ? "HTX_TRADE_ID" : "HTX_TRADE_ID",
      nativeId: label,
      nativeRevision: null,
      supersedesNativeRevision: null,
    },
    subject: {
      subjectClass: assertion.kind === "FILL" ? "FILL" : "REALIZED_CASHFLOW",
      subjectKey: `HTX:${ACCOUNT}:${label}`,
    },
    primitiveAssertion: assertion,
    validAtUtc: at,
    knowledgeAtUtc: at,
    supersedesTruthRecordId: null,
    markers: [],
  };
  return createTruthRecordV2(draft);
}

function buyFill(overrides: Partial<Extract<RealityPrimitiveAssertionV2, { kind: "FILL" }>> = {}) {
  return {
    kind: "FILL" as const,
    venueTradeId: "trade-buy",
    venueOrderId: ORDER,
    symbol: "BTCUSDT",
    side: "buy" as const,
    quantity: "0.001",
    price: "25000",
    feeAmount: "0.025",
    feeAsset: "USD",
    settlementStatus: "SETTLED" as const,
    ...overrides,
  };
}

function sellFill(overrides: Partial<Extract<RealityPrimitiveAssertionV2, { kind: "FILL" }>> = {}) {
  return {
    kind: "FILL" as const,
    venueTradeId: "trade-sell",
    venueOrderId: ORDER,
    symbol: "BTCUSDT",
    side: "sell" as const,
    quantity: "0.001",
    price: "26000",
    feeAmount: "0.026",
    feeAsset: "USD",
    settlementStatus: "SETTLED" as const,
    ...overrides,
  };
}

function cashflow(amount = "1") {
  return {
    kind: "REALIZED_CASHFLOW" as const,
    cashflowId: "cf-1",
    asset: "USD",
    amount,
    direction: "INFLOW" as const,
    causeNativeId: ORDER,
  };
}

describe("DEE-1027 Reality lookup and reporting-bridge quarantine", () => {
  it("projects a fully closed buy/sell lifecycle into one settlement", () => {
    const records = [
      truth(buyFill(), "buy", "2026-09-01T00:00:00.000Z"),
      truth(sellFill(), "sell", "2026-09-01T00:01:00.000Z"),
      truth(cashflow("1"), "cash", "2026-09-01T00:01:01.000Z"),
    ];
    const first = lookupClosedTradeSettlementsFromRealityV2({
      organizationId: ORG,
      accountId: ACCOUNT,
      strategyId: STRATEGY,
      truthRecords: records,
    });
    expect(first.settlements).toHaveLength(1);
    const settlement = first.settlements[0]!;
    expect(settlement.lifecycleState).toBe("FULLY_CLOSED");
    expect(settlement.capitalAuthority).toBe("NONE");
    expect(compareDecimal(settlement.grossRealizedCashflow, "1")).toBe(0);
    expect(compareDecimal(settlement.admittedTradingCosts, "0.051")).toBe(0);
    expect(compareDecimal(settlement.netRealizedCashflow, "0.949")).toBe(0);

    const replay = lookupClosedTradeSettlementsFromRealityV2({
      organizationId: ORG,
      accountId: ACCOUNT,
      strategyId: STRATEGY,
      truthRecords: records,
    });
    expect(replay.settlements[0]?.contentDigestHex).toBe(settlement.contentDigestHex);
    expect(replay.realityFrontierDigestHex).toBe(first.realityFrontierDigestHex);
  });

  it("omits an open remaining quantity instead of billing it", () => {
    const result = lookupClosedTradeSettlementsFromRealityV2({
      organizationId: ORG,
      accountId: ACCOUNT,
      strategyId: STRATEGY,
      truthRecords: [truth(buyFill(), "buy-open", "2026-09-01T00:00:00.000Z")],
    });
    expect(result.settlements).toHaveLength(0);
  });

  it("refuses unlinked deposit-like cashflow as profit", () => {
    expect(() =>
      lookupClosedTradeSettlementsFromRealityV2({
        organizationId: ORG,
        accountId: ACCOUNT,
        strategyId: STRATEGY,
        truthRecords: [
          truth(buyFill(), "buy", "2026-09-01T00:00:00.000Z"),
          truth(sellFill(), "sell", "2026-09-01T00:01:00.000Z"),
          truth(cashflow("1"), "cash", "2026-09-01T00:01:01.000Z"),
          truth(
            {
              kind: "REALIZED_CASHFLOW",
              cashflowId: "deposit-1",
              asset: "USD",
              amount: "500",
              direction: "INFLOW",
              causeNativeId: "deposit-wire-1",
            },
            "deposit",
            "2026-09-01T00:02:00.000Z",
          ),
        ],
      }),
    ).toThrow(/LOOKUP_UNATTRIBUTED_CASHFLOW/);
  });

  it("refuses mixed SETTLED/OBSERVED fills on a flattened lifecycle", () => {
    expect(() =>
      lookupClosedTradeSettlementsFromRealityV2({
        organizationId: ORG,
        accountId: ACCOUNT,
        strategyId: STRATEGY,
        truthRecords: [
          truth(buyFill(), "buy", "2026-09-01T00:00:00.000Z"),
          truth(sellFill({ settlementStatus: "OBSERVED" }), "sell", "2026-09-01T00:01:00.000Z"),
          truth(cashflow("1"), "cash", "2026-09-01T00:01:01.000Z"),
        ],
      }),
    ).toThrow(/LOOKUP_FILL_NOT_SETTLED/);
  });

  it("refuses org/account mismatch", () => {
    const foreign = truth(buyFill(), "buy", "2026-09-01T00:00:00.000Z");
    expect(() =>
      lookupClosedTradeSettlementsFromRealityV2({
        organizationId: ORG,
        accountId: "other-account",
        strategyId: STRATEGY,
        truthRecords: [foreign],
      }),
    ).toThrow(/LOOKUP_SCOPE_MISMATCH/);
  });

  it("refuses live reporting-bridge fill-walk authority before any HWM write", async () => {
    const hwmLedger = {
      getCurrentHwm: async () => {
        throw new Error("hwm must not run before naked refuse");
      },
      bootstrapHwm: async () => {
        throw new Error("hwm must not run before naked refuse");
      },
    };
    await expect(
      proveLiveFillReportingReadable({
        context: requireOrgContext(ORG),
        orderRepository: {} as never,
        reportingBridge: {} as never,
        feeComputation: {} as never,
        hwmLedger,
        exchangeAccountId: ACCOUNT,
      }),
    ).rejects.toMatchObject({ code: NAKED_REALIZED_PNL_REFUSED });
    expect(() => refuseNakedRealizedPnl()).toThrow(/NAKED_REALIZED_PNL_REFUSED/);
  });
});

describe("DEE-1102 billing denomination and finality boundary", () => {
  function records(feeAsset = "USD", cashAsset = "USD", feeAmount = "0.025") {
    return [
      truth(buyFill({ feeAsset, feeAmount }), "buy", "2026-09-01T00:00:00.000Z"),
      truth(sellFill(), "sell", "2026-09-01T00:01:00.000Z"),
      truth({ ...cashflow(), asset: cashAsset }, "cash", "2026-09-01T00:01:01.000Z"),
    ];
  }
  it.each(["BTC", "USDT", "USDC", "UNKNOWN"])(
    "refuses %s fee units without conversion evidence",
    (asset) => {
      expect(() =>
        lookupClosedTradeSettlementsFromRealityV2({
          organizationId: ORG,
          accountId: ACCOUNT,
          strategyId: STRATEGY,
          truthRecords: records(asset),
        }),
      ).toThrow("LOOKUP_COST_CONVERSION_EVIDENCE_REQUIRED");
    },
  );
  it.each(["BTC", "USDT", "USDC", "UNKNOWN"])(
    "refuses %s cashflow units without conversion evidence",
    (asset) => {
      expect(() =>
        lookupClosedTradeSettlementsFromRealityV2({
          organizationId: ORG,
          accountId: ACCOUNT,
          strategyId: STRATEGY,
          truthRecords: records("USD", asset),
        }),
      ).toThrow("LOOKUP_CASHFLOW_CONVERSION_EVIDENCE_REQUIRED");
    },
  );
  it("does not require conversion of an exact zero cost", () => {
    const result = lookupClosedTradeSettlementsFromRealityV2({
      organizationId: ORG,
      accountId: ACCOUNT,
      strategyId: STRATEGY,
      truthRecords: records("BTC", "USD", "0"),
    });
    expect(compareDecimal(result.settlements[0]!.admittedTradingCosts, "0.026")).toBe(0);
  });
  it("does not bill or convert fees on an unrelated open position", () => {
    const result = lookupClosedTradeSettlementsFromRealityV2({
      organizationId: ORG,
      accountId: ACCOUNT,
      strategyId: STRATEGY,
      truthRecords: [
        ...records(),
        truth(
          buyFill({ venueOrderId: "unrelated-open", feeAsset: "BTC" }),
          "open",
          "2026-09-01T00:02:00.000Z",
        ),
      ],
    });
    expect(result.settlements).toHaveLength(1);
    expect(compareDecimal(result.settlements[0]!.admittedTradingCosts, "0.051")).toBe(0);
  });
  it("denies unconverted evidence before HWM or reporting writes", async () => {
    const getCurrentHwm = vi.fn();
    const bootstrapHwm = vi.fn();
    await expect(
      proveLiveFillReportingReadable({
        context: requireOrgContext(ORG),
        orderRepository: {} as never,
        reportingBridge: {} as never,
        feeComputation: {} as never,
        hwmLedger: { getCurrentHwm, bootstrapHwm },
        exchangeAccountId: ACCOUNT,
        canonicalProfit: { strategyId: STRATEGY, truthRecords: records("BTC") },
      }),
    ).rejects.toMatchObject({ code: "LOOKUP_COST_CONVERSION_EVIDENCE_REQUIRED" });
    expect(getCurrentHwm).not.toHaveBeenCalled();
    expect(bootstrapHwm).not.toHaveBeenCalled();
  });
  it("never substitutes proof execution for an operator finality attestation", async () => {
    const computeFeeForPeriod = vi.fn(async () => ({ periodRealizedStrategyProfit: "0.94900000" }));
    const result = await proveLiveFillReportingReadable({
      context: requireOrgContext(ORG),
      orderRepository: {} as never,
      reportingBridge: {
        findOpenPeriod: async () => ({
          id: "period",
          periodStart: new Date("2026-09-01T00:00:00.000Z"),
        }),
        closeReportingPeriod: async () => ({ id: "period" }),
      } as never,
      feeComputation: { computeFeeForPeriod } as never,
      hwmLedger: { getCurrentHwm: async () => ({}) as never, bootstrapHwm: vi.fn() },
      exchangeAccountId: ACCOUNT,
      canonicalProfit: { strategyId: STRATEGY, truthRecords: records() },
    });
    expect(result.periodRealizedStrategyProfit).toBe("0.94900000");
    expect(computeFeeForPeriod).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ realizedFillFinality: false }),
    );
  });
});
