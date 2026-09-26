import { describe, expect, it, vi } from "vitest";

import {
  admitCanonicalPeriodProfitFromReceiptV2,
  assessBillingV2,
  billingPeriodReportingScopeIdV2,
  buildCanonicalBillingPolicyV2,
  buildClosedTradeSettlementV2,
  buildRealizedStrategyProfitReceiptV2,
  type ClosedTradeSettlementV2,
} from "@/lib/trader/billing/v2";
import { assertClosedTradeSettlementV2 } from "@/lib/trader/billing/v2/closed-trade-settlement-v2";
import { assertCanonicalBillingPolicyV2 } from "@/lib/trader/billing/v2/billing-policy-v2";
import { createBillingPeriodCloseOrchestrator } from "@/lib/trader/billing/billing-period-close-orchestrator";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { compareDecimal } from "@/lib/trader/risk/numeric";

const periodStart = new Date("2026-09-01T00:00:00.000Z");
const periodEnd = new Date("2026-09-08T00:00:00.000Z");
const scope = { organizationId: "integrity-org", accountId: "integrity-account" };
const reportingScopeId = billingPeriodReportingScopeIdV2({ ...scope, periodStart, periodEnd });
const policy = buildCanonicalBillingPolicyV2();

function settlement() {
  return buildClosedTradeSettlementV2({
    ...scope,
    strategyId: "integrity-strategy",
    symbol: "BTCUSD",
    lifecycleId: "synthetic-closed-lifecycle",
    lifecycleState: "FULLY_CLOSED",
    remainingQuantity: "0",
    realityFrontierDigestHex: "1".repeat(64),
    openingFillTruthRecordDigests: ["a".repeat(64)],
    closingFillTruthRecordDigests: ["b".repeat(64)],
    partialFillTruthRecordDigests: [],
    cashflowFacts: [
      { truthRecordDigestHex: "c".repeat(64), amount: "100", cause: "STRATEGY_REALIZED" },
    ],
    costFacts: [{ truthRecordDigestHex: "d".repeat(64), amount: "2", admitted: true }],
    supersedesSettlementDigestHex: null,
  });
}
function receipt(closed = settlement()) {
  return buildRealizedStrategyProfitReceiptV2({
    ...scope,
    strategyId: closed.strategyId,
    reportingScopeId,
    realityFrontierDigestHex: closed.realityFrontierDigestHex,
    settlements: [closed],
  });
}
function reseal<T extends { contentDigestHex: string }>(value: T): T {
  const { contentDigestHex, ...body } = value;
  void contentDigestHex;
  return { ...value, contentDigestHex: computeSemanticSha256Hex(body) };
}

