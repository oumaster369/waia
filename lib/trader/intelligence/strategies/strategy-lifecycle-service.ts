import { createHash } from "node:crypto";

import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { strategyLifecycleReasonCodes } from "@/lib/trader/intelligence/strategies/strategy-lifecycle-transition-validator";
import {
  createStrategyLifecycleRepositoryPostgres,
  type StrategyLifecycleRepository,
} from "@/lib/trader/intelligence/strategies/strategy-lifecycle-repository-postgres";
import type {
  StrategyLifecycleEvent,
  StrategyLifecycleState,
  StrategyLifecycleTransition,
} from "@/lib/trader/intelligence/strategies/strategy-lifecycle.types";
import { validateStrategyLifecycleTransition } from "@/lib/trader/intelligence/strategies/strategy-lifecycle-transition-validator";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export class StrategyLifecycleIdempotencyConflictError extends Error {
  readonly code = "HTR_WP16_LIFECYCLE_IDEMPOTENCY_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "StrategyLifecycleIdempotencyConflictError";
  }
}

export type AppendLifecycleEventInput = {
  id: string;
  strategyId: string;
  strategyVersion: string;
  transition: StrategyLifecycleTransition;
  approvalRef?: string | null;
  reasonCode?: string | null;
  effectiveAt: string;
  runId?: string | null;
};

export type StrategyLifecycleService = {
  appendLifecycleEvent(
    context: OrgContext,
    input: AppendLifecycleEventInput,
  ): Promise<StrategyLifecycleEvent>;
  getLifecycleStateAsOf(
    context: OrgContext,
    strategyId: string,
    strategyVersion: string,
    asOf: string,
  ): Promise<StrategyLifecycleState | null>;
};

function buildLifecycleContentDigest(input: {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  fromState: StrategyLifecycleState | null;
  toState: StrategyLifecycleState;
  actor: StrategyLifecycleTransition["actor"];
  approvalRef: string | null;
  reasonCode: string | null;
  seq: number;
  effectiveAt: string;
  runId: string | null;
}): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        organizationId: input.organizationId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        fromState: input.fromState,
        toState: input.toState,
        actor: input.actor,
        approvalRef: input.approvalRef,
        reasonCode: input.reasonCode,
        seq: input.seq,
        effectiveAt: input.effectiveAt,
        runId: input.runId,
      }),
      "utf8",
    )
    .digest("hex");
}

export function createStrategyLifecycleService(
  repository: StrategyLifecycleRepository,
): StrategyLifecycleService {
  return {
    async appendLifecycleEvent(context, input) {
      const validation = validateStrategyLifecycleTransition({
        fromState: input.transition.fromState,
        toState: input.transition.toState,
        actor: input.transition.actor,
        approvalRef: input.approvalRef,
      });
      if (!validation.ok) {
        throw new Error(`[wp16] ${validation.reasonCode}`);
      }

      const maxSeq = await repository.getMaxSeq(context, input.strategyId, input.strategyVersion);
      const seq = (maxSeq ?? 0) + 1;
      const existing = await repository.findBySeq(
        context,
        input.strategyId,
        input.strategyVersion,
        seq,
      );
      if (existing) {
        const digest = buildLifecycleContentDigest({
          organizationId: context.organizationId,
          strategyId: input.strategyId,
          strategyVersion: input.strategyVersion,
          fromState: input.transition.fromState,
          toState: input.transition.toState,
          actor: input.transition.actor,
          approvalRef: input.approvalRef ?? null,
          reasonCode: input.reasonCode ?? null,
          seq,
          effectiveAt: input.effectiveAt,
          runId: input.runId ?? null,
        });
        if (existing.id === input.id && existing.contentDigest === digest) {
          return existing;
        }
        throw new StrategyLifecycleIdempotencyConflictError(
          "lifecycle event seq conflict with mismatched digest",
        );
      }

      const contentDigest = buildLifecycleContentDigest({
        organizationId: context.organizationId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        fromState: input.transition.fromState,
        toState: input.transition.toState,
        actor: input.transition.actor,
        approvalRef: input.approvalRef ?? null,
        reasonCode: input.reasonCode ?? null,
        seq,
        effectiveAt: input.effectiveAt,
        runId: input.runId ?? null,
      });

      return repository.insert(context, {
        id: input.id,
        organizationId: context.organizationId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        fromState: input.transition.fromState,
        toState: input.transition.toState,
        actor: input.transition.actor,
        approvalRef: input.approvalRef ?? null,
        reasonCode: input.reasonCode ?? null,
        seq,
        effectiveAt: input.effectiveAt,
        runId: input.runId ?? null,
        contentDigest,
      });
    },

    async getLifecycleStateAsOf(context, strategyId, strategyVersion, asOf) {
      const events = await repository.listEvents(context, strategyId, strategyVersion);
      const asOfMs = new Date(asOf).getTime();
      let state: StrategyLifecycleState | null = null;
      for (const event of events) {
        if (new Date(event.effectiveAt).getTime() > asOfMs) {
          break;
        }
        state = event.toState;
      }
      return state;
    },
  };
}

export function createStrategyLifecycleServicePostgres(
  ex: Pick<WaiaPostgresDb, "select" | "insert">,
): StrategyLifecycleService {
  return createStrategyLifecycleService(createStrategyLifecycleRepositoryPostgres(ex));
}

export { strategyLifecycleReasonCodes };
