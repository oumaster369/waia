import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  failClosedEffectiveState,
  mergeEffectiveContributions,
} from "@/lib/trader/risk/kill-switch/transitions";
import type {
  EffectiveKillSwitchState,
  KillSwitchRepository,
} from "@/lib/trader/risk/kill-switch/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type KillSwitchResolverDeps = {
  repository: KillSwitchRepository;
  nowMs: () => number;
};

export type KillSwitchResolver = {
  getEffectiveState(context: OrgContext): Promise<EffectiveKillSwitchState>;
};

export function createKillSwitchResolver(deps: KillSwitchResolverDeps): KillSwitchResolver {
  return {
    async getEffectiveState(context: OrgContext): Promise<EffectiveKillSwitchState> {
      const scoped = requireOrgContext(context.organizationId);
      const resolvedAt = new Date(deps.nowMs()).toISOString();

      try {
        const rows = await deps.repository.listEnforcingRowsForResolution(scoped);
        return mergeEffectiveContributions(rows, scoped.organizationId, resolvedAt);
      } catch {
        return failClosedEffectiveState(scoped.organizationId, resolvedAt);
      }
    },
  };
}
