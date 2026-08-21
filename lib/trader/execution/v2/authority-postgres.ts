import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import {
  runWaiaPostgresTransaction,
  type WaiaPostgresDb,
} from "@/db/waia-postgres-transaction";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import {
  consumeRiskAllowanceForOrderV2FromTransaction,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";
import type { RiskAllowanceV2 } from "@/lib/trader/risk/v2/risk-allowance-v2";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  createExecutionAttemptV2,
  createExecutionPlanV2,
  deterministicExecutionClientOrderId,
  deterministicExecutionUuidV2,
  type CreateExecutionPlanV2Input,
  type ExecutionAttemptRequestPayloadV2,
  type ExecutionAttemptV2,
  type ExecutionPlanV2,
  type ExecutionPolicyBindingV2,
} from "./contracts";
import {
  appendExecutionReportV2FromExecutor,
  insertExecutionAttemptV2Postgres,
  insertExecutionPlanV2Postgres,
  insertExecutionPolicyV2Postgres,
  readExecutionAttemptProjectionV2Postgres,
  readExecutionPlanV2Postgres,
  readExecutionPolicyV2Postgres,
} from "./repository-postgres";

type PlanMechanicsV2 = Omit<
  CreateExecutionPlanV2Input,
  "executionPlanId" | "allowance" | "policy"
>;

export type BindExecutionAuthorityV2Input = Readonly<{
  allowance: RiskAllowanceV2;
  policy: ExecutionPolicyBindingV2;
  plan: PlanMechanicsV2;
  executionMode: "mock" | "paper" | "live";
  credentialId: string | null;
  strategySignalId: string | null;
  allocationDecisionId: string | null;
}>;

export type BoundExecutionAuthorityV2 = Readonly<{
  plan: ExecutionPlanV2;
  attempt: ExecutionAttemptV2;
  order: OrderRow & Readonly<{
    executionPlanId: string;
    executionPlanDigest: string;
    executionAttemptId: string;
    executionAttemptDigest: string;
  }>;
  consumedNow: boolean;
}>;

export class ExecutionV2AuthorityRefusedError extends Error {
  constructor(readonly reason: string) {
    super(`Execution V2 authority refused: ${reason}`);
    this.name = "ExecutionV2AuthorityRefusedError";
  }
}

function planIdentity(input: BindExecutionAuthorityV2Input): string {
  return deterministicExecutionUuidV2("plan", {
    organizationId: input.allowance.organizationId,
    accountId: input.allowance.accountId,
    allowanceContentDigestHex: input.allowance.contentDigestHex,
    policyContentDigestHex: input.policy.contentDigestHex,
    mechanics: input.plan,
  });
}

async function durableTransactionTime(
  tx: Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0],
): Promise<Date> {
  const rows = await tx.execute<{ durable_at: Date | string }>(
    sql`select date_trunc('milliseconds', transaction_timestamp()) as durable_at`,
  );
  const value = new Date(rows[0]!.durable_at);
  if (!Number.isFinite(value.getTime())) {
    throw new ExecutionV2AuthorityRefusedError("DURABLE_TRANSACTION_TIME_UNAVAILABLE");
  }
  return value;
}

function requireCurrentWindow(plan: ExecutionPlanV2, policy: ExecutionPolicyBindingV2, now: Date): void {
  const instant = now.getTime();
  if (instant < new Date(policy.effectiveFromUtc).getTime() ||
    instant >= new Date(policy.effectiveUntilUtc).getTime() ||
    instant < new Date(plan.timingWindow.opensAtUtc).getTime() ||
    instant >= new Date(plan.timingWindow.closesAtUtc).getTime()) {
    throw new ExecutionV2AuthorityRefusedError("EXECUTION_WINDOW_CLOSED");
  }
}

/**
 * The only V2 authority/effect bind. Risk locks, reservation transfer, exact order,
 * sealed plan, immutable attempt, and bind reports share one PostgreSQL transaction.
 */
