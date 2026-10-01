import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { sql } from "drizzle-orm";

import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { HtxPlacementRejectedError } from "@/lib/trader/connectors/htx/classify-htx-placement";
import type { Order, Trade } from "@/lib/trader/connectors/types";
import { addDecimal, compareDecimal } from "@/lib/trader/risk/numeric";
import { emitUnresolvedExecutionAttemptV2 } from "@/lib/trader/execution/execution-telemetry";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  dispatchCommittedExecutionAttemptV2,
  type ExecutionV2NetworkSubmitter,
} from "./authority-postgres";
import {
  deterministicExecutionUuidV2,
  multiplyExecutionNotionalConservativelyV2,
  type ExecutionAttemptV2,
  type ExecutionPlanV2,
} from "./contracts";
import {
  appendExecutionReportV2FromExecutor,
  listExecutionReportsV2Postgres,
  readExecutionAttemptProjectionV2Postgres,
  readExecutionPlanV2Postgres,
} from "./repository-postgres";

export type ExecutionV2VenueObservation = Readonly<{
  order: Order;
  trades: readonly Trade[];
  raw: Readonly<Record<string, unknown>>;
}>;

export type DispatchAndRecordExecutionV2Result = Readonly<{
  status:
    | "VENUE_ACCEPTED"
    | "VENUE_REJECTED"
    | "PARTIALLY_FILLED"
    | "FILLED"
    | "RECONCILIATION_REQUIRED"
    | "REFUSED_ALREADY_TERMINAL";
  attempt: ExecutionAttemptV2 | null;
}>;

type ReportAppend = Readonly<{
  reportType:
    | "VENUE_ACCEPTED"
    | "VENUE_REJECTED"
    | "VENUE_STATUS_OBSERVED"
    | "CANCEL_REQUESTED"
    | "CANCEL_ACKNOWLEDGED"
    | "FILL_REPORT_OBSERVED"
    | "CONNECTOR_UNCERTAIN"
    | "RECONCILIATION_REQUIRED";
  source: "EXECUTION" | "CONNECTOR";
  rawObservation: Readonly<Record<string, unknown>>;
  venueOrderId: string | null;
}>;

type ExecutionV2Transaction = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];

function rawOrder(order: Order): Readonly<Record<string, unknown>> {
  return Object.freeze({
    orderId: order.orderId,
    clientOrderId: order.clientOrderId,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    status: order.status,
    price: order.price ?? null,
    quantity: order.quantity,
    filledQuantity: order.filledQuantity,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  });
}

function rawTrade(trade: Trade): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...trade });
}

function exactOrderMechanicsMatch(attempt: ExecutionAttemptV2, order: Order): boolean {
  try {
    const payload = attempt.exactRequestPayload;
    const priceMatches =
      payload.price === null
        ? order.price == null
        : order.price != null && compareDecimal(order.price, payload.price) === 0;
    return (
      order.orderId.trim() !== "" &&
      order.clientOrderId === attempt.clientOrderId &&
      order.symbol === payload.symbol &&
      order.side === payload.side &&
      order.type === payload.type &&
      priceMatches &&
      compareDecimal(order.quantity, payload.quantity) === 0 &&
      compareDecimal(order.filledQuantity, "0") >= 0 &&
      compareDecimal(order.filledQuantity, payload.quantity) <= 0 &&
      (!(order.status === "open" || order.status === "rejected") ||
        compareDecimal(order.filledQuantity, "0") === 0) &&
      (order.status !== "filled" || compareDecimal(order.filledQuantity, payload.quantity) === 0) &&
      (order.status !== "partially_filled" ||
        (compareDecimal(order.filledQuantity, "0") > 0 &&
          compareDecimal(order.filledQuantity, payload.quantity) < 0))
    );
  } catch {
    return false;
  }
}

