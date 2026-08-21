import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import {
  runWaiaPostgresTransaction,
  type WaiaPostgresDb,
} from "@/db/waia-postgres-transaction";
import {
  addDecimal,
  compareDecimal,
  formatDecimal,
  parseDecimal,
} from "@/lib/trader/risk/numeric";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  createExecutionPolicyBindingV2,
  createExecutionReportV2,
  multiplyExecutionNotionalConservativelyV2,
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

type RawEvidence = Readonly<Record<string, unknown>>;

function asEvidence(value: unknown): RawEvidence | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RawEvidence
    : null;
}

function exactBoundOrderEvidence(
  attempt: ExecutionAttemptV2,
  rawObservation: RawEvidence,
  venueOrderId: string | null,
  statuses: readonly string[],
): RawEvidence {
  const order = asEvidence(rawObservation.order);
  if (!order || typeof order.orderId !== "string" || order.orderId.trim() === "" ||
    venueOrderId !== order.orderId || order.clientOrderId !== attempt.clientOrderId ||
    order.symbol !== attempt.exactRequestPayload.symbol ||
    order.side !== attempt.exactRequestPayload.side ||
    order.type !== attempt.exactRequestPayload.type ||
    typeof order.status !== "string" || !statuses.includes(order.status) ||
    typeof order.quantity !== "string" ||
    compareDecimal(order.quantity, attempt.exactRequestPayload.quantity) !== 0 ||
    typeof order.filledQuantity !== "string" ||
    compareDecimal(order.filledQuantity, "0") < 0 ||
    compareDecimal(order.filledQuantity, attempt.exactRequestPayload.quantity) > 0) {
    throw new ExecutionV2PersistenceConflictError(
      "venue report lacks exact bound order evidence",
    );
  }
  const expectedPrice = attempt.exactRequestPayload.price;
  const observedPrice = order.price;
  if ((expectedPrice === null && observedPrice !== null) ||
    (expectedPrice !== null && (
      typeof observedPrice !== "string" ||
      compareDecimal(observedPrice, expectedPrice) !== 0
    ))) {
    throw new ExecutionV2PersistenceConflictError(
      "venue report price does not match the bound effect",
    );
  }
  return order;
}

function validateFillEvidence(
  attempt: ExecutionAttemptV2,
  plan: ExecutionPlanV2,
  rawObservation: RawEvidence,
  order: RawEvidence,
): ExecutionAttemptLifecycleStateV2 {
  const trades = rawObservation.trades;
  if (!Array.isArray(trades) || trades.length === 0) {
    throw new ExecutionV2PersistenceConflictError(
      "fill report requires exact raw trade evidence",
    );
  }
  const tradeIds = new Set<string>();
  let filledQuantity = "0";
  let filledNotional = "0";
  for (const value of trades) {
    const trade = asEvidence(value);
    if (!trade || typeof trade.tradeId !== "string" || trade.tradeId.trim() === "" ||
      tradeIds.has(trade.tradeId) || trade.orderId !== order.orderId ||
      trade.clientOrderId !== attempt.clientOrderId ||
      trade.symbol !== attempt.exactRequestPayload.symbol ||
      trade.side !== attempt.exactRequestPayload.side ||
      typeof trade.price !== "string" || compareDecimal(trade.price, "0") <= 0 ||
      typeof trade.quantity !== "string" || compareDecimal(trade.quantity, "0") <= 0 ||
      typeof trade.fee !== "string" || compareDecimal(trade.fee, "0") < 0 ||
      typeof trade.feeAsset !== "string" || trade.feeAsset.trim() === "" ||
      typeof trade.executedAt !== "string" ||
      !Number.isFinite(new Date(trade.executedAt).getTime()) ||
      compareDecimal(trade.price, plan.priceCollar.minimumPrice) < 0 ||
      compareDecimal(trade.price, plan.priceCollar.maximumPrice) > 0 ||
      (plan.limitPrice !== null && plan.side === "buy" &&
        compareDecimal(trade.price, plan.limitPrice) > 0) ||
      (plan.limitPrice !== null && plan.side === "sell" &&
        compareDecimal(trade.price, plan.limitPrice) < 0)) {
      throw new ExecutionV2PersistenceConflictError(
        "fill report trade evidence does not match the bound effect",
      );
    }
    tradeIds.add(trade.tradeId);
    filledQuantity = addDecimal(filledQuantity, trade.quantity);
    filledNotional = addDecimal(
      filledNotional,
      multiplyExecutionNotionalConservativelyV2(trade.quantity, trade.price),
    );
  }
  if (typeof order.filledQuantity !== "string" ||
    compareDecimal(filledQuantity, order.filledQuantity) !== 0 ||
    compareDecimal(filledQuantity, attempt.exactRequestPayload.quantity) > 0 ||
    (plan.action === "ENTER_LONG" &&
      compareDecimal(filledNotional, plan.approvedNotionalCeiling) > 0)) {
    throw new ExecutionV2PersistenceConflictError(
      "fill report totals exceed or differ from bound authority",
    );
  }
  if (order.status === "filled" &&
    compareDecimal(filledQuantity, attempt.exactRequestPayload.quantity) === 0) {
    return "FILLED";
  }
  if (order.status === "partially_filled" &&
    compareDecimal(filledQuantity, "0") > 0 &&
    compareDecimal(filledQuantity, attempt.exactRequestPayload.quantity) < 0) {
    return "PARTIALLY_FILLED";
  }
  throw new ExecutionV2PersistenceConflictError(
    "fill report lifecycle differs from exact trade totals",
  );
}

