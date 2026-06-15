import { describe, expect, it, vi } from "vitest";

import type { PlaceOrderInput } from "@/lib/trader/connectors/types";
import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type {
  EvaluateOrderRequestInput,
  KillSwitchResolverPort,
} from "@/lib/trader/risk/evaluate.types";
import type { EffectiveKillSwitchState } from "@/lib/trader/risk/kill-switch/types";
import type {
  NormalizedRiskLimitsConfig,
  OrgRiskLimitsMetadata,
  RiskLimitsService,
} from "@/lib/trader/risk/limits/types";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  capitalReasonCodes,
  engineReasonCodes,
  killSwitchReasonCodes,
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

function defaultEffective(
  overrides: Partial<EffectiveKillSwitchState> = {},
): EffectiveKillSwitchState {
  return {
    organizationId: CONTEXT.organizationId,
    blocked: false,
    enforcementMode: null,
    bindingState: null,
    resolutionStatus: "ok",
    contributors: [],
    resolvedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

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

function stubKillSwitchResolver(
  effective: EffectiveKillSwitchState = defaultEffective(),
): KillSwitchResolverPort {
  return {
    getEffectiveState: async () => effective,
  };
}

function makeEngine(
  meta: OrgRiskLimitsMetadata | null,
  options: {
    newDecisionId?: () => string;
    killSwitch?: EffectiveKillSwitchState;
    limitsService?: RiskLimitsService;
    riskTelemetrySink?: WaiaTraderTelemetrySink;
  } = {},
) {
  const limitsService = options.limitsService ?? stubLimitsService(meta);
  const writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-id");
  const telemetryLines: string[] = [];
  const riskTelemetrySink =
    options.riskTelemetrySink ?? ((line: string) => telemetryLines.push(line));
  const service = createRiskEngineService({
    limitsService,
    killSwitchResolver: stubKillSwitchResolver(options.killSwitch ?? defaultEffective()),
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs: () => NOW,
    newDecisionId: options.newDecisionId ?? (() => "rd-1"),
    riskTelemetrySink,
  });
  return { service, writeAudit, limitsService, telemetryLines, riskTelemetrySink };
}

function parseCounterLines(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((parsed) => parsed.kind === "counter");
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
    expect(result.decision.snapshot.requestedQuantity).toBe("200");
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

    const result = await service.evaluateOrderRequest(request({ order: order({ price: "0" }) }));

    expect(result.decision.outcome).toBe("REJECT");
    expect(result.decision.reasonCodes).toEqual([engineReasonCodes.evaluationError]);
  });

  it("writes a metadata-only audit event with no order secrets", async () => {
    const { service, writeAudit } = makeEngine(metadata({ configVersion: 3 }), {
      newDecisionId: () => "rd-fixed",
    });

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
      killSwitch: {
        blocked: false,
        enforcementMode: null,
        bindingState: null,
        resolutionStatus: "ok",
        contributors: [],
      },
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

describe("risk engine counter telemetry (DEE-256)", () => {
  it("APPROVE path emits zero counter lines", async () => {
    const { service, telemetryLines } = makeEngine(metadata());

    await service.evaluateOrderRequest(request());

    expect(parseCounterLines(telemetryLines)).toEqual([]);
  });

  it("symbol reject emits one RISK_SYMBOL_NOT_ALLOWED counter", async () => {
    const { service, telemetryLines } = makeEngine(metadata());

    await service.evaluateOrderRequest(request({ order: order({ symbol: "DOGE/USDT" }) }));

    expect(parseCounterLines(telemetryLines)).toEqual([
      expect.objectContaining({
        kind: "counter",
        domain: "risk",
        code: tradeAbuseReasonCodes.symbolNotAllowed,
        organization_id: CONTEXT.organizationId,
        delta: 1,
        severity: "info",
      }),
    ]);
  });

  it("RESIZE + capital REJECT emits two distinct reason-code counters", async () => {
    const { service, telemetryLines } = makeEngine(metadata({ maxQuoteExposure: "5000" }));

    await service.evaluateOrderRequest(request({ order: order({ quantity: "200" }) }));

    const counters = parseCounterLines(telemetryLines);
    expect(counters).toHaveLength(2);
    expect(counters.map((line) => line.code)).toEqual([
      tradeAbuseReasonCodes.maxNotionalExceeded,
      capitalReasonCodes.maxQuoteExposureExceeded,
    ]);
  });

  it("kill-switch blocked path emits RISK_KILL_SWITCH_ACTIVE counter", async () => {
    const { service, telemetryLines } = makeEngine(metadata(), {
      killSwitch: defaultEffective({
        blocked: true,
        enforcementMode: "REJECT",
        bindingState: "ACTIVE",
      }),
    });

    await service.evaluateOrderRequest(request());

    expect(parseCounterLines(telemetryLines)).toEqual([
      expect.objectContaining({
        domain: "risk",
        code: killSwitchReasonCodes.killSwitchActive,
      }),
    ]);
  });

  it("fail-closed no limits emits RISK_LIMITS_NOT_CONFIGURED counter", async () => {
    const { service, telemetryLines } = makeEngine(null);

    await service.evaluateOrderRequest(request());

    expect(parseCounterLines(telemetryLines)).toEqual([
      expect.objectContaining({
        domain: "risk",
        code: engineReasonCodes.limitsNotConfigured,
      }),
    ]);
  });

  it("emits exactly one counter per reason code in the final decision", async () => {
    const approve = makeEngine(metadata());
    await approve.service.evaluateOrderRequest(request());
    expect(parseCounterLines(approve.telemetryLines)).toHaveLength(0);

    const reject = makeEngine(metadata());
    const rejectResult = await reject.service.evaluateOrderRequest(
      request({ order: order({ symbol: "DOGE/USDT" }) }),
    );
    expect(parseCounterLines(reject.telemetryLines)).toHaveLength(
      rejectResult.decision.reasonCodes.length,
    );
  });
});

describe("risk engine kill switch pre-gate (DEE-244)", () => {
  it.each([
    ["REJECT", "REJECT"],
    ["CLOSE_ONLY", "CLOSE_ONLY"],
    ["STOP_ACCOUNT", "STOP_ACCOUNT"],
  ] as const)("blocks with enforcementMode %s -> outcome %s", async (enforcementMode, outcome) => {
    const limitsService = stubLimitsService(metadata());
    const getLimitsForOrg = vi.spyOn(limitsService, "getLimitsForOrg");
    const { service } = makeEngine(metadata(), {
      limitsService,
      killSwitch: defaultEffective({
        blocked: true,
        enforcementMode,
        bindingState: "ACTIVE",
      }),
    });

    const result = await service.evaluateOrderRequest(request());

    expect(result.decision.outcome).toBe(outcome);
    expect(result.decision.reasonCodes).toEqual([killSwitchReasonCodes.killSwitchActive]);
    expect(result.decision.snapshot.checksApplied).toEqual([]);
    expect(result.configVersion).toBeNull();
    expect(getLimitsForOrg).not.toHaveBeenCalled();
  });

  it("fail_closed resolution yields STOP_ACCOUNT without running evaluators", async () => {
    const limitsService = stubLimitsService(metadata());
    const getLimitsForOrg = vi.spyOn(limitsService, "getLimitsForOrg");
    const { service } = makeEngine(metadata(), {
      limitsService,
      killSwitch: defaultEffective({
        blocked: true,
        enforcementMode: "STOP_ACCOUNT",
        bindingState: "ACTIVE",
        resolutionStatus: "fail_closed",
      }),
    });

    const result = await service.evaluateOrderRequest(request());

    expect(result.decision.outcome).toBe("STOP_ACCOUNT");
    expect(result.decision.reasonCodes).toEqual([killSwitchReasonCodes.killSwitchUnavailable]);
    expect(result.decision.snapshot.checksApplied).toEqual([]);
    expect(result.configVersion).toBeNull();
    expect(getLimitsForOrg).not.toHaveBeenCalled();
  });

  it("includes killSwitch contributor metadata in audit on blocked path", async () => {
    const { service, writeAudit } = makeEngine(metadata(), {
      killSwitch: defaultEffective({
        blocked: true,
        enforcementMode: "REJECT",
        bindingState: "ACTIVE",
        contributors: [
          {
            killSwitchId: "ks-org-1",
            organizationId: "org-engine-1",
            scopeType: "organization",
            scopeRef: null,
            switchType: "EMERGENCY_STOP",
            enforcementMode: "REJECT",
            state: "ACTIVE",
            stateVersion: 3,
            reason: "manual trip",
          },
        ],
      }),
    });

    await service.evaluateOrderRequest(request());

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const killSwitch = writeAudit.mock.calls[0]![0].metadata?.killSwitch as {
      blocked: boolean;
      contributors: Array<{ killSwitchId: string; stateVersion: number }>;
    };
    expect(killSwitch.blocked).toBe(true);
    expect(killSwitch.contributors).toEqual([
      expect.objectContaining({ killSwitchId: "ks-org-1", stateVersion: 3 }),
    ]);
  });
});
