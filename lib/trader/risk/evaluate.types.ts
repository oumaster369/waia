import type { PlaceOrderInput } from "@/lib/trader/connectors/types";
import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";

import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { EffectiveKillSwitchState } from "@/lib/trader/risk/kill-switch/types";
import type { OrderRateStore } from "@/lib/trader/risk/trade-abuse.types";
import type { RiskDecision } from "@/lib/trader/risk/types";
import type { RiskLimitsService } from "@/lib/trader/risk/limits/types";
import type { TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

/**
 * Pre-trade evaluation request for {@link RiskEngineService.evaluateOrderRequest}.
 *
 * `accountState` is intentionally optional: when the caller cannot supply a
 * reconciled snapshot the engine fails closed (REJECT) rather than guessing.
 */
export type EvaluateOrderRequestInput = {
  context: OrgContext;
  order: PlaceOrderInput;
  referencePrice: string;
  accountKey: string;
  accountState?: AccountRiskState;
  stopDistanceUsdt?: string;
};

/**
 * Canonical engine result. `decision` is the merged {@link RiskDecision};
 * `riskDecisionId` seeds future execution idempotency (Master Spec §14).
 * `configVersion` is the org limit profile version used, or `null` when no
 * limits were configured (fail-closed path).
 */
export type RiskEngineDecision = {
  riskDecisionId: string;
  organizationId: string;
  configVersion: number | null;
  decision: RiskDecision;
};

export type KillSwitchResolverPort = {
  getEffectiveState(context: OrgContext): Promise<EffectiveKillSwitchState>;
};

export type RiskEngineServiceDeps = {
  limitsService: RiskLimitsService;
  killSwitchResolver: KillSwitchResolverPort;
  rateStore: OrderRateStore;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  nowMs: () => number;
  newDecisionId: () => string;
  riskTelemetrySink?: WaiaTraderTelemetrySink;
};

export type RiskEngineService = {
  evaluateOrderRequest(input: EvaluateOrderRequestInput): Promise<RiskEngineDecision>;
};