function lifecycleStateForReport(
  reportType: ExecutionReportTypeV2,
  source: ExecutionReportV2["source"],
  rawObservation: RawEvidence,
  venueOrderId: string | null,
  attempt: ExecutionAttemptV2,
  plan: ExecutionPlanV2,
  priorReports: readonly ExecutionReportV2[],
): ExecutionAttemptLifecycleStateV2 {
  const connectorReport = [
    "VENUE_ACCEPTED",
    "VENUE_REJECTED",
    "VENUE_STATUS_OBSERVED",
    "CANCEL_ACKNOWLEDGED",
    "FILL_REPORT_OBSERVED",
    "CONNECTOR_UNCERTAIN",
  ].includes(reportType);
  if ((connectorReport && source !== "CONNECTOR") ||
    (!connectorReport && source !== "EXECUTION")) {
    throw new ExecutionV2PersistenceConflictError(
      "Execution report source does not match report type",
    );
  }
  switch (reportType) {
    case "PLAN_SEALED":
    case "ALLOWANCE_CLAIMED":
    case "ATTEMPT_BOUND":
      return "BOUND";
    case "SUBMIT_STARTED":
      return "SUBMIT_STARTED";
    case "VENUE_ACCEPTED": {
      const order = exactBoundOrderEvidence(
        attempt,
        rawObservation,
        venueOrderId,
        ["open"],
      );
      if (compareDecimal(String(order.filledQuantity), "0") !== 0) {
        throw new ExecutionV2PersistenceConflictError(
          "accepted order cannot claim a fill",
        );
      }
      return "VENUE_ACCEPTED";
    }
    case "VENUE_REJECTED": {
      const order = exactBoundOrderEvidence(
        attempt,
        rawObservation,
        venueOrderId,
        ["rejected"],
      );
      if (compareDecimal(String(order.filledQuantity), "0") !== 0) {
        throw new ExecutionV2PersistenceConflictError(
          "rejected order cannot claim a fill",
        );
      }
      return "VENUE_REJECTED";
    }
    case "CANCEL_REQUESTED":
      return "CANCEL_REQUESTED";
    case "CANCEL_ACKNOWLEDGED": {
      const order = exactBoundOrderEvidence(
        attempt,
        rawObservation,
        venueOrderId,
        ["canceled"],
      );
      const priorVenueOrderIds = new Set(
        priorReports.flatMap((report) => report.venueOrderId === null
          ? []
          : [report.venueOrderId]),
      );
      const lastFill = [...priorReports].reverse().find(
        (report) => report.reportType === "FILL_REPORT_OBSERVED",
      );
      const lastFillOrder = lastFill ? asEvidence(lastFill.rawObservation.order) : null;
      const previouslyObservedFilledQuantity = lastFillOrder &&
        typeof lastFillOrder.filledQuantity === "string"
        ? lastFillOrder.filledQuantity
        : "0";
      if (priorVenueOrderIds.size !== 1 || !priorVenueOrderIds.has(String(order.orderId)) ||
        compareDecimal(
          String(order.filledQuantity),
          previouslyObservedFilledQuantity,
        ) !== 0) {
        throw new ExecutionV2PersistenceConflictError(
          "cancel acknowledgement identity or fill total requires reconciliation",
        );
      }
      return "CANCELLED";
    }
    case "FILL_REPORT_OBSERVED": {
      const order = exactBoundOrderEvidence(
        attempt,
        rawObservation,
        venueOrderId,
        ["filled", "partially_filled"],
      );
      return validateFillEvidence(attempt, plan, rawObservation, order);
    }
    case "VENUE_STATUS_OBSERVED":
    case "CONNECTOR_UNCERTAIN":
    case "RECONCILIATION_REQUIRED":
      return "RECONCILIATION_REQUIRED";
  }
}

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
  const attempt = mapAttempt(row);
  const planRows = await ex.select().from(pgSchema.traderExecutionPlansV2).where(and(
    eq(pgSchema.traderExecutionPlansV2.id, row.executionPlanId),
    eq(pgSchema.traderExecutionPlansV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderExecutionPlansV2.accountId, row.accountId),
  )).limit(1);
  if (!planRows[0]) {
    throw new ExecutionV2PersistenceConflictError("Execution plan not found for report");
  }
  const plan = mapPlan(planRows[0]);
  const priorReportRows = await ex.select().from(pgSchema.traderExecutionReportsV2).where(and(
    eq(pgSchema.traderExecutionReportsV2.executionAttemptId, row.id),
    eq(pgSchema.traderExecutionReportsV2.organizationId, scoped.organizationId),
    eq(pgSchema.traderExecutionReportsV2.accountId, row.accountId),
  )).orderBy(asc(pgSchema.traderExecutionReportsV2.reportSequence));
  const priorReports = priorReportRows.map(mapReport);
  const currentLifecycle = row.lifecycleState as ExecutionAttemptLifecycleStateV2;
  const lifecycleState = lifecycleStateForReport(
    input.reportType,
    input.source,
    input.rawObservation,
    input.venueOrderId ?? null,
    attempt,
    plan,
    priorReports,
  );
  if (!EXECUTION_ATTEMPT_TRANSITIONS_V2[currentLifecycle].includes(lifecycleState)) {
    throw new ExecutionV2PersistenceConflictError(
      `invalid Execution attempt transition ${currentLifecycle}->${lifecycleState}`,
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
    lifecycleState,
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