describe("billing serialized content integrity", () => {
  it.each([
    ["grossRealizedCashflow", "1000000"],
    ["admittedTradingCosts", "0"],
    ["netRealizedCashflow", "1000000"],
    ["cashflowTruthRecordDigests", ["e".repeat(64)]],
    ["admittedCostTruthRecordDigests", []],
    ["schemaVersion", "unsupported"],
    ["accountingPolicyVersion", "unsupported"],
    ["capitalAuthority", "ALLOWED"],
    ["venueWriteAuthority", "ALLOWED"],
  ])("rejects settlement field %s changed under the original digest", (key, value) => {
    const changed = { ...settlement(), [key as string]: value } as ClosedTradeSettlementV2;
    expect(() => assertClosedTradeSettlementV2(changed)).toThrow("CLOSED_TRADE_DIGEST_MISMATCH");
  });

  it("rejects rehashed totals that disagree with primitive cashflow/cost facts", () => {
    const changed = reseal({ ...settlement(), netRealizedCashflow: "1000000" });
    expect(() => assertClosedTradeSettlementV2(changed)).toThrow("CLOSED_TRADE_DIGEST_MISMATCH");
  });

  it.each([
    ["schemaVersion", "unsupported"],
    ["policyVersion", "unsupported"],
    ["performanceFeeRate", "0.99"],
    ["billingCurrency", "BTC"],
    ["minimumThreshold", "999"],
    ["roundingPolicy", "ROUND_UP"],
    ["reportingPeriodPolicy", "CUSTOM"],
    ["effectiveFromUtc", "2030-01-01T00:00:00.000Z"],
    ["capitalAuthority", "ALLOWED"],
  ])("rejects canonical policy field %s changed under its original digest", (key, value) => {
    expect(() => assertCanonicalBillingPolicyV2({ ...policy, [key]: value })).toThrow(
      /BILLING_POLICY/,
    );
  });

  it("rejects a rehashed noncanonical policy", () => {
    expect(() =>
      assertCanonicalBillingPolicyV2(reseal({ ...policy, minimumThreshold: "999" } as never)),
    ).toThrow("BILLING_POLICY_NOT_CANONICAL");
  });

  it("refuses altered settlement totals at receipt construction", () => {
    expect(() => receipt({ ...settlement(), netRealizedCashflow: "1000000" })).toThrow(
      "CLOSED_TRADE_DIGEST_MISMATCH",
    );
  });

  // A receipt can be deserialized with a valid self-hash. Its referenced settlement
  // must still be checked; neither object hash proves durable Reality provenance.
  function alteredEvidence() {
    const closed = { ...settlement(), netRealizedCashflow: "1000000" };
    const changedReceipt = reseal({ ...receipt(), netRealizedStrategyProfit: "1000000" });
    return { closed, changedReceipt };
  }

  it("refuses altered totals before computing fee/HWM", () => {
    const { closed, changedReceipt } = alteredEvidence();
    expect(() =>
      assessBillingV2({
        receipt: changedReceipt,
        settlements: [closed],
        priorHwm: { namespace: "BILLING_HWM", highWaterMark: "0", eventDigestHex: null },
        policy,
        assessedAtUtc: periodEnd.toISOString(),
      }),
    ).toThrow("CLOSED_TRADE_DIGEST_MISMATCH");
  });

  it("refuses altered totals at canonical period-profit admission", () => {
    const { closed, changedReceipt } = alteredEvidence();
    expect(() =>
      admitCanonicalPeriodProfitFromReceiptV2({
        ...scope,
        receipt: changedReceipt,
        settlements: [closed],
        expectedReportingScopeId: reportingScopeId,
      }),
    ).toThrow("CLOSED_TRADE_DIGEST_MISMATCH");
  });

  it("refuses altered totals before period, HWM or draft writes", async () => {
    const { closed, changedReceipt } = alteredEvidence();
    const findOpenPeriod = vi.fn().mockResolvedValue(null);
    const listClosedPeriods = vi.fn().mockResolvedValue([]);
    const getCurrentHwm = vi.fn().mockResolvedValue(null);
    const bootstrapHwm = vi.fn();
    const openReportingPeriod = vi.fn();
    const closeReportingPeriod = vi.fn();
    const getDraftInvoiceByPeriod = vi.fn();
    const orchestrator = createBillingPeriodCloseOrchestrator({
      reportingPeriodLifecycle: {
        findOpenPeriod,
        listClosedPeriods,
        openReportingPeriod,
        closeReportingPeriod,
      },
      hwmLedger: { getCurrentHwm, bootstrapHwm },
      draftInvoiceService: { getDraftInvoiceByPeriod },
    } as never);
    await expect(
      orchestrator.closeAndMaterialize({ organizationId: scope.organizationId }, {
        exchangeAccountId: scope.accountId,
        periodStart,
        periodEnd,
        realizedStrategyProfitReceipt: changedReceipt,
        closedTradeSettlements: [closed],
      } as never),
    ).rejects.toThrow("CLOSED_TRADE_DIGEST_MISMATCH");
    expect(findOpenPeriod).toHaveBeenCalledOnce();
    for (const effect of [
      listClosedPeriods,
      getCurrentHwm,
      bootstrapHwm,
      openReportingPeriod,
      closeReportingPeriod,
      getDraftInvoiceByPeriod,
    ]) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("keeps canonical serialized evidence, fee and HWM unchanged", () => {
    const closed = JSON.parse(JSON.stringify(settlement()));
    const serializedPolicy = JSON.parse(JSON.stringify(policy));
    expect(() => assertClosedTradeSettlementV2(closed)).not.toThrow();
    expect(() => assertCanonicalBillingPolicyV2(serializedPolicy)).not.toThrow();
    expect(receipt(closed)).toEqual(receipt());
    const assessed = assessBillingV2({
      receipt: receipt(closed),
      settlements: [closed],
      policy: serializedPolicy,
      priorHwm: { namespace: "BILLING_HWM", highWaterMark: "0", eventDigestHex: null },
      assessedAtUtc: periodEnd.toISOString(),
    });
    expect(compareDecimal(assessed.performanceFee, "29.4")).toBe(0);
    expect(compareDecimal(assessed.hwmEvent.newHwm, "98")).toBe(0);
  });
});
