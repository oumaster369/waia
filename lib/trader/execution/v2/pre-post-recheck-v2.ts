import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { enforcingKillSwitchCoversAccountV2 } from "@/lib/trader/risk/kill-switch/project-onto-risk-accounts-v2";
import {
  assertNotionalWithinLiveCapitalLimitV2,
  LiveCapitalOrderLimitRefusedError,
  requireLiveCapitalOrderLimitV2,
} from "@/lib/trader/risk/v2/live-capital-order-limit-v2";
import { readRiskAccountStateV2Postgres } from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import type { ExecutionAttemptV2 } from "./contracts";
import {
  evaluateExecutionV2LiveGates,
  loadExecutionV2LiveGateFactsPostgres,
  type ExecutionV2LiveGateFacts,
} from "./live-gates";
import { readExecutionPlanV2Postgres } from "./repository-postgres";

export type PrePostRecheckFacts = Readonly<{
  killState: string;
  enforcingSwitch: boolean;
  envelopeReason: string | null;
  executionMode: "mock" | "paper" | "live" | "unknown";
  /** Required for live. Paper and mock ignore it. */
  liveGates: ExecutionV2LiveGateFacts | null;
}>;

/** Null means the post may proceed. Any other value is a refusal reason. */
export function evaluatePrePostRecheck(facts: PrePostRecheckFacts): string | null {
  if (facts.killState !== "CLEAR" || facts.enforcingSwitch) return "KILL_SWITCH_TRIPPED";
  if (facts.envelopeReason) return facts.envelopeReason;
  if (facts.executionMode === "unknown") return "PRE_POST_RECHECK_FAILED";
  if (facts.executionMode !== "live") return null;
  if (!facts.liveGates) return "PRE_POST_RECHECK_FAILED";
  const verdict = evaluateExecutionV2LiveGates(facts.liveGates);
  return verdict.ok ? null : verdict.reason;
}

/**
 * Last local read after SUBMIT_STARTED and before the exchange POST.
 * A refusal means the caller must not send. The remaining race is the socket itself.
 */
export async function prePostNetworkRefusalV2(
  db: WaiaPostgresDb,
  context: OrgContext,
  attempt: ExecutionAttemptV2,
): Promise<string | null> {
  return runWaiaPostgresTransaction(db, async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '5s', true)`);
    const state = await readRiskAccountStateV2Postgres(tx, context, attempt.accountId, true);
    if (!state) return "RISK_ACCOUNT_STATE_MISSING";
    let envelopeReason: string | null = null;
    try {
      const plan = await readExecutionPlanV2Postgres(tx, context, attempt.executionPlanId);
      if (!plan) return "PRE_POST_RECHECK_FAILED";
      const effective = await requireLiveCapitalOrderLimitV2(
        tx,
        context.organizationId,
        attempt.accountId,
        state.accounting.exposureLimitNotional,
      );
      assertNotionalWithinLiveCapitalLimitV2(plan.approvedNotionalCeiling, effective);
    } catch (error) {
      if (error instanceof LiveCapitalOrderLimitRefusedError) envelopeReason = error.reason;
      else throw error;
    }
    const orders = await tx
      .select({
        executionMode: pgSchema.traderOrders.executionMode,
        credentialId: pgSchema.traderOrders.credentialId,
      })
      .from(pgSchema.traderOrders)
      .where(
        and(
          eq(pgSchema.traderOrders.id, attempt.orderId),
          eq(pgSchema.traderOrders.organizationId, context.organizationId),
        ),
      )
      .limit(1);
    const mode = orders[0]?.executionMode;
    const executionMode = mode === "mock" || mode === "paper" || mode === "live" ? mode : "unknown";
    const planForGates =
      executionMode === "live"
        ? await readExecutionPlanV2Postgres(tx, context, attempt.executionPlanId)
        : null;
    const liveGates =
      executionMode === "live" && planForGates
        ? await loadExecutionV2LiveGateFactsPostgres(tx, context, {
            executionMode: "live",
            credentialId: orders[0]?.credentialId ?? null,
            strategyId: attempt.exactRequestPayload.strategyId ?? null,
            strategyVersion: attempt.exactRequestPayload.strategyVersion ?? null,
            plan: { approvedNotionalCeiling: planForGates.approvedNotionalCeiling },
          })
        : null;
    return evaluatePrePostRecheck({
      killState: state.killState,
      enforcingSwitch: await enforcingKillSwitchCoversAccountV2(tx, context.organizationId),
      envelopeReason,
      executionMode,
      liveGates,
    });
  });
}