function exactTradesForAttempt(
  attempt: ExecutionAttemptV2,
  order: Order,
  trades: readonly Trade[],
  plan: ExecutionPlanV2,
): readonly Trade[] | null {
  try {
    if (trades.length === 0) return null;
    const tradeIds = new Set<string>();
    let filledQuantity = "0";
    let filledNotional = "0";
    for (const trade of trades) {
      if (
        !trade.tradeId ||
        trade.orderId !== order.orderId ||
        trade.clientOrderId !== attempt.clientOrderId ||
        trade.symbol !== attempt.exactRequestPayload.symbol ||
        trade.side !== attempt.exactRequestPayload.side ||
        compareDecimal(trade.price, "0") <= 0 ||
        compareDecimal(trade.quantity, "0") <= 0 ||
        compareDecimal(trade.fee, "0") < 0 ||
        !trade.feeAsset ||
        !Number.isFinite(new Date(trade.executedAt).getTime()) ||
        tradeIds.has(trade.tradeId)
      ) {
        return null;
      }
      if (
        compareDecimal(trade.price, plan.priceCollar.minimumPrice) < 0 ||
        compareDecimal(trade.price, plan.priceCollar.maximumPrice) > 0 ||
        (plan.limitPrice !== null &&
          plan.side === "buy" &&
          compareDecimal(trade.price, plan.limitPrice) > 0) ||
        (plan.limitPrice !== null &&
          plan.side === "sell" &&
          compareDecimal(trade.price, plan.limitPrice) < 0)
      ) {
        return null;
      }
      tradeIds.add(trade.tradeId);
      filledQuantity = addDecimal(filledQuantity, trade.quantity);
      filledNotional = addDecimal(
        filledNotional,
        multiplyExecutionNotionalConservativelyV2(trade.quantity, trade.price),
      );
    }
    if (
      compareDecimal(filledQuantity, order.filledQuantity) !== 0 ||
      compareDecimal(filledQuantity, attempt.exactRequestPayload.quantity) > 0 ||
      (order.status === "filled" &&
        compareDecimal(filledQuantity, attempt.exactRequestPayload.quantity) !== 0) ||
      (order.status === "partially_filled" &&
        compareDecimal(filledQuantity, attempt.exactRequestPayload.quantity) >= 0) ||
      (plan.action === "ENTER_LONG" &&
        compareDecimal(filledNotional, plan.approvedNotionalCeiling) > 0)
    ) {
      return null;
    }
    return Object.freeze([...trades]);
  } catch {
    return null;
  }
}

function rawConnectorError(error: unknown): Readonly<Record<string, unknown>> {
  const identity =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: "UnknownConnectorError", message: String(error) };
  if (typeof error === "object" && error !== null && "rawVenueObservation" in error) {
    const raw = error.rawVenueObservation;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      return Object.freeze({ error: identity, connector: Object.freeze({ ...raw }) });
    }
  }
  return Object.freeze({ error: identity });
}

async function appendReportsInTransaction(
  tx: ExecutionV2Transaction,
  context: OrgContext,
  executionAttemptId: string,
  reports: readonly ReportAppend[],
): Promise<ExecutionAttemptV2> {
  const initial = await readExecutionAttemptProjectionV2Postgres(
    tx,
    context,
    executionAttemptId,
    true,
  );
  if (!initial) throw new Error("Execution V2 attempt not found");
  const timeRows = await tx.execute<{ durable_at: Date | string }>(
    sql`select date_trunc('milliseconds', clock_timestamp()) as durable_at`,
  );
  const observedAtUtc = new Date(timeRows[0]!.durable_at).toISOString();
  for (const report of reports) {
    await appendExecutionReportV2FromExecutor(tx, context, {
      executionReportId: deterministicExecutionUuidV2("report", {
        executionAttemptContentDigestHex: initial.attempt.contentDigestHex,
        reportType: report.reportType,
        rawObservation: report.rawObservation,
      }),
      accountId: initial.attempt.accountId,
      executionAttemptId,
      ...report,
      observedAtUtc,
    });
  }
  return initial.attempt;
}

async function appendReports(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  reports: readonly ReportAppend[],
): Promise<ExecutionAttemptV2> {
  const scoped = requireOrgContext(context.organizationId);
  return runWaiaPostgresTransaction(db, (tx) =>
    appendReportsInTransaction(tx, scoped, executionAttemptId, reports),
  );
}

export async function markExecutionAttemptReconciliationRequiredV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  cause: string,
  rawObservation: Readonly<Record<string, unknown>> = {},
): Promise<ExecutionAttemptV2 | null> {
  const projection = await readExecutionAttemptProjectionV2Postgres(
    db,
    context,
    executionAttemptId,
  );
  if (!projection) return null;
  if (projection.lifecycleState === "RECONCILIATION_REQUIRED") return projection.attempt;
  if (
    !["BOUND", "SUBMIT_STARTED", "VENUE_ACCEPTED", "PARTIALLY_FILLED", "CANCEL_REQUESTED"].includes(
      projection.lifecycleState,
    )
  )
    return null;
  const recorded = await appendReports(db, context, executionAttemptId, [
    {
      reportType: "RECONCILIATION_REQUIRED",
      source: "EXECUTION",
      rawObservation: { cause, ...rawObservation },
      venueOrderId: null,
    },
  ]);
  emitUnresolvedExecutionAttemptV2({
    organizationId: context.organizationId,
    executionAttemptId,
    outcome: "RECONCILIATION_REQUIRED",
  });
  return recorded;
}

