import type {
  EffectiveContribution,
  EffectiveKillSwitchState,
  KillSwitchEnforcementMode,
  KillSwitchRow,
  KillSwitchState,
} from "@/lib/trader/risk/kill-switch/types";
import { isV0ResolvableScopeType, scopeRefFromDb } from "@/lib/trader/risk/kill-switch/types";
import { IllegalKillSwitchTransitionError } from "@/lib/trader/risk/kill-switch/errors";

const ENFORCEMENT_RANK: Record<KillSwitchEnforcementMode, number> = {
  REJECT: 1,
  CLOSE_ONLY: 2,
  STOP_ACCOUNT: 3,
};

const STATE_RANK: Record<"ACTIVE" | "CLEARING", number> = {
  ACTIVE: 2,
  CLEARING: 1,
};

export function isEnforcingState(state: KillSwitchState): boolean {
  return state === "ACTIVE" || state === "CLEARING";
}

export function mostRestrictiveEnforcementMode(
  a: KillSwitchEnforcementMode,
  b: KillSwitchEnforcementMode,
): KillSwitchEnforcementMode {
  return ENFORCEMENT_RANK[a] >= ENFORCEMENT_RANK[b] ? a : b;
}

export function assertAllowedTransition(from: KillSwitchState, to: KillSwitchState): void {
  const allowed: Record<KillSwitchState, KillSwitchState[]> = {
    INACTIVE: ["ACTIVE"],
    ACTIVE: ["ACTIVE", "CLEARING"],
    CLEARING: ["ACTIVE", "INACTIVE"],
  };

  if (!allowed[from].includes(to)) {
    throw new IllegalKillSwitchTransitionError(from, to);
  }
}

export function rowToContribution(row: KillSwitchRow): EffectiveContribution {
  return {
    killSwitchId: row.id,
    organizationId: row.organizationId,
    scopeType: row.scopeType,
    scopeRef: scopeRefFromDb(row.scopeRef),
    switchType: row.switchType,
    enforcementMode: row.enforcementMode,
    state: row.state,
    stateVersion: row.stateVersion,
    reason: row.reason,
  };
}

export function mergeEffectiveContributions(
  rows: KillSwitchRow[],
  organizationId: string,
  resolvedAt: string,
): EffectiveKillSwitchState {
  const contributors = rows
    .filter((row) => isV0ResolvableScopeType(row.scopeType) && isEnforcingState(row.state))
    .map(rowToContribution);

  if (contributors.length === 0) {
    return {
      organizationId,
      blocked: false,
      enforcementMode: null,
      bindingState: null,
      resolutionStatus: "ok",
      contributors: [],
      resolvedAt,
    };
  }

  let enforcementMode = contributors[0]!.enforcementMode;
  let bindingState: "ACTIVE" | "CLEARING" = contributors[0]!.state as "ACTIVE" | "CLEARING";

  for (const contributor of contributors.slice(1)) {
    const nextMode = mostRestrictiveEnforcementMode(enforcementMode, contributor.enforcementMode);
    if (ENFORCEMENT_RANK[nextMode] > ENFORCEMENT_RANK[enforcementMode]) {
      enforcementMode = nextMode;
      bindingState = contributor.state as "ACTIVE" | "CLEARING";
    } else if (nextMode === enforcementMode) {
      const contributorState = contributor.state as "ACTIVE" | "CLEARING";
      if (STATE_RANK[contributorState] > STATE_RANK[bindingState]) {
        bindingState = contributorState;
      }
    }
  }

  return {
    organizationId,
    blocked: true,
    enforcementMode,
    bindingState,
    resolutionStatus: "ok",
    contributors,
    resolvedAt,
  };
}

export function failClosedEffectiveState(
  organizationId: string,
  resolvedAt: string,
): EffectiveKillSwitchState {
  return {
    organizationId,
    blocked: true,
    enforcementMode: "STOP_ACCOUNT",
    bindingState: "ACTIVE",
    resolutionStatus: "fail_closed",
    contributors: [],
    resolvedAt,
  };
}
