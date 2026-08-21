import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import {
  runWaiaPostgresTransaction,
  type WaiaPostgresDb,
} from "@/db/waia-postgres-transaction";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  createExecutionPolicyBindingV2,
  createExecutionReportV2,
  validateExecutionAttemptV2,
  validateExecutionPlanV2,
  validateExecutionPolicyBindingV2,
  validateExecutionReportV2,
  type ExecutionAttemptV2,
  type ExecutionPlanV2,
  type ExecutionPolicyBindingV2,
  type ExecutionReportTypeV2,
  type ExecutionReportV2,
} from "./contracts";

type ExecutionTx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];
export type ExecutionV2Executor = Pick<ExecutionTx, "select" | "insert" | "update">;
type PolicyRow = typeof pgSchema.traderExecutionPoliciesV2.$inferSelect;
type PlanRow = typeof pgSchema.traderExecutionPlansV2.$inferSelect;
type AttemptRow = typeof pgSchema.traderExecutionAttemptsV2.$inferSelect;
type ReportRow = typeof pgSchema.traderExecutionReportsV2.$inferSelect;

export class ExecutionV2PersistenceConflictError extends Error {
  constructor(message = "[trader] Execution V2 persistence conflict") {
    super(message);
    this.name = "ExecutionV2PersistenceConflictError";
  }
}

export type ExecutionAttemptLifecycleStateV2 =
  | "BOUND"
  | "SUBMIT_STARTED"
  | "VENUE_ACCEPTED"
  | "VENUE_REJECTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "RECONCILIATION_REQUIRED";

export type ExecutionAttemptProjectionV2 = Readonly<{
  attempt: ExecutionAttemptV2;
  lifecycleState: ExecutionAttemptLifecycleStateV2;
  nextReportSequence: string;
  lastReportDigestHex: string | null;
}>;

const EXECUTION_ATTEMPT_TRANSITIONS_V2: Readonly<Record<
  ExecutionAttemptLifecycleStateV2,
  readonly ExecutionAttemptLifecycleStateV2[]
>> = Object.freeze({
  BOUND: ["BOUND", "SUBMIT_STARTED", "RECONCILIATION_REQUIRED"],
  SUBMIT_STARTED: [
    "VENUE_ACCEPTED",
    "VENUE_REJECTED",
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCEL_REQUESTED",
    "RECONCILIATION_REQUIRED",
  ],
  VENUE_ACCEPTED: [
    "VENUE_ACCEPTED",
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCEL_REQUESTED",
    "RECONCILIATION_REQUIRED",
  ],
  VENUE_REJECTED: [],
  PARTIALLY_FILLED: [
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCEL_REQUESTED",
    "RECONCILIATION_REQUIRED",
  ],
  FILLED: [],
  CANCEL_REQUESTED: ["CANCELLED", "PARTIALLY_FILLED", "FILLED", "RECONCILIATION_REQUIRED"],
  CANCELLED: [],
  RECONCILIATION_REQUIRED: ["RECONCILIATION_REQUIRED"],
});

function mapPolicy(row: PolicyRow): ExecutionPolicyBindingV2 {
  const policy = createExecutionPolicyBindingV2({
    executionPolicyId: row.id,
    organizationId: row.organizationId,
    policyVersion: row.policyVersion,
    decisionId: row.decisionId,
    decisionContentDigestHex: row.decisionContentDigest,
    decisionExecutionPolicyDigestHex: row.decisionExecutionPolicyDigest,
    economicSizeSetDigestHex: row.economicSizeSetDigest,
    venue: row.venue,
    market: row.market as "SPOT",
    instrumentIdentityDigestHex: row.instrumentIdentityDigest,
    allowedOrderTypes: row.allowedOrderTypes as ExecutionPolicyBindingV2["allowedOrderTypes"],
    allowedTimeInForce: row.allowedTimeInForce as ExecutionPolicyBindingV2["allowedTimeInForce"],
    allowedLiquidityRoles: row.allowedLiquidityRoles as ExecutionPolicyBindingV2["allowedLiquidityRoles"],
    priceCollar: row.priceCollar as ExecutionPolicyBindingV2["priceCollar"],
    quantityRules: row.quantityRules as ExecutionPolicyBindingV2["quantityRules"],
    slicingPolicy: row.slicingPolicy as ExecutionPolicyBindingV2["slicingPolicy"],
    retryPolicy: row.retryPolicy as ExecutionPolicyBindingV2["retryPolicy"],
    cancelPolicy: row.cancelPolicy as ExecutionPolicyBindingV2["cancelPolicy"],
    timeoutMs: row.timeoutMs,
    uncertaintyHandling: row.uncertaintyHandling as "RECONCILIATION_REQUIRED",
    effectiveFromUtc: row.effectiveFrom.toISOString(),
    effectiveUntilUtc: row.effectiveUntil.toISOString(),
  });
  if (policy.semanticDigestHex !== row.semanticDigest ||
    policy.contentDigestHex !== row.contentDigest || !validateExecutionPolicyBindingV2(policy)) {
    throw new ExecutionV2PersistenceConflictError("stored Execution policy seal mismatch");
  }
  return policy;
}