/** Submits once through the committed dispatcher, then stores only raw venue observations. */
export async function dispatchAndRecordExecutionAttemptV2(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  submit: ExecutionV2NetworkSubmitter<ExecutionV2VenueObservation>,
  afterSubmitStarted?: () => Promise<void>,
  onRefusedBeforePost?: (reason: string) => void,
): Promise<DispatchAndRecordExecutionV2Result> {
  const dispatched = await dispatchCommittedExecutionAttemptV2(
    db,
    context,
    executionAttemptId,
    submit,
    afterSubmitStarted,
    onRefusedBeforePost,
  );
  if (dispatched.status === "REFUSED_ALREADY_STARTED") {
    if (dispatched.lifecycleState === "SUBMIT_STARTED") {
      const recovered = await markExecutionAttemptReconciliationRequiredV2Postgres(
        db,
        context,
        executionAttemptId,
        "RESTART_AFTER_SUBMIT_STARTED",
      );
      return { status: "RECONCILIATION_REQUIRED", attempt: recovered };
    }
    return { status: "REFUSED_ALREADY_TERMINAL", attempt: null };
  }
  if (dispatched.status === "REFUSED_BEFORE_POST") {
    if (dispatched.reason === "PRE_POST_RECHECK_UNAVAILABLE") {
      const attempt = await markExecutionAttemptReconciliationRequiredV2Postgres(
        db,
        context,
        executionAttemptId,
        "PRE_POST_RECHECK_UNAVAILABLE",
        { postSent: false },
      );
      if (!attempt) {
        throw new Error("[trader] pre-POST unavailability could not be recorded");
      }
      return { status: "RECONCILIATION_REQUIRED", attempt };
    }
    const report = deterministicVenueRejectReport(dispatched.attempt, {
      postSent: false,
      reason: dispatched.reason,
    });
    const recorded = await appendReports(db, context, executionAttemptId, [
      {
        ...report,
        source: "EXECUTION",
        rawObservation: {
          ...report.rawObservation,
          postSent: false,
          reason: dispatched.reason,
        },
      },
    ]);
    return { status: "VENUE_REJECTED", attempt: recorded };
  }
  if (dispatched.status === "FAIL_UNKNOWN") {
    if (dispatched.error instanceof HtxPlacementRejectedError) {
      const recorded = await appendReports(db, context, executionAttemptId, [
        deterministicVenueRejectReport(dispatched.attempt, dispatched.error.rawVenueObservation),
      ]);
      return { status: "VENUE_REJECTED", attempt: recorded };
    }
    const error = rawConnectorError(dispatched.error);
    const attempt = await appendReports(db, context, executionAttemptId, [
      {
        reportType: "CONNECTOR_UNCERTAIN",
        source: "CONNECTOR",
        rawObservation: error,
        venueOrderId: null,
      },
      {
        reportType: "RECONCILIATION_REQUIRED",
        source: "EXECUTION",
        rawObservation: { cause: "NETWORK_RESULT_UNKNOWN" },
        venueOrderId: null,
      },
    ]);
    emitUnresolvedExecutionAttemptV2({
      organizationId: context.organizationId,
      executionAttemptId,
      outcome: "CONNECTOR_UNCERTAIN",
    });
    return { status: "RECONCILIATION_REQUIRED", attempt };
  }

  return recordObservedVenueResult(db, context, dispatched.attempt, dispatched.rawResult);
}

function deterministicVenueRejectReport(
  attempt: ExecutionAttemptV2,
  connector: Readonly<Record<string, unknown>>,
): ReportAppend {
  const payload = attempt.exactRequestPayload;
  return {
    reportType: "VENUE_REJECTED",
    source: "CONNECTOR",
    venueOrderId: null,
    rawObservation: {
      order: {
        orderCreated: false,
        orderId: null,
        venueOrderId: null,
        clientOrderId: attempt.clientOrderId,
        symbol: payload.symbol,
        side: payload.side,
        type: payload.type,
        status: "rejected",
        price: payload.price,
        quantity: payload.quantity,
        filledQuantity: "0",
      },
      connector,
    },
  };
}

