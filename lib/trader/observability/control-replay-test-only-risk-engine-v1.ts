import { randomUUID } from "node:crypto";

import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import type { OrgRiskLimitsMetadata, RiskLimitsService } from "@/lib/trader/risk/limits/types";
import type { EffectiveKillSwitchState } from "@/lib/trader/risk/kill-switch/types";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import type { RiskEngineService } from "@/lib/trader/risk/evaluate.types";

function metadataFromDefaults(clampMaxNotional?: string): OrgRiskLimitsMetadata {
  return {
    id: "control-replay-test-only-limits",
    scopeType: "organization",
    scopeRef: null,
    ...DEFAULT_ORG_RISK_LIMITS,
    maxNotional: clampMaxNotional ?? DEFAULT_ORG_RISK_LIMITS.maxNotional,
    maxOrdersPerWindow: 1_000_000,
    windowMs: 86_400_000,
    configVersion: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function killSwitchState(blocked: boolean): EffectiveKillSwitchState {
  return {
    organizationId: "control-replay",
    blocked,
    enforcementMode: blocked ? "REJECT" : null,
    bindingState: blocked ? "ACTIVE" : null,
    resolutionStatus: "ok",
    contributors: [],
    resolvedAt: new Date(0).toISOString(),
  };
}

export function createControlReplayTestOnlyRiskEngine(input?: {
  vetoAll?: boolean;
  clampMaxNotional?: string;
  nowMs?: () => number;
}): RiskEngineService {
  const limits = metadataFromDefaults(input?.clampMaxNotional);
  const limitsService: RiskLimitsService = {
    async getLimitsForOrg() {
      return limits;
    },
    async getOrCreateLimitsForOrg() {
      return limits;
    },
    async upsertLimitsForOrg() {
      return limits;
    },
  };
  return createRiskEngineService({
    limitsService,
    killSwitchResolver: {
      async getEffectiveState() {
        return killSwitchState(input?.vetoAll === true);
      },
    },
    rateStore: createInMemoryOrderRateStore(),
    writeAudit: () => "cr-test-only-audit",
    nowMs: input?.nowMs ?? (() => 1_700_000_000_000),
    newDecisionId: () => randomUUID(),
  });
}
