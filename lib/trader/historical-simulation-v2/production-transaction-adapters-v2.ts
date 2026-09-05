import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import {
  createAccountingFrontierRepositoryPostgres,
  type AccountingFrontierRepository,
} from "@/lib/trader/accounting/accounting-frontier-repository-postgres";
import { createPostgresOrderRepositoryFromExecutor } from "@/lib/trader/execution/repository-adapters";
import type { OrderRepository, OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { RecordFillProgressInput } from "@/lib/trader/execution/order-repository.types";
import {
  applyHistoricalExecutionEconomics,
  buildRecordFillPayload,
  type HistoricalExecutionPersistencePort,
} from "@/lib/trader/execution/historical-simulated-exchange";
import type { HistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model.types";
import { addDecimal, compareDecimal, divideDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";
import {
  createHistoricalModeledOrderFromReceiptV2,
  type HistoricalModeledExecutionReceiptV2,
} from "./modeled-capital-binding-v2";

export type HistoricalSimulationProductionTransactionRepositoriesV2 = Readonly<{
  accounting: AccountingFrontierRepository;
  orders: OrderRepository;
}>;

/** Canonical order/fill mutations for modeled execution; accepts no connector or Reality port. */
export function createHistoricalSimulationExecutionPersistenceV2(input: Readonly<{
  orders: OrderRepository;
  model: HistoricalExecutionModelV1;
}>): HistoricalExecutionPersistencePort {
  const transition = async (context: Parameters<OrderRepository["transitionOrder"]>[0],
    order: Parameters<HistoricalExecutionPersistencePort["transitionOrderExpired"]>[1],
    toState: "EXPIRED" | "CANCEL_REQUESTED" | "CANCELLED",
  ) => input.orders.transitionOrder(context, { orderId: order.id,
    expectedStateVersion: order.stateVersion, toState });
  return Object.freeze({
    async recordSimulatedFill(context, order, event, isFirstSlice) {
      const economics = applyHistoricalExecutionEconomics(event, input.model);
      const filledQuantity = addDecimal(order.filledQuantity, event.sliceQuantity);
      const avgFillPrice = compareDecimal(order.filledQuantity, "0") === 0
        ? economics.netFillPrice : divideDecimal(addDecimal(
          multiplyDecimal(order.avgFillPrice ?? "0", order.filledQuantity),
          multiplyDecimal(economics.netFillPrice, event.sliceQuantity)), filledQuantity);
      const payload = buildRecordFillPayload(event, economics, context.organizationId, order.id,
        order.side, avgFillPrice, filledQuantity, !isFirstSlice);
      if (isFirstSlice) {
        const updated = await input.orders.transitionOrder(context, { orderId: order.id,
          expectedStateVersion: order.stateVersion,
          toState: compareDecimal(event.remainingQuantityAfter, "0") === 0 ? "FILLED" : "PARTIALLY_FILLED",
          filledQuantity, avgFillPrice });
        await input.orders.recordFill(context, payload);
        return updated;
      }
      await input.orders.recordFillProgress(context, payload as RecordFillProgressInput);
      const updated = await input.orders.getOrderById(context, order.id);
      if (!updated) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:ORDER_DISAPPEARED");
      if (compareDecimal(event.remainingQuantityAfter, "0") !== 0) return updated;
      return input.orders.transitionOrder(context, { orderId: updated.id,
        expectedStateVersion: updated.stateVersion, toState: "FILLED",
        filledQuantity, avgFillPrice });
    },
    transitionOrderExpired: (context, order) => transition(context, order, "EXPIRED"),
    async transitionOrderCancelled(context, order) {
      if (order.state === "CANCELLED") return order;
      const requested = order.state === "CANCEL_REQUESTED" ? order :
        await transition(context, order, "CANCEL_REQUESTED");
      return transition(context, requested, "CANCELLED");
    },
    transitionOrderCancelledFromRequested(context, order) {
      if (order.state !== "CANCEL_REQUESTED") {
        throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:CANCEL_STATE");
      }
      return transition(context, order, "CANCELLED");
    },
  });
}

/** Persists the exact modeled submission before it is registered with the in-memory exchange. */
export async function persistHistoricalModeledExecutionSubmissionV2(input: Readonly<{
  context: Parameters<OrderRepository["createOrder"]>[0];
  orders: OrderRepository;
  organizationId: string;
  accountId: string;
  runId: string;
  decisionId: string;
  riskAllowanceId: string;
  receipt: HistoricalModeledExecutionReceiptV2;
}>): Promise<OrderRow> {
  if (input.context.organizationId !== input.organizationId ||
      input.receipt.decisionId !== input.decisionId) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:ORDER_SUBMISSION_SCOPE");
  }
  const expected = createHistoricalModeledOrderFromReceiptV2({ organizationId: input.organizationId,
    accountId: input.accountId, runId: input.runId, decisionId: input.decisionId, allowanceId: input.riskAllowanceId,
    receipt: input.receipt });
  const persisted = await input.orders.createOrder(input.context, { id: expected.id, venue: expected.venue,
    executionMode: expected.executionMode, symbol: expected.symbol, side: expected.side, type: expected.type,
    historicalRunId: expected.historicalRunId, historicalAccountKey: expected.historicalAccountKey,
    price: expected.price, quantity: expected.quantity, clientOrderId: expected.clientOrderId,
    idempotencyKey: expected.idempotencyKey, riskDecisionId: expected.riskDecisionId,
    // Modeled risk is deliberately not canonical Risk V2. Never attach its
    // allowance identity to the FK reserved for canonical risk allowances.
    riskAllowanceId: null, riskAllowanceBindingDigest: null,
    strategySignalId: expected.strategySignalId, allocationDecisionId: expected.allocationDecisionId,
    credentialId: null });
  const identity = ["id", "organizationId", "venue", "executionMode", "historicalRunId", "historicalAccountKey", "symbol", "side", "type", "price",
    "quantity", "clientOrderId", "idempotencyKey", "riskDecisionId", "allocationDecisionId"] as const;
  if (identity.some((key) => persisted[key] !== expected[key]) || persisted.credentialId !== null ||
      persisted.riskAllowanceId !== null || persisted.riskAllowanceBindingDigest !== null) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:ORDER_SUBMISSION_PARITY");
  }
  const riskApproved = await input.orders.transitionOrder(input.context, { orderId: persisted.id,
    expectedStateVersion: persisted.stateVersion, toState: "RISK_APPROVED" });
  const sent = await input.orders.transitionOrder(input.context, { orderId: riskApproved.id,
    expectedStateVersion: riskApproved.stateVersion, toState: "SENT_TO_EXCHANGE" });
  return input.orders.transitionOrder(input.context, { orderId: sent.id,
    expectedStateVersion: sent.stateVersion, toState: "ACCEPTED" });
}

/**
 * Binds canonical repositories to the already-reserved postgres.js transaction used by the
 * historical atomic cycle. It deliberately does not create a client or transaction: doing so
 * would let modeled fills/accounting escape the 0188 cycle rollback boundary.
 */
export function createHistoricalSimulationProductionTransactionRepositoriesV2(
  tx: postgres.Sql,
): HistoricalSimulationProductionTransactionRepositoriesV2 {
  if (typeof tx !== "function") {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:TRANSACTION_HANDLE");
  }
  const executor = drizzle(tx, { schema: pgSchema });
  return Object.freeze({
    accounting: createAccountingFrontierRepositoryPostgres(executor),
    orders: createPostgresOrderRepositoryFromExecutor(executor),
  });
}
