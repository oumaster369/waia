import { describe, expect, it, vi } from "vitest";

import type { PlaceOrderInput } from "@/lib/trader/connectors/types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { EvaluateOrderRequestInput } from "@/lib/trader/risk/evaluate.types";
import type {
  NormalizedRiskLimitsConfig,
  OrgRiskLimitsMetadata,
  RiskLimitsService,
} from "@/lib/trader/risk/limits/types";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  capitalReasonCodes,
  engineReasonCodes,
  tradeAbuseReasonCodes,
} from "@/lib/trader/risk/reason-codes";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

const CONTEXT: OrgContext = { organizationId: "org-engine-1" };
const NOW = 1_700_000_000_000;

function metadata(
  overrides: Partial<NormalizedRiskLimitsConfig> & { configVersion?: number } = {},
): OrgRiskLimitsMetadata {
  return {
    id: "limits-1",
    scopeType: "organization",
    scopeRef: null,
    configVersion: overrides.configVersion ?? 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    allowedSymbols: overrides.allowedSymbols ?? ["BTC/USDT", "ETH/USDT"],
    maxNotional: overrides.maxNotional ?? "10000",
    maxOrdersPerWindow: overrides.maxOrdersPerWindow ?? 10,
    windowMs: overrides.windowMs ?? 60_000,
    collarBps: overrides.collarBps ?? 500,
    maxPositionPerSymbol: overrides.maxPositionPerSymbol ?? "1000",
    maxDailyLoss: overrides.maxDailyLoss ?? "500",
    maxDrawdown: overrides.maxDrawdown ?? "1000",
    maxOpenOrders: overrides.maxOpenOrders ?? 10,
    maxQuoteExposure: overrides.maxQuoteExposure ?? "1000000",
  };
}

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function stubLimitsService(meta: OrgRiskLimitsMetadata | null): RiskLimitsService {
  return {
    getLimitsForOrg: async () => meta,
    getOrCreateLimitsForOrg: async () => {
      throw new Error("not used in engine tests");
    },
    upsertLimitsForOrg: async () => {
      throw new Error("not used in engine tests");
    },
  };
}

function makeEngine(meta: OrgRiskLimitsMetadata | null, newDecisionId = () => "rd-1") {
  const writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-id");
  const service = createRiskEngineService({
    limitsService: stubLimitsService(meta),
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs: () => NOW,
    newDecisionId,
  });
  return { service, writeAudit };
}

function order(overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    clientOrderId: "coid-1",
    symbol: "BTC/USDT",
    side: "buy",
    type: "limit",
    price: "100",
    quantity: "0.1",
    ...overrides,
  };
}

function request(overrides: Partial<EvaluateOrderRequestInput> = {}): EvaluateOrderRequestInput {
  return {
    context: CONTEXT,
    order: order(),
    referencePrice: "100",
    accountKey: "acct-1",
    accountState: EMPTY_STATE,
    ...overrides,
  };
}