export async function bindExecutionAuthorityV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: BindExecutionAuthorityV2Input,
): Promise<BoundExecutionAuthorityV2> {
  const scoped = requireOrgContext(context.organizationId);
  if (input.allowance.organizationId !== scoped.organizationId ||
    input.policy.organizationId !== scoped.organizationId) {
    throw new ExecutionV2AuthorityRefusedError("TENANT_SCOPE_MISMATCH");
  }
  const plan = createExecutionPlanV2({
    ...input.plan,
    executionPlanId: planIdentity(input),
    allowance: input.allowance,
    policy: input.policy,
  });
  const orderId = deterministicExecutionUuidV2("order", {
    organizationId: scoped.organizationId,
    executionPlanContentDigestHex: plan.contentDigestHex,
  });
  const attemptId = deterministicExecutionUuidV2("attempt", {
    organizationId: scoped.organizationId,
    orderId,
    executionPlanContentDigestHex: plan.contentDigestHex,
  });
  const consumptionEventId = deterministicExecutionUuidV2("risk-event", {
    organizationId: scoped.organizationId,
    riskAllowanceId: input.allowance.riskAllowanceId,
    orderId,
  });
  const clientOrderId = deterministicExecutionClientOrderId(plan.contentDigestHex);

  return runWaiaPostgresTransaction(db, async (tx) => {
    const durableAt = await durableTransactionTime(tx);
    requireCurrentWindow(plan, input.policy, durableAt);
    const storedPolicy = await insertExecutionPolicyV2Postgres(tx, scoped, input.policy);
    if (storedPolicy.contentDigestHex !== input.policy.contentDigestHex) {
      throw new ExecutionV2AuthorityRefusedError("POLICY_SEAL_MISMATCH");
    }
    const storedPlan = await insertExecutionPlanV2Postgres(tx, scoped, plan);
    const consumed = await consumeRiskAllowanceForOrderV2FromTransaction(tx, scoped, {
      accountId: input.allowance.accountId,
      riskAllowanceId: input.allowance.riskAllowanceId,
      riskAllowanceContentDigestHex: storedPlan.riskAllowanceContentDigestHex,
      effectNotionalCeiling: storedPlan.approvedNotionalCeiling,
      nonce: input.allowance.nonce,
      consumptionEventId,
      order: {
        id: orderId,
        executionMode: input.executionMode,
        symbol: storedPlan.symbol,
        side: storedPlan.side,
        type: storedPlan.orderType,
        price: storedPlan.limitPrice,
        quantity: storedPlan.plannedQuantity,
        clientOrderId,
        idempotencyKey: `execution-v2-${storedPlan.contentDigestHex}`,
        strategySignalId: input.strategySignalId,
        allocationDecisionId: input.allocationDecisionId,
        credentialId: input.credentialId,
      },
    });
    if (consumed.status !== "CONSUMED") {
      throw new ExecutionV2AuthorityRefusedError(consumed.reason);
    }

    if (!consumed.consumedNow) {
      const existing = await readExecutionAttemptProjectionV2Postgres(tx, scoped, attemptId, true);
      const orderRows = await tx.select({
        executionPlanId: pgSchema.traderOrders.executionPlanId,
        executionPlanDigest: pgSchema.traderOrders.executionPlanDigest,
        executionAttemptId: pgSchema.traderOrders.executionAttemptId,
        executionAttemptDigest: pgSchema.traderOrders.executionAttemptDigest,
      }).from(pgSchema.traderOrders).where(and(
        eq(pgSchema.traderOrders.id, consumed.order.id),
        eq(pgSchema.traderOrders.organizationId, scoped.organizationId),
      )).limit(1);
      const orderProjection = orderRows[0];
      if (!existing || !orderProjection ||
        existing.attempt.executionPlanContentDigestHex !== storedPlan.contentDigestHex ||
        existing.attempt.orderId !== consumed.order.id ||
        orderProjection.executionPlanId !== storedPlan.executionPlanId ||
        orderProjection.executionPlanDigest !== storedPlan.contentDigestHex ||
        orderProjection.executionAttemptId !== existing.attempt.executionAttemptId ||
        orderProjection.executionAttemptDigest !== existing.attempt.contentDigestHex) {
        throw new ExecutionV2AuthorityRefusedError("INCOMPLETE_OR_CONFLICTING_RESTART_BINDING");
      }
      return Object.freeze({
        plan: storedPlan,
        attempt: existing.attempt,
        order: Object.freeze({
          ...consumed.order,
          executionPlanId: orderProjection.executionPlanId!,
          executionPlanDigest: orderProjection.executionPlanDigest!,
          executionAttemptId: orderProjection.executionAttemptId!,
          executionAttemptDigest: orderProjection.executionAttemptDigest!,
        }),
        consumedNow: false,
      });
    }

    const attempt = createExecutionAttemptV2({
      executionAttemptId: attemptId,
      orderId,
      plan: storedPlan,
      riskAllowanceContentDigestHex: input.allowance.contentDigestHex,
      boundAtUtc: durableAt.toISOString(),
    });
    await tx.update(pgSchema.traderOrders).set({
      executionPlanId: storedPlan.executionPlanId,
      executionPlanDigest: storedPlan.contentDigestHex,
      executionAttemptId: attempt.executionAttemptId,
      executionAttemptDigest: attempt.contentDigestHex,
    }).where(and(
      eq(pgSchema.traderOrders.id, orderId),
      eq(pgSchema.traderOrders.organizationId, scoped.organizationId),
    ));
    const storedAttempt = await insertExecutionAttemptV2Postgres(tx, scoped, attempt);
    for (const [reportType, rawObservation] of [
      ["PLAN_SEALED", { executionPlanContentDigestHex: storedPlan.contentDigestHex }],
      ["ALLOWANCE_CLAIMED", { riskAllowanceContentDigestHex: input.allowance.contentDigestHex }],
      ["ATTEMPT_BOUND", { effectIdentityDigestHex: storedAttempt.effectIdentityDigestHex }],
    ] as const) {
      await appendExecutionReportV2FromExecutor(tx, scoped, {
        executionReportId: deterministicExecutionUuidV2("report", {
          executionAttemptContentDigestHex: storedAttempt.contentDigestHex,
          reportType,
        }),
        accountId: storedAttempt.accountId,
        executionAttemptId: storedAttempt.executionAttemptId,
        reportType,
        source: "EXECUTION",
        rawObservation,
        observedAtUtc: durableAt.toISOString(),
      });
    }
    return Object.freeze({
      plan: storedPlan,
      attempt: storedAttempt,
      order: Object.freeze({
        ...consumed.order,
        executionPlanId: storedPlan.executionPlanId,
        executionPlanDigest: storedPlan.contentDigestHex,
        executionAttemptId: storedAttempt.executionAttemptId,
        executionAttemptDigest: storedAttempt.contentDigestHex,
      }),
      consumedNow: true,
    });
  });
}