function mapPlan(row: PlanRow): ExecutionPlanV2 {
  const plan: ExecutionPlanV2 = Object.freeze({
    schemaVersion: row.schemaVersion as ExecutionPlanV2["schemaVersion"],
    executionPlanId: row.id,
    organizationId: row.organizationId,
    accountId: row.accountId,
    riskAllowanceId: row.riskAllowanceId,
    riskAllowanceContentDigestHex: row.riskAllowanceContentDigest,
    riskVerdictId: row.riskVerdictId,
    decisionId: row.decisionId,
    decisionContentDigestHex: row.decisionContentDigest,
    economicSizeSetDigestHex: row.economicSizeSetDigest,
    instrumentIdentityDigestHex: row.instrumentIdentityDigest,
    symbol: row.symbol,
    action: row.action as ExecutionPlanV2["action"],
    side: row.side as ExecutionPlanV2["side"],
    approvedQualifiedQuantityCeiling: formatDecimal(parseDecimal(row.approvedQualifiedQuantityCeiling)),
    approvedNotionalCeiling: formatDecimal(parseDecimal(row.approvedNotionalCeiling)),
    plannedQuantity: formatDecimal(parseDecimal(row.plannedQuantity)),
    venue: row.venue,
    orderType: row.orderType as ExecutionPlanV2["orderType"],
    liquidityRole: row.liquidityRole as ExecutionPlanV2["liquidityRole"],
    limitPrice: row.limitPrice === null ? null : formatDecimal(parseDecimal(row.limitPrice)),
    priceCollar: row.priceCollar as ExecutionPlanV2["priceCollar"],
    timeInForce: row.timeInForce as ExecutionPlanV2["timeInForce"],
    timingWindow: row.timingWindow as ExecutionPlanV2["timingWindow"],
    quantityRules: row.quantityRules as ExecutionPlanV2["quantityRules"],
    childSlices: row.childSlices as ExecutionPlanV2["childSlices"],
    retryPolicy: row.retryPolicy as ExecutionPlanV2["retryPolicy"],
    cancelPolicy: row.cancelPolicy as ExecutionPlanV2["cancelPolicy"],
    executionPolicyId: row.executionPolicyId,
    executionPolicyContentDigestHex: row.executionPolicyContentDigest,
    sealedAtUtc: row.sealedAt.toISOString(),
    semanticDigestHex: row.semanticDigest,
    contentDigestHex: row.contentDigest,
  });
  if (!validateExecutionPlanV2(plan)) {
    throw new ExecutionV2PersistenceConflictError("stored Execution plan seal mismatch");
  }
  return plan;
}

