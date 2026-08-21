import { describe, expect, it } from "vitest";

import {
  createExecutionAttemptV2,
  createExecutionPlanV2,
  createExecutionPolicyBindingV2,
  createExecutionReportV2,
  deterministicExecutionClientOrderId,
  validateExecutionAttemptV2,
  validateExecutionPlanV2,
  validateExecutionPolicyBindingV2,
  validateExecutionReportV2,
} from "@/lib/trader/execution/v2/contracts";
import { createRiskAllowanceV2 } from "@/lib/trader/risk/v2/risk-allowance-v2";

const digest = (seed: string) => seed.padEnd(64, "0").slice(0, 64);

function allowance() {
  return createRiskAllowanceV2({
    riskAllowanceId: "00000000-0000-4000-8000-000000066701",
    organizationId: "00000000-0000-4000-8000-000000066702",
    accountId: "spot-main",
    venue: "HTX",
    market: "SPOT",
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    instrumentIdentityDigestHex: digest("1"),
    riskVerdictId: "00000000-0000-4000-8000-000000066703",
    riskVerdictContentDigestHex: digest("2"),
    admissionSequence: "7",
    decision: {
      decisionId: "decision-667",
      semanticDigestHex: digest("3"),
      contentDigestHex: digest("4"),
      action: "ENTER_LONG",
      economicSizeSetId: "sizes-667",
      economicSizeSetDigestHex: digest("5"),
    },
    riskPolicyVersion: "risk-v2-test",
    riskPolicyDigestHex: digest("6"),
    realitySnapshotId: "reality-667",
    realityContentDigestHex: digest("7"),
    reconciliationAuthorityDigestHex: digest("8"),
    postureAtIssuance: "NORMAL",
    strictExposureReduction: false,
    exactQualifiedQuantity: "0.1",
    reservedExposureNotional: "2500",
    nonce: "00000000-0000-4000-8000-000000066704",
    issuedAtUtc: "2026-08-21T00:00:00.000Z",
    validUntilUtc: "2026-08-21T00:00:30.000Z",
  });
}

function policy() {
  const risk = allowance();
  return createExecutionPolicyBindingV2({
    executionPolicyId: "00000000-0000-4000-8000-000000066705",
    organizationId: risk.organizationId,
    policyVersion: "htx-spot-taker-v1",
    decisionId: risk.decision.decisionId,
    decisionContentDigestHex: risk.decision.contentDigestHex,
    decisionExecutionPolicyDigestHex: digest("9"),
    economicSizeSetDigestHex: risk.decision.economicSizeSetDigestHex,
    venue: risk.venue,
    market: "SPOT",
    instrumentIdentityDigestHex: risk.instrumentIdentityDigestHex,
    allowedOrderTypes: ["limit", "market"],
    allowedTimeInForce: ["GTC", "IOC"],
    allowedLiquidityRoles: ["MAKER", "TAKER"],
    priceCollar: {
      minimumPrice: "24000",
      maximumPrice: "26000",
      authorityDigestHex: digest("a"),
    },
    quantityRules: {
      minimumQuantity: "0.01",
      quantityStep: "0.01",
      roundingMode: "DOWN_TO_QUALIFIED",
      economicQualifiedQuantities: ["0.08", "0.1"],
    },
    slicingPolicy: { maximumSlices: 2, completePlanRequired: true },
    retryPolicy: {
      maximumNetworkSubmissions: 1,
      sameIdentityRetryAllowed: false,
      venueIdempotencyProven: false,
    },
    cancelPolicy: {
      protectiveCancelAllowed: true,
      replacementRequiresPresealedOrFreshAuthority: true,
    },
    timeoutMs: 5_000,
    uncertaintyHandling: "RECONCILIATION_REQUIRED",
    effectiveFromUtc: "2026-08-21T00:00:00.000Z",
    effectiveUntilUtc: "2026-08-21T00:01:00.000Z",
  });
}

function plan() {
  return createExecutionPlanV2({
    executionPlanId: "00000000-0000-4000-8000-000000066706",
    allowance: allowance(),
    policy: policy(),
    approvedNotionalCeiling: "2500",
    plannedQuantity: "0.08",
    orderType: "limit",
    liquidityRole: "MAKER",
    limitPrice: "25000",
    timeInForce: "GTC",
    timingWindow: {
      opensAtUtc: "2026-08-21T00:00:01.000Z",
      closesAtUtc: "2026-08-21T00:00:20.000Z",
    },
    childSlices: [{ sequence: 1, quantity: "0.08", limitPrice: "25000" }],
    sealedAtUtc: "2026-08-21T00:00:00.500Z",
  });
}