export type ExecutionV2NetworkSubmitter<T> = (
  payload: ExecutionAttemptRequestPayloadV2,
  authority: Readonly<{
    executionAttemptId: string;
    effectIdentityDigestHex: string;
    venue: string;
  }>,
) => Promise<T>;

export type DispatchCommittedExecutionV2Result<T> =
  | Readonly<{ status: "SUBMITTED"; attempt: ExecutionAttemptV2; rawResult: T }>
  | Readonly<{ status: "FAIL_UNKNOWN"; attempt: ExecutionAttemptV2; error: unknown }>
  | Readonly<{ status: "REFUSED_ALREADY_STARTED"; lifecycleState: string }>;

/** Marks the one allowed submission durably, commits, and only then invokes the network callback. */
export async function dispatchCommittedExecutionAttemptV2<T>(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  submit: ExecutionV2NetworkSubmitter<T>,
): Promise<DispatchCommittedExecutionV2Result<T>> {
  const scoped = requireOrgContext(context.organizationId);
  const ready = await runWaiaPostgresTransaction(db, async (tx) => {
    const projection = await readExecutionAttemptProjectionV2Postgres(
      tx,
      scoped,
      executionAttemptId,
      true,
    );
    if (!projection) throw new ExecutionV2AuthorityRefusedError("ATTEMPT_NOT_FOUND");
    if (projection.lifecycleState !== "BOUND") {
      return { status: "REFUSED_ALREADY_STARTED" as const, lifecycleState: projection.lifecycleState };
    }
    const durableAt = await durableTransactionTime(tx);
    const plan = await readExecutionPlanV2Postgres(
      tx,
      scoped,
      projection.attempt.executionPlanId,
    );
    const policy = plan
      ? await readExecutionPolicyV2Postgres(tx, scoped, plan.executionPolicyId)
      : null;
    const allowanceRows = await tx.select().from(pgSchema.traderRiskAllowancesV2).where(and(
      eq(pgSchema.traderRiskAllowancesV2.id, projection.attempt.riskAllowanceId),
      eq(pgSchema.traderRiskAllowancesV2.organizationId, scoped.organizationId),
      eq(pgSchema.traderRiskAllowancesV2.accountId, projection.attempt.accountId),
    )).for("update");
    const allowance = allowanceRows[0];
    const orderRows = await tx.select().from(pgSchema.traderOrders).where(and(
      eq(pgSchema.traderOrders.id, projection.attempt.orderId),
      eq(pgSchema.traderOrders.organizationId, scoped.organizationId),
    )).for("update");
    const order = orderRows[0];
    if (!plan || !policy || !allowance || !order) {
      throw new ExecutionV2AuthorityRefusedError("INCOMPLETE_DURABLE_EFFECT_BINDING");
    }
    const expectedAttempt = createExecutionAttemptV2({
      executionAttemptId: projection.attempt.executionAttemptId,
      orderId: projection.attempt.orderId,
      plan,
      riskAllowanceContentDigestHex: projection.attempt.riskAllowanceContentDigestHex,
      boundAtUtc: projection.attempt.boundAtUtc,
    });
    const priceMatches =
      (order.price === null && projection.attempt.exactRequestPayload.price === null) ||
      (order.price !== null && projection.attempt.exactRequestPayload.price !== null &&
        compareDecimal(order.price, projection.attempt.exactRequestPayload.price) === 0);
    if (expectedAttempt.contentDigestHex !== projection.attempt.contentDigestHex ||
      expectedAttempt.effectIdentityDigestHex !== projection.attempt.effectIdentityDigestHex ||
      plan.contentDigestHex !== projection.attempt.executionPlanContentDigestHex ||
      policy.contentDigestHex !== plan.executionPolicyContentDigestHex ||
      allowance.lifecycleState !== "CONSUMED" ||
      allowance.contentDigest !== projection.attempt.riskAllowanceContentDigestHex ||
      allowance.boundOrderId !== order.id ||
      allowance.boundOrderDigest !== order.riskAllowanceBindingDigest ||
      compareDecimal(plan.approvedNotionalCeiling, allowance.reservedExposureNotional) > 0 ||
      compareDecimal(plan.plannedQuantity, allowance.exactQualifiedQuantity) > 0 ||
      !["CREATED", "RISK_APPROVED"].includes(order.state) ||
      order.riskAllowanceId !== allowance.id ||
      order.riskDecisionId !== allowance.riskVerdictId || order.venue !== plan.venue ||
      order.symbol !== projection.attempt.exactRequestPayload.symbol ||
      order.side !== projection.attempt.exactRequestPayload.side ||
      order.type !== projection.attempt.exactRequestPayload.type || !priceMatches ||
      compareDecimal(order.quantity, projection.attempt.exactRequestPayload.quantity) !== 0 ||
      order.clientOrderId !== projection.attempt.clientOrderId ||
      order.idempotencyKey !== `execution-v2-${plan.contentDigestHex}` ||
      order.executionPlanId !== plan.executionPlanId ||
      order.executionPlanDigest !== plan.contentDigestHex ||
      order.executionAttemptId !== projection.attempt.executionAttemptId ||
      order.executionAttemptDigest !== projection.attempt.contentDigestHex) {
      throw new ExecutionV2AuthorityRefusedError("INCOMPLETE_DURABLE_EFFECT_BINDING");
    }
    requireCurrentWindow(plan, policy, durableAt);
    await appendExecutionReportV2FromExecutor(tx, scoped, {
      executionReportId: deterministicExecutionUuidV2("report", {
        executionAttemptContentDigestHex: projection.attempt.contentDigestHex,
        reportType: "SUBMIT_STARTED",
      }),
      accountId: projection.attempt.accountId,
      executionAttemptId: projection.attempt.executionAttemptId,
      reportType: "SUBMIT_STARTED",
      source: "EXECUTION",
      rawObservation: { effectIdentityDigestHex: projection.attempt.effectIdentityDigestHex },
      observedAtUtc: durableAt.toISOString(),
    });
    return { status: "READY" as const, attempt: projection.attempt };
  });
  if (ready.status !== "READY") return ready;
  try {
    const rawResult = await submit(ready.attempt.exactRequestPayload, {
      executionAttemptId: ready.attempt.executionAttemptId,
      effectIdentityDigestHex: ready.attempt.effectIdentityDigestHex,
      venue: ready.attempt.venue,
    });
    return Object.freeze({ status: "SUBMITTED", attempt: ready.attempt, rawResult });
  } catch (error) {
    return Object.freeze({ status: "FAIL_UNKNOWN", attempt: ready.attempt, error });
  }
}