function mapAttempt(row: AttemptRow): ExecutionAttemptV2 {
  const attempt: ExecutionAttemptV2 = Object.freeze({
    schemaVersion: row.schemaVersion as ExecutionAttemptV2["schemaVersion"],
    executionAttemptId: row.id,
    organizationId: row.organizationId,
    accountId: row.accountId,
    executionPlanId: row.executionPlanId,
    executionPlanContentDigestHex: row.executionPlanContentDigest,
    riskAllowanceId: row.riskAllowanceId,
    riskAllowanceContentDigestHex: row.riskAllowanceContentDigest,
    orderId: row.orderId,
    attemptSequence: row.attemptSequence.toString() as "1",
    effectIdentityDigestHex: row.effectIdentityDigest,
    clientOrderId: row.clientOrderId,
    venue: row.venue,
    exactRequestPayload: row.exactRequestPayload as ExecutionAttemptV2["exactRequestPayload"],
    lifecycleState: "BOUND",
    boundAtUtc: row.boundAt.toISOString(),
    semanticDigestHex: row.semanticDigest,
    contentDigestHex: row.contentDigest,
  });
  if (!validateExecutionAttemptV2(attempt)) {
    throw new ExecutionV2PersistenceConflictError("stored Execution attempt seal mismatch");
  }
  return attempt;
}

function mapReport(row: ReportRow): ExecutionReportV2 {
  const report: ExecutionReportV2 = Object.freeze({
    schemaVersion: row.schemaVersion as ExecutionReportV2["schemaVersion"],
    executionReportId: row.id,
    organizationId: row.organizationId,
    accountId: row.accountId,
    executionAttemptId: row.executionAttemptId,
    executionAttemptContentDigestHex: row.executionAttemptContentDigest,
    reportSequence: row.reportSequence.toString(),
    reportType: row.reportType as ExecutionReportTypeV2,
    source: row.source as ExecutionReportV2["source"],
    rawObservation: row.rawObservation as ExecutionReportV2["rawObservation"],
    venueOrderId: row.venueOrderId,
    observedAtUtc: row.observedAt.toISOString(),
    previousReportDigestHex: row.previousReportDigest,
    contentDigestHex: row.contentDigest,
  });
  if (!validateExecutionReportV2(report)) {
    throw new ExecutionV2PersistenceConflictError("stored Execution report seal mismatch");
  }
  return report;
}

export async function insertExecutionPolicyV2Postgres(
  ex: ExecutionV2Executor,
  context: OrgContext,
  policy: ExecutionPolicyBindingV2,
): Promise<ExecutionPolicyBindingV2> {
  const scoped = requireOrgContext(context.organizationId);
  if (policy.organizationId !== scoped.organizationId || !validateExecutionPolicyBindingV2(policy)) {
    throw new ExecutionV2PersistenceConflictError("invalid tenant-scoped policy");
  }
  await ex.insert(pgSchema.traderExecutionPoliciesV2).values({
    id: policy.executionPolicyId,
    organizationId: policy.organizationId,
    policyVersion: policy.policyVersion,
    decisionId: policy.decisionId,
    decisionContentDigest: policy.decisionContentDigestHex,
    decisionExecutionPolicyDigest: policy.decisionExecutionPolicyDigestHex,
    economicSizeSetDigest: policy.economicSizeSetDigestHex,
    venue: policy.venue,
    market: policy.market,
    instrumentIdentityDigest: policy.instrumentIdentityDigestHex,
    allowedOrderTypes: policy.allowedOrderTypes,
    allowedTimeInForce: policy.allowedTimeInForce,
    allowedLiquidityRoles: policy.allowedLiquidityRoles,
    priceCollar: policy.priceCollar,
    quantityRules: policy.quantityRules,
    slicingPolicy: policy.slicingPolicy,
    retryPolicy: policy.retryPolicy,
    cancelPolicy: policy.cancelPolicy,
    timeoutMs: policy.timeoutMs,
    uncertaintyHandling: policy.uncertaintyHandling,
    effectiveFrom: new Date(policy.effectiveFromUtc),
    effectiveUntil: new Date(policy.effectiveUntilUtc),
    semanticDigest: policy.semanticDigestHex,
    contentDigest: policy.contentDigestHex,
    schemaVersion: policy.schemaVersion,
  }).onConflictDoNothing();
  const rows = await ex.select().from(pgSchema.traderExecutionPoliciesV2).where(and(
    eq(pgSchema.traderExecutionPoliciesV2.id, policy.executionPolicyId),
    eq(pgSchema.traderExecutionPoliciesV2.organizationId, scoped.organizationId),
  )).limit(1);
  if (!rows[0]) throw new ExecutionV2PersistenceConflictError("policy insert missing");
  const stored = mapPolicy(rows[0]);
  if (stored.contentDigestHex !== policy.contentDigestHex) {
    throw new ExecutionV2PersistenceConflictError("policy identity conflict");
  }
  return stored;
}