async function recordObservedVenueResult(
  db: WaiaPostgresDb,
  context: OrgContext,
  attempt: ExecutionAttemptV2,
  rawResult: ExecutionV2VenueObservation,
): Promise<DispatchAndRecordExecutionV2Result> {
  const { order } = rawResult;
  const plan = await readExecutionPlanV2Postgres(db, context, attempt.executionPlanId);
  const mechanicsMatch = plan !== null && exactOrderMechanicsMatch(attempt, order);
  const observation = {
    connector: rawResult.raw,
    order: rawOrder(order),
    trades: rawResult.trades.map(rawTrade),
  };
  if (!mechanicsMatch) {
    const recovered = await appendReports(db, context, attempt.executionAttemptId, [
      {
        reportType: "VENUE_STATUS_OBSERVED",
        source: "CONNECTOR",
        rawObservation: observation,
        venueOrderId: order.orderId,
      },
      {
        reportType: "RECONCILIATION_REQUIRED",
        source: "EXECUTION",
        rawObservation: { cause: "VENUE_MECHANICS_MISMATCH" },
        venueOrderId: order.orderId,
      },
    ]);
    emitUnresolvedExecutionAttemptV2({
      organizationId: context.organizationId,
      executionAttemptId: attempt.executionAttemptId,
      outcome: "RECONCILIATION_REQUIRED",
    });
    return { status: "RECONCILIATION_REQUIRED", attempt: recovered };
  }

  if (order.status === "rejected") {
    const recorded = await appendReports(db, context, attempt.executionAttemptId, [
      {
        reportType: "VENUE_REJECTED",
        source: "CONNECTOR",
        rawObservation: observation,
        venueOrderId: order.orderId,
      },
    ]);
    return { status: "VENUE_REJECTED", attempt: recorded };
  }
  if (order.status === "open") {
    const recorded = await appendReports(db, context, attempt.executionAttemptId, [
      {
        reportType: "VENUE_ACCEPTED",
        source: "CONNECTOR",
        rawObservation: observation,
        venueOrderId: order.orderId,
      },
    ]);
    return { status: "VENUE_ACCEPTED", attempt: recorded };
  }
  const exactTrades = exactTradesForAttempt(attempt, order, rawResult.trades, plan!);
  if ((order.status === "filled" || order.status === "partially_filled") && exactTrades) {
    const lifecycleState = order.status === "filled" ? "FILLED" : "PARTIALLY_FILLED";
    const recorded = await appendReports(db, context, attempt.executionAttemptId, [
      {
        reportType: "FILL_REPORT_OBSERVED",
        source: "CONNECTOR",
        rawObservation: { ...observation, trades: exactTrades.map(rawTrade) },
        venueOrderId: order.orderId,
      },
    ]);
    return { status: lifecycleState, attempt: recorded };
  }
  const recovered = await appendReports(db, context, attempt.executionAttemptId, [
    {
      reportType: "VENUE_STATUS_OBSERVED",
      source: "CONNECTOR",
      rawObservation: observation,
      venueOrderId: order.orderId,
    },
    {
      reportType: "RECONCILIATION_REQUIRED",
      source: "EXECUTION",
      rawObservation: { cause: "STATUS_WITHOUT_EXACT_TRADE_OR_CANCEL_AUTHORITY" },
      venueOrderId: order.orderId,
    },
  ]);
  return { status: "RECONCILIATION_REQUIRED", attempt: recovered };
}

export type ExecutionV2ReconciliationLookup =
  | Readonly<{ status: "FOUND"; observation: ExecutionV2VenueObservation }>
  | Readonly<{ status: "ABSENT" }>
  | Readonly<{ status: "UNKNOWN" }>;

/**
 * Reduces RECONCILIATION_REQUIRED. UNKNOWN stays and keeps the reserve.
 * A caller-supplied ABSENT does not release the reserve. Release happens only
 * after `readVenueOrder` — this function's own exchange read — also returns
 * ABSENT. FOUND uses the same mechanics match as a confirmed acknowledgement.
 */
