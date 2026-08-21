import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { sql } from "drizzle-orm";

import {
  runWaiaPostgresTransaction,
  type WaiaPostgresDb,
} from "@/db/waia-postgres-transaction";
import type { Order, Trade } from "@/lib/trader/connectors/types";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  dispatchCommittedExecutionAttemptV2,
  type ExecutionV2NetworkSubmitter,
} from "./authority-postgres";
import { deterministicExecutionUuidV2, type ExecutionAttemptV2 } from "./contracts";
import {
  appendExecutionReportV2FromExecutor,
  readExecutionAttemptProjectionV2Postgres,
  type ExecutionAttemptLifecycleStateV2,
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
  lifecycleState: ExecutionAttemptLifecycleStateV2;
}>;

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

function exactTradesForAttempt(
  attempt: ExecutionAttemptV2,
  order: Order,
  trades: readonly Trade[],
): readonly Trade[] | null {
  try {
    if (trades.length === 0) return null;
    for (const trade of trades) {
      if (!trade.tradeId || trade.orderId !== order.orderId ||
        trade.clientOrderId !== attempt.clientOrderId || trade.symbol !== attempt.exactRequestPayload.symbol ||
        trade.side !== attempt.exactRequestPayload.side || compareDecimal(trade.price, "0") <= 0 ||
        compareDecimal(trade.quantity, "0") <= 0 || compareDecimal(trade.fee, "0") < 0 ||
        !trade.feeAsset || !Number.isFinite(new Date(trade.executedAt).getTime())) {
        return null;
      }
    }
    return Object.freeze([...trades]);
  } catch {
    return null;
  }
}