export async function insertExecutionPlanV2Postgres(
  ex: ExecutionV2Executor,
  context: OrgContext,
  plan: ExecutionPlanV2,
): Promise<ExecutionPlanV2> {
  const scoped = requireOrgContext(context.organizationId);
  if (plan.organizationId !== scoped.organizationId || !validateExecutionPlanV2(plan)) {
    throw new ExecutionV2PersistenceConflictError("invalid tenant-scoped plan");
  }
  await ex.insert(pgSchema.traderExecutionPlansV2).values({
    id: plan.executionPlanId,
    organizationId: plan.organizationId,
    accountId: plan.accountId,
    riskAllowanceId: plan.riskAllowanceId,
    riskAllowanceContentDigest: plan.riskAllowanceContentDigestHex,
    riskVerdictId: plan.riskVerdictId,
    decisionId: plan.decisionId,
    decisionContentDigest: plan.decisionContentDigestHex,
    economicSizeSetDigest: plan.economicSizeSetDigestHex,
    instrumentIdentityDigest: plan.instrumentIdentityDigestHex,
    symbol: plan.symbol,
    action: plan.action,
    side: plan.side,
    approvedQualifiedQuantityCeiling: plan.approvedQualifiedQuantityCeiling,
    approvedNotionalCeiling: plan.approvedNotionalCeiling,
    plannedQuantity: plan.plannedQuantity,
    venue: plan.venue,
    orderType: plan.orderType,
    liquidityRole: plan.liquidityRole,
    limitPrice: plan.limitPrice,
    priceCollar: plan.priceCollar,
    timeInForce: plan.timeInForce,
    timingWindow: plan.timingWindow,
    quantityRules: plan.quantityRules,
    childSlices: plan.childSlices,
    retryPolicy: plan.retryPolicy,
    cancelPolicy: plan.cancelPolicy,
    executionPolicyId: plan.executionPolicyId,
    executionPolicyContentDigest: plan.executionPolicyContentDigestHex,
    sealedAt: new Date(plan.sealedAtUtc),
    semanticDigest: plan.semanticDigestHex,
    contentDigest: plan.contentDigestHex,
    schemaVersion: plan.schemaVersion,
  }).onConflictDoNothing();
  const rows = await ex.select().from(pgSchema.traderExecutionPlansV2).where(and(
    eq(pgSchema.traderExecutionPlansV2.id, plan.executionPlanId),
    eq(pgSchema.traderExecutionPlansV2.organizationId, scoped.organizationId),
  )).limit(1);
  if (!rows[0]) throw new ExecutionV2PersistenceConflictError("plan insert missing");
  const stored = mapPlan(rows[0]);
  if (stored.contentDigestHex !== plan.contentDigestHex) {
    throw new ExecutionV2PersistenceConflictError("plan identity conflict");
  }
  return stored;
}