export async function resolveReconciliationRequiredV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  lookup: () => Promise<ExecutionV2ReconciliationLookup>,
  readVenueOrder?: (attempt: ExecutionAttemptV2) => Promise<ExecutionV2ReconciliationLookup>,
): Promise<DispatchAndRecordExecutionV2Result> {
  const projection = await readExecutionAttemptProjectionV2Postgres(
    db,
    context,
    executionAttemptId,
  );
  if (!projection) throw new Error("Execution V2 attempt not found");
  if (projection.lifecycleState !== "RECONCILIATION_REQUIRED") {
    return { status: "REFUSED_ALREADY_TERMINAL", attempt: projection.attempt };
  }
  const lookedUp = await lookup();
  if (lookedUp.status === "UNKNOWN") {
    return { status: "RECONCILIATION_REQUIRED", attempt: projection.attempt };
  }
  if (lookedUp.status === "FOUND") {
    return recordObservedVenueResult(db, context, projection.attempt, lookedUp.observation);
  }
  if (!readVenueOrder) {
    return { status: "RECONCILIATION_REQUIRED", attempt: projection.attempt };
  }
  let ownRead: ExecutionV2ReconciliationLookup;
  try {
    ownRead = await readVenueOrder(projection.attempt);
  } catch {
    return { status: "RECONCILIATION_REQUIRED", attempt: projection.attempt };
  }
  if (ownRead.status === "FOUND") {
    return recordObservedVenueResult(db, context, projection.attempt, ownRead.observation);
  }
  if (ownRead.status !== "ABSENT") {
    return { status: "RECONCILIATION_REQUIRED", attempt: projection.attempt };
  }
  const recorded = await appendReports(db, context, executionAttemptId, [
    deterministicVenueRejectReport(projection.attempt, { lookup: "ABSENT", venueRead: "ABSENT" }),
  ]);
  return { status: "VENUE_REJECTED", attempt: recorded };
}

export async function requestProtectiveCancelV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  reason: string,
): Promise<ExecutionAttemptV2> {
  return appendReports(db, context, executionAttemptId, [
    {
      reportType: "CANCEL_REQUESTED",
      source: "EXECUTION",
      rawObservation: { reason, replacementAuthorized: false },
      venueOrderId: null,
    },
  ]);
}

export async function recordProtectiveCancelAcknowledgementV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  order: Order,
): Promise<ExecutionAttemptV2> {
  const scoped = requireOrgContext(context.organizationId);
  return runWaiaPostgresTransaction(db, async (tx) => {
    const projection = await readExecutionAttemptProjectionV2Postgres(
      tx,
      scoped,
      executionAttemptId,
      true,
    );
    if (!projection) throw new Error("Execution V2 attempt not found for cancel acknowledgement");
    const reports = await listExecutionReportsV2Postgres(tx, scoped, executionAttemptId);
    const observedVenueOrderIds = new Set(
      reports.flatMap((report) => (report.venueOrderId === null ? [] : [report.venueOrderId])),
    );
    const lastFillReport = [...reports]
      .reverse()
      .find((report) => report.reportType === "FILL_REPORT_OBSERVED");
    const lastFillOrder = lastFillReport?.rawObservation.order;
    const previouslyObservedFilledQuantity =
      typeof lastFillOrder === "object" &&
      lastFillOrder !== null &&
      "filledQuantity" in lastFillOrder &&
      typeof lastFillOrder.filledQuantity === "string"
        ? lastFillOrder.filledQuantity
        : "0";
    const rawObservation = {
      order: rawOrder(order),
      ...(order.rawVenueObservation === undefined ? {} : { connector: order.rawVenueObservation }),
      replacementAuthorized: false,
    };
    let mismatchCause: string | null = null;
    if (order.status !== "canceled") {
      mismatchCause = "CANCEL_STATUS_MISMATCH";
    } else if (!exactOrderMechanicsMatch(projection.attempt, order)) {
      mismatchCause = "CANCEL_MECHANICS_MISMATCH";
    } else if (compareDecimal(order.filledQuantity, previouslyObservedFilledQuantity) !== 0) {
      mismatchCause = "CANCEL_FILL_TOTAL_MISMATCH";
    } else if (observedVenueOrderIds.size !== 1 || !observedVenueOrderIds.has(order.orderId)) {
      mismatchCause = "CANCEL_VENUE_ORDER_IDENTITY_MISMATCH";
    }
    const nextReports: readonly ReportAppend[] =
      mismatchCause === null
        ? [
            {
              reportType: "CANCEL_ACKNOWLEDGED",
              source: "CONNECTOR",
              rawObservation,
              venueOrderId: order.orderId,
            },
          ]
        : [
            {
              reportType: "VENUE_STATUS_OBSERVED",
              source: "CONNECTOR",
              rawObservation,
              venueOrderId: order.orderId || null,
            },
            {
              reportType: "RECONCILIATION_REQUIRED",
              source: "EXECUTION",
              rawObservation: { cause: mismatchCause },
              venueOrderId: order.orderId || null,
            },
          ];
    return appendReportsInTransaction(tx, scoped, executionAttemptId, nextReports);
  });
}