async function appendReports(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  reports: readonly ReportAppend[],
): Promise<ExecutionAttemptV2> {
  const scoped = requireOrgContext(context.organizationId);
  return runWaiaPostgresTransaction(db, async (tx) => {
    const initial = await readExecutionAttemptProjectionV2Postgres(
      tx,
      scoped,
      executionAttemptId,
      true,
    );
    if (!initial) throw new Error("Execution V2 attempt not found");
    const timeRows = await tx.execute<{ durable_at: Date | string }>(
      sql`select date_trunc('milliseconds', transaction_timestamp()) as durable_at`,
    );
    const observedAtUtc = new Date(timeRows[0]!.durable_at).toISOString();
    for (const report of reports) {
      await appendExecutionReportV2FromExecutor(tx, scoped, {
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
  });
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
  if (!["BOUND", "SUBMIT_STARTED", "VENUE_ACCEPTED", "PARTIALLY_FILLED", "CANCEL_REQUESTED"]
    .includes(projection.lifecycleState)) return null;
  return appendReports(db, context, executionAttemptId, [{
    reportType: "RECONCILIATION_REQUIRED",
    source: "EXECUTION",
    rawObservation: { cause, ...rawObservation },
    venueOrderId: null,
    lifecycleState: "RECONCILIATION_REQUIRED",
  }]);
}

/** Submits once through the committed dispatcher, then stores only raw venue observations. */
export async function dispatchAndRecordExecutionAttemptV2(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  submit: ExecutionV2NetworkSubmitter<ExecutionV2VenueObservation>,
): Promise<DispatchAndRecordExecutionV2Result> {
  const dispatched = await dispatchCommittedExecutionAttemptV2(db, context, executionAttemptId, submit);
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
  if (dispatched.status === "FAIL_UNKNOWN") {
    const error = dispatched.error instanceof Error
      ? { name: dispatched.error.name, message: dispatched.error.message }
      : { name: "UnknownConnectorError", message: String(dispatched.error) };
    const attempt = await appendReports(db, context, executionAttemptId, [
      {
        reportType: "CONNECTOR_UNCERTAIN",
        source: "CONNECTOR",
        rawObservation: { error },
        venueOrderId: null,
        lifecycleState: "RECONCILIATION_REQUIRED",
      },
      {
        reportType: "RECONCILIATION_REQUIRED",
        source: "EXECUTION",
        rawObservation: { cause: "NETWORK_RESULT_UNKNOWN" },
        venueOrderId: null,
        lifecycleState: "RECONCILIATION_REQUIRED",
      },
    ]);
    return { status: "RECONCILIATION_REQUIRED", attempt };
  }

  const { attempt, rawResult } = dispatched;
  const { order } = rawResult;
  const mechanicsMatch = order.clientOrderId === attempt.clientOrderId &&
    order.symbol === attempt.exactRequestPayload.symbol &&
    order.side === attempt.exactRequestPayload.side &&
    order.type === attempt.exactRequestPayload.type;
  const observation = { connector: rawResult.raw, order: rawOrder(order) };
  if (!mechanicsMatch) {
    const recovered = await appendReports(db, context, executionAttemptId, [
      {
        reportType: "VENUE_STATUS_OBSERVED",
        source: "CONNECTOR",
        rawObservation: observation,
        venueOrderId: order.orderId,
        lifecycleState: "RECONCILIATION_REQUIRED",
      },
      {
        reportType: "RECONCILIATION_REQUIRED",
        source: "EXECUTION",
        rawObservation: { cause: "VENUE_MECHANICS_MISMATCH" },
        venueOrderId: order.orderId,
        lifecycleState: "RECONCILIATION_REQUIRED",
      },
    ]);
    return { status: "RECONCILIATION_REQUIRED", attempt: recovered };
  }

  if (order.status === "rejected") {
    const recorded = await appendReports(db, context, executionAttemptId, [{
      reportType: "VENUE_REJECTED",
      source: "CONNECTOR",
      rawObservation: observation,
      venueOrderId: order.orderId,
      lifecycleState: "VENUE_REJECTED",
    }]);
    return { status: "VENUE_REJECTED", attempt: recorded };
  }
  if (order.status === "open") {
    const recorded = await appendReports(db, context, executionAttemptId, [{
      reportType: "VENUE_ACCEPTED",
      source: "CONNECTOR",
      rawObservation: observation,
      venueOrderId: order.orderId,
      lifecycleState: "VENUE_ACCEPTED",
    }]);
    return { status: "VENUE_ACCEPTED", attempt: recorded };
  }
  const exactTrades = exactTradesForAttempt(attempt, order, rawResult.trades);
  if ((order.status === "filled" || order.status === "partially_filled") && exactTrades) {
    const lifecycleState = order.status === "filled" ? "FILLED" : "PARTIALLY_FILLED";
    const recorded = await appendReports(db, context, executionAttemptId, [{
      reportType: "FILL_REPORT_OBSERVED",
      source: "CONNECTOR",
      rawObservation: { ...observation, trades: exactTrades.map(rawTrade) },
      venueOrderId: order.orderId,
      lifecycleState,
    }]);
    return { status: lifecycleState, attempt: recorded };
  }
  const recovered = await appendReports(db, context, executionAttemptId, [
    {
      reportType: "VENUE_STATUS_OBSERVED",
      source: "CONNECTOR",
      rawObservation: observation,
      venueOrderId: order.orderId,
      lifecycleState: "RECONCILIATION_REQUIRED",
    },
    {
      reportType: "RECONCILIATION_REQUIRED",
      source: "EXECUTION",
      rawObservation: { cause: "STATUS_WITHOUT_EXACT_TRADE_OR_CANCEL_AUTHORITY" },
      venueOrderId: order.orderId,
      lifecycleState: "RECONCILIATION_REQUIRED",
    },
  ]);
  return { status: "RECONCILIATION_REQUIRED", attempt: recovered };
}

export async function requestProtectiveCancelV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  reason: string,
): Promise<ExecutionAttemptV2> {
  return appendReports(db, context, executionAttemptId, [{
    reportType: "CANCEL_REQUESTED",
    source: "EXECUTION",
    rawObservation: { reason, replacementAuthorized: false },
    venueOrderId: null,
    lifecycleState: "CANCEL_REQUESTED",
  }]);
}

export async function recordProtectiveCancelAcknowledgementV2Postgres(
  db: WaiaPostgresDb,
  context: OrgContext,
  executionAttemptId: string,
  order: Order,
): Promise<ExecutionAttemptV2> {
  if (order.status !== "canceled") throw new Error("cancel acknowledgement must be raw canceled status");
  return appendReports(db, context, executionAttemptId, [{
    reportType: "CANCEL_ACKNOWLEDGED",
    source: "CONNECTOR",
    rawObservation: { order: rawOrder(order), replacementAuthorized: false },
    venueOrderId: order.orderId,
    lifecycleState: "CANCELLED",
  }]);
}