export async function insertExecutionAttemptV2Postgres(
  ex: ExecutionV2Executor,
  context: OrgContext,
  attempt: ExecutionAttemptV2,
): Promise<ExecutionAttemptV2> {
  const scoped = requireOrgContext(context.organizationId);
  if (attempt.organizationId !== scoped.organizationId || !validateExecutionAttemptV2(attempt)) {
    throw new ExecutionV2PersistenceConflictError("invalid tenant-scoped attempt");
  }
  await ex.insert(pgSchema.traderExecutionAttemptsV2).values({
    id: attempt.executionAttemptId,
    organizationId: attempt.organizationId,
    accountId: attempt.accountId,
    executionPlanId: attempt.executionPlanId,
    executionPlanContentDigest: attempt.executionPlanContentDigestHex,
    riskAllowanceId: attempt.riskAllowanceId,
    riskAllowanceContentDigest: attempt.riskAllowanceContentDigestHex,
    orderId: attempt.orderId,
    attemptSequence: 1n,
    effectIdentityDigest: attempt.effectIdentityDigestHex,
    clientOrderId: attempt.clientOrderId,
    venue: attempt.venue,
    exactRequestPayload: attempt.exactRequestPayload,
    lifecycleState: attempt.lifecycleState,
    nextReportSequence: 1n,
    lastReportDigest: null,
    boundAt: new Date(attempt.boundAtUtc),
    updatedAt: new Date(attempt.boundAtUtc),
    semanticDigest: attempt.semanticDigestHex,
    contentDigest: attempt.contentDigestHex,
    schemaVersion: attempt.schemaVersion,
  }).onConflictDoNothing();
  const rows = await ex.select().from(pgSchema.traderExecutionAttemptsV2).where(and(
    eq(pgSchema.traderExecutionAttemptsV2.id, attempt.executionAttemptId),
    eq(pgSchema.traderExecutionAttemptsV2.organizationId, scoped.organizationId),
  )).limit(1);
  if (!rows[0]) throw new ExecutionV2PersistenceConflictError("attempt insert missing");
  const stored = mapAttempt(rows[0]);
  if (stored.contentDigestHex !== attempt.contentDigestHex) {
    throw new ExecutionV2PersistenceConflictError("attempt identity conflict");
  }
  return stored;
}

export async function readExecutionAttemptV2Postgres(
  ex: Pick<ExecutionV2Executor, "select">,
  context: OrgContext,
  executionAttemptId: string,
): Promise<ExecutionAttemptV2 | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex.select().from(pgSchema.traderExecutionAttemptsV2).where(and(
    eq(pgSchema.traderExecutionAttemptsV2.id, executionAttemptId),
    eq(pgSchema.traderExecutionAttemptsV2.organizationId, scoped.organizationId),
  )).limit(1);
  return rows[0] ? mapAttempt(rows[0]) : null;
}

export async function readExecutionAttemptProjectionV2Postgres(
  ex: Pick<ExecutionV2Executor, "select">,
  context: OrgContext,
  executionAttemptId: string,
  lockForUpdate = false,
): Promise<ExecutionAttemptProjectionV2 | null> {
  const scoped = requireOrgContext(context.organizationId);
  const query = ex.select().from(pgSchema.traderExecutionAttemptsV2).where(and(
    eq(pgSchema.traderExecutionAttemptsV2.id, executionAttemptId),
    eq(pgSchema.traderExecutionAttemptsV2.organizationId, scoped.organizationId),
  ));
  const rows = lockForUpdate ? await query.for("update") : await query.limit(1);
  const row = rows[0];
  return row ? Object.freeze({
    attempt: mapAttempt(row),
    lifecycleState: row.lifecycleState as ExecutionAttemptLifecycleStateV2,
    nextReportSequence: row.nextReportSequence.toString(),
    lastReportDigestHex: row.lastReportDigest,
  }) : null;
}

export async function readExecutionPolicyV2Postgres(
  ex: Pick<ExecutionV2Executor, "select">,
  context: OrgContext,
  executionPolicyId: string,
): Promise<ExecutionPolicyBindingV2 | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex.select().from(pgSchema.traderExecutionPoliciesV2).where(and(
    eq(pgSchema.traderExecutionPoliciesV2.id, executionPolicyId),
    eq(pgSchema.traderExecutionPoliciesV2.organizationId, scoped.organizationId),
  )).limit(1);
  return rows[0] ? mapPolicy(rows[0]) : null;
}

export async function readExecutionPlanV2Postgres(
  ex: Pick<ExecutionV2Executor, "select">,
  context: OrgContext,
  executionPlanId: string,
): Promise<ExecutionPlanV2 | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex.select().from(pgSchema.traderExecutionPlansV2).where(and(
    eq(pgSchema.traderExecutionPlansV2.id, executionPlanId),
    eq(pgSchema.traderExecutionPlansV2.organizationId, scoped.organizationId),
  )).limit(1);
  return rows[0] ? mapPlan(rows[0]) : null;
}