describe("risk engine service (DEE-241)", () => {
  it("approves when both evaluators approve", async () => {
    const { service, writeAudit } = makeEngine(metadata());

    const result = await service.evaluateOrderRequest(request());

    expect(result.decision.outcome).toBe("APPROVE");
    expect(result.decision.reasonCodes).toEqual([]);
    expect(result.decision.resize).toBeUndefined();
    expect(result.configVersion).toBe(1);
    expect(result.organizationId).toBe("org-engine-1");
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it("short-circuits on terminal trade-abuse reject without running capital", async () => {
    const { service } = makeEngine(metadata());

    const result = await service.evaluateOrderRequest(
      request({ order: order({ symbol: "DOGE/USDT" }) }),
    );

    expect(result.decision.outcome).toBe("REJECT");
    expect(result.decision.reasonCodes).toEqual([tradeAbuseReasonCodes.symbolNotAllowed]);
    // INV-4: capital never executed, so only the allowlist check is recorded.
    expect(result.decision.snapshot.checksApplied).toEqual(["allowlist"]);
    expect(result.decision.resize).toBeUndefined();
  });

  it("RESIZE + capital APPROVE keeps the resize hint and union reason codes", async () => {
    const { service } = makeEngine(metadata());

    const result = await service.evaluateOrderRequest(
      request({ order: order({ quantity: "200" }) }),
    );

    expect(result.decision.outcome).toBe("RESIZE");
    expect(result.decision.resize).toEqual({ quantity: "100", notional: "10000" });
    expect(result.decision.reasonCodes).toContain(tradeAbuseReasonCodes.maxNotionalExceeded);
    // INV-5: snapshot reflects the original request; trim lives only in the hint.
    expect(result.decision.snapshot.requestedQuantity).toBe("200");
    // INV-5: checks from both stages, deduped and order-preserving.
    expect(result.decision.snapshot.checksApplied).toEqual([
      "allowlist",
      "notional",
      "drawdown",
      "dailyLoss",
      "openOrders",
      "position",
      "quoteExposure",
    ]);
  });

  it("RESIZE + capital REJECT drops the hint and unions reason codes (INV-1/INV-4)", async () => {
    const { service } = makeEngine(metadata({ maxQuoteExposure: "5000" }));

    const result = await service.evaluateOrderRequest(
      request({ order: order({ quantity: "200" }) }),
    );

    expect(result.decision.outcome).toBe("REJECT");
    expect(result.decision.resize).toBeUndefined();
    expect(result.decision.reasonCodes).toEqual([
      tradeAbuseReasonCodes.maxNotionalExceeded,
      capitalReasonCodes.maxQuoteExposureExceeded,
    ]);
  });

  it("capital STOP_ACCOUNT takes precedence over trade-abuse APPROVE", async () => {
    const { service } = makeEngine(metadata());

    const result = await service.evaluateOrderRequest(
      request({ accountState: { ...EMPTY_STATE, drawdown: "1000" } }),
    );

    expect(result.decision.outcome).toBe("STOP_ACCOUNT");
    expect(result.decision.resize).toBeUndefined();
    expect(result.decision.reasonCodes).toEqual([capitalReasonCodes.maxDrawdownExceeded]);
  });

  it("fails closed (REJECT) when limits are not configured", async () => {
    const { service, writeAudit } = makeEngine(null);

    const result = await service.evaluateOrderRequest(request());

    expect(result.decision.outcome).toBe("REJECT");
    expect(result.decision.reasonCodes).toEqual([engineReasonCodes.limitsNotConfigured]);
    expect(result.configVersion).toBeNull();
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it("fails closed (REJECT) when account state is missing", async () => {
    const { service } = makeEngine(metadata({ configVersion: 7 }));

    const result = await service.evaluateOrderRequest(request({ accountState: undefined }));

    expect(result.decision.outcome).toBe("REJECT");
    expect(result.decision.reasonCodes).toEqual([engineReasonCodes.accountStateUnavailable]);
    expect(result.configVersion).toBe(7);
  });

  it("fails closed (REJECT) when an evaluator throws", async () => {
    const { service } = makeEngine(metadata());

    // Limit order with zero price makes the evaluator throw.
    const result = await service.evaluateOrderRequest(request({ order: order({ price: "0" }) }));

    expect(result.decision.outcome).toBe("REJECT");
    expect(result.decision.reasonCodes).toEqual([engineReasonCodes.evaluationError]);
  });

  it("writes a metadata-only audit event with no order secrets", async () => {
    const { service, writeAudit } = makeEngine(metadata({ configVersion: 3 }), () => "rd-fixed");

    const result = await service.evaluateOrderRequest(request());

    expect(result.riskDecisionId).toBe("rd-fixed");
    expect(writeAudit).toHaveBeenCalledTimes(1);

    const audit = writeAudit.mock.calls[0]![0];
    expect(audit.action).toBe(traderAuditActions.riskDecisionCreated);
    expect(audit.entityType).toBe(traderEntityTypes.riskDecision);
    expect(audit.entityId).toBe("rd-fixed");
    expect(audit.organizationId).toBe("org-engine-1");

    const meta = audit.metadata ?? {};
    expect(meta).toMatchObject({
      riskDecisionId: "rd-fixed",
      outcome: "APPROVE",
      symbol: "BTC/USDT",
      clientOrderId: "coid-1",
      configVersion: 3,
      scopeType: "organization",
    });
    expect(meta).not.toHaveProperty("price");
    expect(meta).not.toHaveProperty("quantity");
    expect(meta).not.toHaveProperty("apiKey");
    expect(meta).not.toHaveProperty("apiSecret");
  });

  it("throws OrgScopeError for empty organization id", async () => {
    const { service } = makeEngine(metadata());

    await expect(
      service.evaluateOrderRequest(request({ context: { organizationId: "" } })),
    ).rejects.toThrow();
  });
});