describe("Execution V2 immutable contracts (DEE-667)", () => {
  it("seals a Decision-qualified policy and forbids unproven venue retries", () => {
    const value = policy();
    expect(validateExecutionPolicyBindingV2(value)).toBe(true);
    expect(Object.isFrozen(value)).toBe(true);
    expect(value.retryPolicy).toEqual({
      maximumNetworkSubmissions: 1,
      sameIdentityRetryAllowed: false,
      venueIdempotencyProven: false,
    });
    const { schemaVersion: _s, semanticDigestHex: _sd, contentDigestHex: _cd, ...draft } = value;
    void _s;
    void _sd;
    void _cd;
    expect(() => createExecutionPolicyBindingV2({
      ...draft,
      retryPolicy: { ...draft.retryPolicy, sameIdentityRetryAllowed: true } as never,
    })).toThrow(/unproven venue idempotency/);
  });

  it("accepts only explicit discrete economic membership and complete sealed slices", () => {
    const value = plan();
    expect(validateExecutionPlanV2(value)).toBe(true);
    expect(value).toMatchObject({ plannedQuantity: "0.08", side: "buy", action: "ENTER_LONG" });
    expect(() => createExecutionPlanV2({
      executionPlanId: "00000000-0000-4000-8000-000000066707",
      allowance: allowance(),
      policy: policy(),
      approvedNotionalCeiling: "2500",
      plannedQuantity: "0.09",
      orderType: "limit",
      liquidityRole: "MAKER",
      limitPrice: "25000",
      timeInForce: "GTC",
      timingWindow: {
        opensAtUtc: "2026-08-21T00:00:01.000Z",
        closesAtUtc: "2026-08-21T00:00:20.000Z",
      },
      childSlices: [{ sequence: 1, quantity: "0.09", limitPrice: "25000" }],
      sealedAtUtc: "2026-08-21T00:00:00.500Z",
    })).toThrow(/qualified discrete membership/);
    expect(() => createExecutionPlanV2({
      executionPlanId: "00000000-0000-4000-8000-000000066708",
      allowance: allowance(),
      policy: policy(),
      approvedNotionalCeiling: "2500",
      plannedQuantity: "0.08",
      orderType: "limit",
      liquidityRole: "MAKER",
      limitPrice: "25000",
      timeInForce: "GTC",
      timingWindow: {
        opensAtUtc: "2026-08-21T00:00:01.000Z",
        closesAtUtc: "2026-08-21T00:00:20.000Z",
      },
      childSlices: [{ sequence: 1, quantity: "0.07", limitPrice: "25000" }],
      sealedAtUtc: "2026-08-21T00:00:00.500Z",
    })).toThrow(/slice total mismatch/);
    expect(() => createExecutionPlanV2({
      executionPlanId: "00000000-0000-4000-8000-000000066717",
      allowance: allowance(),
      policy: policy(),
      approvedNotionalCeiling: "2600",
      plannedQuantity: "0.08",
      orderType: "limit",
      liquidityRole: "MAKER",
      limitPrice: "25000",
      timeInForce: "GTC",
      timingWindow: {
        opensAtUtc: "2026-08-21T00:00:01.000Z",
        closesAtUtc: "2026-08-21T00:00:20.000Z",
      },
      childSlices: [{ sequence: 1, quantity: "0.08", limitPrice: "25000" }],
      sealedAtUtc: "2026-08-21T00:00:00.500Z",
    })).toThrow(/exceeds the Risk allowance reservation/);
    expect(() => createExecutionPlanV2({
      executionPlanId: "00000000-0000-4000-8000-000000066718",
      allowance: allowance(),
      policy: policy(),
      approvedNotionalCeiling: "2500",
      plannedQuantity: "0.1",
      orderType: "limit",
      liquidityRole: "TAKER",
      limitPrice: "26000",
      timeInForce: "GTC",
      timingWindow: {
        opensAtUtc: "2026-08-21T00:00:01.000Z",
        closesAtUtc: "2026-08-21T00:00:20.000Z",
      },
      childSlices: [{ sequence: 1, quantity: "0.1", limitPrice: "26000" }],
      sealedAtUtc: "2026-08-21T00:00:00.500Z",
    })).toThrow(/planned effect notional/);
  });

  it("refuses venue, order type, TIF, policy digest, and price-chase mismatches", () => {
    const base = policy();
    const { schemaVersion: _s, semanticDigestHex: _sd, contentDigestHex: _cd, ...draft } = base;
    void _s;
    void _sd;
    void _cd;
    const wrongVenue = createExecutionPolicyBindingV2({ ...draft, venue: "MOCK" });
    expect(() => createExecutionPlanV2({
      executionPlanId: "00000000-0000-4000-8000-000000066709",
      allowance: allowance(),
      policy: wrongVenue,
      approvedNotionalCeiling: "2500",
      plannedQuantity: "0.08",
      orderType: "limit",
      liquidityRole: "MAKER",
      limitPrice: "25000",
      timeInForce: "GTC",
      timingWindow: {
        opensAtUtc: "2026-08-21T00:00:01.000Z",
        closesAtUtc: "2026-08-21T00:00:20.000Z",
      },
      childSlices: [{ sequence: 1, quantity: "0.08", limitPrice: "25000" }],
      sealedAtUtc: "2026-08-21T00:00:00.500Z",
    })).toThrow(/not bound/);
    expect(() => createExecutionPlanV2({
      executionPlanId: "00000000-0000-4000-8000-000000066710",
      allowance: allowance(),
      policy: base,
      approvedNotionalCeiling: "2500",
      plannedQuantity: "0.08",
      orderType: "limit",
      liquidityRole: "MAKER",
      limitPrice: "26000.01",
      timeInForce: "GTC",
      timingWindow: {
        opensAtUtc: "2026-08-21T00:00:01.000Z",
        closesAtUtc: "2026-08-21T00:00:20.000Z",
      },
      childSlices: [{ sequence: 1, quantity: "0.08", limitPrice: "26000.01" }],
      sealedAtUtc: "2026-08-21T00:00:00.500Z",
    })).toThrow(/outside the qualified collar/);
  });

  it("binds one deterministic exact request payload and replays the same identity", () => {
    const first = createExecutionAttemptV2({
      executionAttemptId: "00000000-0000-4000-8000-000000066711",
      orderId: "00000000-0000-4000-8000-000000066712",
      plan: plan(),
      riskAllowanceContentDigestHex: allowance().contentDigestHex,
      boundAtUtc: "2026-08-21T00:00:00.750Z",
    });
    const replay = createExecutionAttemptV2({
      executionAttemptId: first.executionAttemptId,
      orderId: first.orderId,
      plan: plan(),
      riskAllowanceContentDigestHex: allowance().contentDigestHex,
      boundAtUtc: first.boundAtUtc,
    });
    expect(validateExecutionAttemptV2(first)).toBe(true);
    expect(replay).toEqual(first);
    expect(first.clientOrderId).toBe(deterministicExecutionClientOrderId(plan().contentDigestHex));
    expect(first.exactRequestPayload).toEqual({
      clientOrderId: first.clientOrderId,
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      price: "25000",
      quantity: "0.08",
      timeInForce: "GTC",
    });
  });

  it("seals raw append-only observations without fabricating trade truth", () => {
    const attempt = createExecutionAttemptV2({
      executionAttemptId: "00000000-0000-4000-8000-000000066713",
      orderId: "00000000-0000-4000-8000-000000066714",
      plan: plan(),
      riskAllowanceContentDigestHex: allowance().contentDigestHex,
      boundAtUtc: "2026-08-21T00:00:00.750Z",
    });
    const uncertain = createExecutionReportV2({
      executionReportId: "00000000-0000-4000-8000-000000066715",
      organizationId: attempt.organizationId,
      accountId: attempt.accountId,
      executionAttemptId: attempt.executionAttemptId,
      executionAttemptContentDigestHex: attempt.contentDigestHex,
      reportSequence: "1",
      reportType: "CONNECTOR_UNCERTAIN",
      source: "CONNECTOR",
      rawObservation: { status: "timeout", responseReceived: false },
      venueOrderId: null,
      observedAtUtc: "2026-08-21T00:00:06.000Z",
      previousReportDigestHex: null,
    });
    const reconciliation = createExecutionReportV2({
      executionReportId: "00000000-0000-4000-8000-000000066716",
      organizationId: attempt.organizationId,
      accountId: attempt.accountId,
      executionAttemptId: attempt.executionAttemptId,
      executionAttemptContentDigestHex: attempt.contentDigestHex,
      reportSequence: "2",
      reportType: "RECONCILIATION_REQUIRED",
      source: "EXECUTION",
      rawObservation: { reason: "UNKNOWN_VENUE_EFFECT" },
      venueOrderId: null,
      observedAtUtc: "2026-08-21T00:00:06.001Z",
      previousReportDigestHex: uncertain.contentDigestHex,
    });
    expect(validateExecutionReportV2(uncertain)).toBe(true);
    expect(validateExecutionReportV2(reconciliation)).toBe(true);
    expect(JSON.stringify([uncertain, reconciliation])).not.toMatch(/tradeId|fillPrice|feeAsset/);
  });
});