export async function appendExecutionReportV2FromExecutor(
  ex: ExecutionV2Executor,
  context: OrgContext,
  input: Readonly<{
    executionReportId: string;
    accountId: string;
    executionAttemptId: string;
    reportType: ExecutionReportTypeV2;
    source: ExecutionReportV2["source"];
    rawObservation: Readonly<Record<string, unknown>>;
    venueOrderId?: string | null;
    observedAtUtc: string;
    lifecycleState: ExecutionAttemptLifecycleStateV2;
  }>,
): Promise<ExecutionReportV2> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex.select().from(pgSchema.traderExecutionAttemptsV2).where(and(
    eq(pgSchema.traderExecutionAttemptsV2.id, input.executionAttemptId),
    eq(pgSchema.traderExecutionAttemptsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderExecutionAttemptsV2.accountId, input.accountId),
  )).for("update");
  const row = rows[0];
  if (!row) throw new ExecutionV2PersistenceConflictError("Execution attempt not found");
  const currentLifecycle = row.lifecycleState as ExecutionAttemptLifecycleStateV2;
  if (!EXECUTION_ATTEMPT_TRANSITIONS_V2[currentLifecycle].includes(input.lifecycleState)) {
    throw new ExecutionV2PersistenceConflictError(
      `invalid Execution attempt transition ${currentLifecycle}->${input.lifecycleState}`,
    );
  }
  const report = createExecutionReportV2({
    executionReportId: input.executionReportId,
    organizationId: scoped.organizationId,
    accountId: input.accountId,
    executionAttemptId: row.id,
    executionAttemptContentDigestHex: row.contentDigest,
    reportSequence: row.nextReportSequence.toString(),
    reportType: input.reportType,
    source: input.source,
    rawObservation: input.rawObservation,
    venueOrderId: input.venueOrderId ?? null,
    observedAtUtc: input.observedAtUtc,
    previousReportDigestHex: row.lastReportDigest,
  });
  await ex.insert(pgSchema.traderExecutionReportsV2).values({
    id: report.executionReportId,
    organizationId: report.organizationId,
    accountId: report.accountId,
    executionAttemptId: report.executionAttemptId,
    executionAttemptContentDigest: report.executionAttemptContentDigestHex,
    reportSequence: BigInt(report.reportSequence),
    reportType: report.reportType,
    source: report.source,
    rawObservation: report.rawObservation,
    venueOrderId: report.venueOrderId,
    observedAt: new Date(report.observedAtUtc),
    previousReportDigest: report.previousReportDigestHex,
    contentDigest: report.contentDigestHex,
    schemaVersion: report.schemaVersion,
  });
  await ex.update(pgSchema.traderExecutionAttemptsV2).set({
    lifecycleState: input.lifecycleState,
    nextReportSequence: row.nextReportSequence + 1n,
    lastReportDigest: report.contentDigestHex,
    updatedAt: new Date(report.observedAtUtc),
  }).where(and(
    eq(pgSchema.traderExecutionAttemptsV2.id, row.id),
    eq(pgSchema.traderExecutionAttemptsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderExecutionAttemptsV2.nextReportSequence, row.nextReportSequence),
  ));
  return report;
}

export function appendExecutionReportV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: Parameters<typeof appendExecutionReportV2FromExecutor>[2],
): Promise<ExecutionReportV2> {
  return runWaiaPostgresTransaction(db, (tx) =>
    appendExecutionReportV2FromExecutor(tx, context, input));
}

export async function listExecutionReportsV2Postgres(
  ex: Pick<ExecutionV2Executor, "select">,
  context: OrgContext,
  executionAttemptId: string,
): Promise<readonly ExecutionReportV2[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex.select().from(pgSchema.traderExecutionReportsV2).where(and(
    eq(pgSchema.traderExecutionReportsV2.executionAttemptId, executionAttemptId),
    eq(pgSchema.traderExecutionReportsV2.organizationId, scoped.organizationId),
  )).orderBy(asc(pgSchema.traderExecutionReportsV2.reportSequence));
  return Object.freeze(rows.map(mapReport));
}

export { mapAttempt as executionAttemptV2FromRow, mapPlan as executionPlanV2FromRow };
