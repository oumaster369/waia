import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import type { Order, PlaceOrderInput, Trade } from "@/lib/trader/connectors/types";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { mapConnectorStatusToOrderState } from "@/lib/trader/execution/connector-status-map";
import {
  LiveExecutionNotSupportedError,
  UnsupportedExecutionModeError,
} from "@/lib/trader/execution/execution-service.errors";
import type {
  OrderExecutionService,
  OrderExecutionServiceDeps,
  SubmissionAuditIds,
  SubmitOrderInput,
  SubmitOrderResult,
} from "@/lib/trader/execution/execution-service.types";
import { normalizeSymbolForHistoricalExecution } from "@/lib/trader/backtest/historical-execution-profile";
import {
  OrderVersionConflictError,
  OrderNotFoundError,
} from "@/lib/trader/execution/order-repository.errors";
import type {
  OrderRow,
  RecordFillProgressInput,
} from "@/lib/trader/execution/order-repository.types";
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import { buildRecordFillPayload } from "@/lib/trader/execution/historical-simulated-exchange";
import type { SimulatedFillEvent } from "@/lib/trader/execution/historical-execution-model.types";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
} from "@/lib/trader/risk/numeric";
import { isTerminal } from "@/lib/trader/execution/order-state-machine";
import type { OrderExecutionMode, OrderState } from "@/lib/trader/execution/types";
import {
  emitExecutionTerminalEvent,
  emitExecutionTransitionEvent,
} from "@/lib/trader/execution/execution-telemetry";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { BreachOrderCancelOutcome } from "@/lib/trader/guardian/htr-breach-partial-entry-cancellation";
import { isTerminalReject } from "@/lib/trader/risk/decision";
import type { RiskEngineDecision } from "@/lib/trader/risk/evaluate.types";
import {
  createPostgresRiskEngineService,
  createSqliteRiskEngineService,
} from "@/lib/trader/risk/risk-engine-service";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  createPostgresOrderRepository,
  createPostgresOrderRepositoryFromExecutor,
  createSqliteOrderRepository,
} from "@/lib/trader/execution/repository-adapters";
import type { TradeLineageAtOpen } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import {
  createKillSwitchResolver,
  createPostgresKillSwitchRepository,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import {
  consumeRiskAllowanceForOrderV2Postgres,
  RiskV2AdmissionRefusedError,
  type ConsumedRiskAllowanceForOrderV2,
  type ConsumeRiskAllowanceForOrderV2Result,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";

type PgExecutionExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

const KILL_SWITCH_REJECT_PAYLOAD = JSON.stringify({ reason: "kill_switch" });
const CONNECTOR_REJECT_PAYLOAD = JSON.stringify({ reason: "connector" });
const BREACH_CANCEL_PAYLOAD = JSON.stringify({ reason: "guardian_breach_partial_entry" });

const BREACH_CANCELLABLE_STATES = new Set<OrderState>([
  "SENT_TO_EXCHANGE",
  "ACCEPTED",
  "PARTIALLY_FILLED",
]);

/** Dispatch allowed only from RISK_APPROVED (DEE-249). */
export function canDispatch(order: OrderRow): boolean {
  return order.state === "RISK_APPROVED";
}

function venueForMode(executionMode: OrderExecutionMode): string {
  if (executionMode === "mock" || executionMode === "paper") {
    return "mock";
  }
  if (executionMode === "live") {
    return "htx";
  }
  return executionMode;
}

function placeOrderInputFromSubmit(
  input: SubmitOrderInput,
  clientOrderId: string,
): PlaceOrderInput {
  return {
    clientOrderId,
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    price: input.price,
    quantity: input.quantity,
  };
}

function placeOrderInputFromOrder(order: OrderRow): PlaceOrderInput {
  return {
    clientOrderId: order.clientOrderId,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    price: order.price ?? undefined,
    quantity: order.quantity,
  };
}

function legacyOrderSubmissionDisabled(): boolean {
  return true;
}

async function refuseLegacyConnectorSubmission(input?: unknown): Promise<never> {
  void input;
  throw new Error("LEGACY_ORDER_SUBMISSION_DISABLED: Execution V2 authority is required");
}

function hasExactConsumedRiskV2Proof(
  context: OrgContext,
  input: SubmitOrderInput,
  consumed: ConsumedRiskAllowanceForOrderV2 | undefined,
): boolean {
  const requested = input.riskAllowanceV2;
  if (!requested || !consumed) return false;
  const order = consumed.order;
  try {
    const priceMatches =
      (order.price === null && input.price === undefined) ||
      (order.price !== null && input.price !== undefined && compareDecimal(order.price, input.price) === 0);
    return (
      consumed.riskAllowanceId === requested.riskAllowanceId &&
      order.id === requested.orderId &&
      order.organizationId === context.organizationId &&
      order.riskAllowanceId === requested.riskAllowanceId &&
      order.riskAllowanceBindingDigest === consumed.orderBindingDigestHex &&
      order.executionMode === input.executionMode &&
      order.symbol === input.symbol &&
      order.side === input.side &&
      order.type === input.type &&
      priceMatches &&
      compareDecimal(order.quantity, input.quantity) === 0 &&
      order.clientOrderId === input.clientOrderId &&
      order.idempotencyKey === input.idempotencyKey &&
      order.credentialId === (input.credentialId ?? null) &&
      order.strategySignalId === (input.strategySignalId ?? null) &&
      order.allocationDecisionId === (input.allocationDecisionId ?? null)
    );
  } catch {
    return false;
  }
}

function isSubmittedState(state: OrderState): boolean {
  return state === "ACCEPTED" || state === "PARTIALLY_FILLED" || state === "FILLED";
}

function resumeResultForExistingOrder(order: OrderRow): SubmitOrderResult | null {
  if (order.state === "SENT_TO_EXCHANGE" && !order.exchangeOrderId) {
    return { status: "connector_uncertain", order };
  }

  if (order.state === "RECONCILIATION_REQUIRED") {
    return { status: "connector_uncertain", order };
  }

  if (isSubmittedState(order.state)) {
    return { status: "submitted", order };
  }

  if (isTerminal(order.state)) {
    return { status: "submitted", order };
  }

  if (order.state === "CANCEL_REQUESTED") {
    return { status: "submitted", order };
  }

  return null;
}

async function writeOrderAudit(
  writeAudit: OrderExecutionServiceDeps["writeAudit"],
  context: OrgContext,
  orderId: string,
  action: TraderAuditInput["action"],
  metadata?: Record<string, unknown>,
  actor?: Pick<SubmitOrderInput, "actorType" | "actorId">,
): Promise<string> {
  return await writeAudit({
    actorType: actor?.actorType ?? "service",
    actorId: actor?.actorId ?? null,
    action,
    entityType: traderEntityTypes.order,
    entityId: orderId,
    organizationId: context.organizationId,
    metadata,
  });
}

function lazyValidatedMockConnector(inner: MockExchangeConnector): ExchangeConnector {
  let validated = false;

  async function ensureValidated(): Promise<void> {
    if (!validated) {
      await inner.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
      validated = true;
    }
  }

  return {
    venueId: inner.venueId,
    marketType: inner.marketType,
    validateCredentials: (input) => inner.validateCredentials(input),
    getAccountInfo: async () => {
      await ensureValidated();
      return inner.getAccountInfo();
    },
    getBalances: async () => {
      await ensureValidated();
      return inner.getBalances();
    },
    getPositions: async () => {
      await ensureValidated();
      return inner.getPositions();
    },
    getOpenOrders: async (filter) => {
      await ensureValidated();
      return inner.getOpenOrders(filter);
    },
    getOrder: async (orderId) => {
      await ensureValidated();
      return inner.getOrder(orderId);
    },
    placeOrder: refuseLegacyConnectorSubmission,
    cancelOrder: async (orderId) => {
      await ensureValidated();
      return inner.cancelOrder(orderId);
    },
    getTradeHistory: async (filter) => {
      await ensureValidated();
      return inner.getTradeHistory(filter);
    },
    streamMarketData: (symbols) => inner.streamMarketData(symbols),
    streamUserData: () => inner.streamUserData(),
    getFuturesBalances: () => inner.getFuturesBalances(),
    getFuturesPositions: () => inner.getFuturesPositions(),
    placeFuturesOrder: refuseLegacyConnectorSubmission,
  };
}

export function createDefaultConnectorForMode(): OrderExecutionServiceDeps["connectorForMode"] {
  const connectors = new Map<OrderExecutionMode, ExchangeConnector>();

  return (executionMode) => {
    if (executionMode !== "mock" && executionMode !== "paper") {
      throw new UnsupportedExecutionModeError(executionMode);
    }

    const cached = connectors.get(executionMode);
    if (cached) {
      return cached;
    }

    const connector = lazyValidatedMockConnector(new MockExchangeConnector());
    connectors.set(executionMode, connector);
    return connector;
  };
}

function createOrderExecutionService(deps: OrderExecutionServiceDeps): OrderExecutionService {
  const {
    riskEngine,
    orderRepository,
    killSwitchResolver,
    connectorForMode,
    writeAudit,
    nowMs,
    executionTelemetrySink: telemetrySink,
    assertLiveAuthorized,
    lifecycleRecorder,
    historicalExecution,
    consumeRiskAllowanceV2,
  } = deps;

  function buildTradeLineageFromSubmit(
    order: OrderRow,
    input: SubmitOrderInput,
  ): TradeLineageAtOpen {
    return {
      strategySignalId: order.strategySignalId ?? input.strategySignalId ?? "",
      strategyId: input.strategyId ?? "unknown",
      strategyVersion: input.strategyVersion ?? "0.0.0",
      riskDecisionId: order.riskDecisionId,
      allocationDecisionId: order.allocationDecisionId ?? input.allocationDecisionId ?? null,
      signalConfidence: input.signalConfidence ?? null,
      openingRegime: input.openingRegime ?? null,
      openingMsvId: input.openingMsvId ?? null,
      openingFeatureSetId: input.openingFeatureSetId ?? null,
    };
  }

  async function recordLifecycleForFill(
    context: OrgContext,
    order: OrderRow,
    input: SubmitOrderInput,
    fillId: string,
  ): Promise<void> {
    if (!lifecycleRecorder) {
      return;
    }

    const fills = await orderRepository.listFills(context, order.id);
    const fill = fills.find((entry) => entry.id === fillId);
    if (!fill) {
      return;
    }

    await lifecycleRecorder.recordFillLifecycle({
      context,
      order,
      fill,
      accountKey: input.accountKey,
      lineage: buildTradeLineageFromSubmit(order, input),
    });
  }

  async function authorizeLivePath(
    orgContext: OrgContext,
    input: SubmitOrderInput,
    riskDecision?: RiskEngineDecision,
  ): Promise<void> {
    if (input.executionMode !== "live") {
      return;
    }
    if (!assertLiveAuthorized) {
      throw new LiveExecutionNotSupportedError("live");
    }
    await assertLiveAuthorized(orgContext, input, { riskDecision });
  }

  function finishSubmitOrder(
    orgContext: OrgContext,
    input: SubmitOrderInput,
    startedMs: number,
    result: SubmitOrderResult,
  ): SubmitOrderResult {
    emitExecutionTerminalEvent(
      {
        organizationId: orgContext.organizationId,
        executionMode: input.executionMode,
        result,
        durationMs: Math.max(0, nowMs() - startedMs),
      },
      telemetrySink,
    );
    return result;
  }

  async function transitionOrConflict(
    context: OrgContext,
    order: OrderRow,
    toState: OrderState,
    extras?: {
      filledQuantity?: string;
      avgFillPrice?: string | null;
      exchangeOrderId?: string | null;
      eventPayload?: string | null;
    },
  ): Promise<{ order: OrderRow } | { conflict: true; orderId: string }> {
    try {
      const updated = await orderRepository.transitionOrder(context, {
        orderId: order.id,
        expectedStateVersion: order.stateVersion,
        toState,
        filledQuantity: extras?.filledQuantity,
        avgFillPrice: extras?.avgFillPrice,
        exchangeOrderId: extras?.exchangeOrderId,
        eventPayload: extras?.eventPayload,
        occurredAt: new Date(nowMs()),
      });
      emitExecutionTransitionEvent(
        {
          organizationId: context.organizationId,
          fromState: order.state,
          toState,
          executionMode: order.executionMode,
        },
        telemetrySink,
      );
      return { order: updated };
    } catch (error) {
      if (error instanceof OrderVersionConflictError) {
        return { conflict: true, orderId: order.id };
      }
      throw error;
    }
  }

  async function ensureRiskApproved(
    context: OrgContext,
    order: OrderRow,
  ): Promise<{ order: OrderRow } | { conflict: true; orderId: string }> {
    if (order.state === "RISK_APPROVED") {
      return { order };
    }

    if (order.state !== "CREATED") {
      return { order };
    }

    return transitionOrConflict(context, order, "RISK_APPROVED");
  }

  async function isKillSwitchBlocked(context: OrgContext): Promise<boolean> {
    const effective = await killSwitchResolver.getEffectiveState(context);
    if (effective.resolutionStatus === "fail_closed") {
      return true;
    }
    return effective.blocked;
  }

  async function resolveTradeForOrder(
    connector: ExchangeConnector,
    order: OrderRow,
    connectorOrder: Order,
  ): Promise<Trade | null> {
    const trades = await connector.getTradeHistory({ symbol: order.symbol, limit: 50 });
    const byClient = trades.find((trade) => trade.clientOrderId === order.clientOrderId);
    if (byClient) {
      return byClient;
    }

    const byOrder = trades.find((trade) => trade.orderId === connectorOrder.orderId);
    if (byOrder) {
      return byOrder;
    }

    return null;
  }

  async function dispatchToConnector(
    context: OrgContext,
    order: OrderRow,
    input: SubmitOrderInput,
    riskDecision?: RiskEngineDecision,
    auditIds: SubmissionAuditIds = {},
    consumedAllowance?: ConsumedRiskAllowanceForOrderV2,
  ): Promise<SubmitOrderResult> {
    if (!canDispatch(order)) {
      const resume = resumeResultForExistingOrder(order);
      if (resume) {
        return resume;
      }
      return { status: "submitted", order };
    }

    if (await isKillSwitchBlocked(context)) {
      const blocked = await transitionOrConflict(context, order, "REJECTED", {
        eventPayload: KILL_SWITCH_REJECT_PAYLOAD,
      });
      if ("conflict" in blocked) {
        return { status: "conflict", orderId: blocked.orderId };
      }

      auditIds.submitBlocked = await writeOrderAudit(
        writeAudit,
        context,
        blocked.order.id,
        traderAuditActions.orderSubmitBlocked,
        { reason: "kill_switch" },
        input,
      );

      return { status: "submit_blocked", order: blocked.order, reason: "kill_switch" };
    }

    if (
      (input.riskAllowanceV2 &&
        !hasExactConsumedRiskV2Proof(context, input, consumedAllowance)) ||
      (!input.riskAllowanceV2 && order.riskAllowanceId)
    ) {
      return {
        status: "risk_allowance_refused",
        order: null,
        reason: "CONSUMED_ALLOWANCE_PROOF_MISSING_OR_MISMATCHED",
      };
    }

    const sent = await transitionOrConflict(context, order, "SENT_TO_EXCHANGE");
    if ("conflict" in sent) {
      return { status: "conflict", orderId: sent.orderId };
    }

    const connector = connectorForMode(input.executionMode);
    const placeInput = placeOrderInputFromOrder(sent.order);

    let connectorOrder: Order;
    try {
      connectorOrder = await refuseLegacyConnectorSubmission(placeInput);
    } catch {
      const uncertain = await transitionOrConflict(context, sent.order, "RECONCILIATION_REQUIRED");
      if ("conflict" in uncertain) {
        return { status: "conflict", orderId: uncertain.orderId };
      }

      auditIds.connectorUncertain = await writeOrderAudit(
        writeAudit,
        context,
        uncertain.order.id,
        traderAuditActions.orderConnectorUncertain,
        undefined,
        input,
      );

      return { status: "connector_uncertain", order: uncertain.order };
    }

    if (connectorOrder.status === "rejected") {
      const rejected = await transitionOrConflict(context, sent.order, "REJECTED", {
        eventPayload: CONNECTOR_REJECT_PAYLOAD,
      });
      if ("conflict" in rejected) {
        return { status: "conflict", orderId: rejected.orderId };
      }

      auditIds.connectorRejected = await writeOrderAudit(
        writeAudit,
        context,
        rejected.order.id,
        traderAuditActions.orderConnectorRejected,
        undefined,
        input,
      );

      return { status: "submitted", order: rejected.order, riskDecision, auditIds };
    }

    const accepted = await transitionOrConflict(context, sent.order, "ACCEPTED", {
      exchangeOrderId: connectorOrder.orderId,
    });
    if ("conflict" in accepted) {
      return { status: "conflict", orderId: accepted.orderId };
    }

    let current = accepted.order;

    if (historicalExecution?.enabled && input.executionMode === "mock" && input.type === "market") {
      historicalExecution.exchange.registerOrder(
        {
          ...current,
          symbol: normalizeSymbolForHistoricalExecution(current.symbol),
        },
        historicalExecution.getDecisionBarIndex(),
        historicalExecution.getReplayNowMs(),
      );
      return { status: "submitted", order: current, riskDecision, auditIds };
    }

    if (connectorOrder.status === "filled" || connectorOrder.status === "partially_filled") {
      const trade = await resolveTradeForOrder(connector, current, connectorOrder);
      if (!trade) {
        const uncertain = await transitionOrConflict(context, current, "RECONCILIATION_REQUIRED", {
          eventPayload: JSON.stringify({
            reason: "connector_status_without_exact_trade_evidence",
            connectorStatus: connectorOrder.status,
            exchangeOrderId: connectorOrder.orderId,
          }),
        });
        if ("conflict" in uncertain) {
          return { status: "conflict", orderId: uncertain.orderId };
        }
        return { status: "connector_uncertain", order: uncertain.order };
      }
      const fillRow = await orderRepository.recordFill(context, {
        orderId: current.id,
        exchangeTradeId: trade.tradeId,
        price: trade.price,
        quantity: trade.quantity,
        fee: trade.fee,
        feeAsset: trade.feeAsset,
        executedAt: new Date(trade.executedAt),
      });
      await recordLifecycleForFill(context, current, input, fillRow.id);

      const fillTarget = mapConnectorStatusToOrderState(connectorOrder.status);
      const filled = await transitionOrConflict(context, current, fillTarget, {
        filledQuantity: trade.quantity,
        avgFillPrice: trade.price,
      });
      if ("conflict" in filled) {
        return { status: "conflict", orderId: filled.orderId };
      }
      current = filled.order;

      auditIds.connectorFilled = await writeOrderAudit(
        writeAudit,
        context,
        current.id,
        traderAuditActions.orderConnectorFilled,
        {
          connectorStatus: connectorOrder.status,
          exchangeOrderId: connectorOrder.orderId,
        },
        input,
      );
    }

    return { status: "submitted", order: current, riskDecision, auditIds };
  }

  async function recordSimulatedFill(
    context: OrgContext,
    order: OrderRow,
    event: SimulatedFillEvent,
    isFirstSlice: boolean,
  ): Promise<OrderRow> {
    const economics = applyHistoricalExecutionEconomics(event, historicalExecution!.model);
    const newFilledQty = addDecimal(order.filledQuantity, event.sliceQuantity);
    const avgFillPrice =
      compareDecimal(order.filledQuantity, "0") === 0
        ? economics.netFillPrice
        : divideDecimal(
            addDecimal(
              multiplyDecimal(order.avgFillPrice ?? "0", order.filledQuantity),
              multiplyDecimal(economics.netFillPrice, event.sliceQuantity),
            ),
            newFilledQty,
          );

    const payload = buildRecordFillPayload(
      event,
      economics,
      context.organizationId,
      order.id,
      order.side,
      avgFillPrice,
      newFilledQty,
      !isFirstSlice,
    );

    if (isFirstSlice) {
      const fillTarget =
        compareDecimal(event.remainingQuantityAfter, "0") === 0 ? "FILLED" : "PARTIALLY_FILLED";
      const transitioned = await transitionOrConflict(context, order, fillTarget, {
        filledQuantity: newFilledQty,
        avgFillPrice,
      });
      if ("conflict" in transitioned) {
        throw new OrderVersionConflictError(transitioned.orderId, order.stateVersion);
      }
      await orderRepository.recordFill(context, payload);
      return transitioned.order;
    }

    await orderRepository.recordFillProgress(context, payload as RecordFillProgressInput);
    const updated = await orderRepository.getOrderById(context, order.id);
    if (!updated) {
      throw new OrderNotFoundError(order.id);
    }
    if (compareDecimal(event.remainingQuantityAfter, "0") === 0) {
      const filled = await transitionOrConflict(context, updated, "FILLED", {
        filledQuantity: newFilledQty,
        avgFillPrice,
      });
      if ("conflict" in filled) {
        throw new OrderVersionConflictError(filled.orderId, updated.stateVersion);
      }
      return filled.order;
    }
    return updated;
  }

  async function transitionOrderExpired(context: OrgContext, order: OrderRow): Promise<OrderRow> {
    const result = await transitionOrConflict(context, order, "EXPIRED");
    if ("conflict" in result) {
      throw new OrderVersionConflictError(result.orderId, order.stateVersion);
    }
    return result.order;
  }

  async function transitionOrderCancelled(context: OrgContext, order: OrderRow): Promise<OrderRow> {
    if (order.state === "CANCELLED") {
      return order;
    }
    const cancelRequested =
      order.state === "CANCEL_REQUESTED"
        ? { order }
        : await transitionOrConflict(context, order, "CANCEL_REQUESTED");
    if ("conflict" in cancelRequested) {
      throw new OrderVersionConflictError(cancelRequested.orderId, order.stateVersion);
    }
    const cancelled = await transitionOrConflict(context, cancelRequested.order, "CANCELLED");
    if ("conflict" in cancelled) {
      throw new OrderVersionConflictError(cancelled.orderId, cancelRequested.order.stateVersion);
    }
    return cancelled.order;
  }

  async function cancelOrderForBreach(
    context: OrgContext,
    order: OrderRow,
  ): Promise<BreachOrderCancelOutcome> {
    if (order.state === "CANCEL_REQUESTED" || isTerminal(order.state)) {
      return { status: "idempotent_skip", order };
    }

    if (!BREACH_CANCELLABLE_STATES.has(order.state)) {
      return { status: "failed", order };
    }

    if (historicalExecution?.enabled && order.executionMode === "mock") {
      const cancelRequested = await transitionOrConflict(context, order, "CANCEL_REQUESTED", {
        eventPayload: BREACH_CANCEL_PAYLOAD,
      });
      if ("conflict" in cancelRequested) {
        return { status: "failed", order };
      }
      return { status: "cancel_requested", order: cancelRequested.order };
    }

    try {
      const cancelled = await transitionOrderCancelled(context, order);
      return { status: "cancelled", order: cancelled };
    } catch {
      return { status: "failed", order };
    }
  }

  return {
    recordSimulatedFill,
    transitionOrderExpired,
    transitionOrderCancelled,
    cancelOrderForBreach,
    async submitOrder(context: OrgContext, input: SubmitOrderInput): Promise<SubmitOrderResult> {
      const orgContext = requireOrgContext(context.organizationId);
      const startedMs = nowMs();

      if (input.executionMode === "live" && !assertLiveAuthorized) {
        throw new LiveExecutionNotSupportedError("live");
      }
      if (
        input.executionMode !== "mock" &&
        input.executionMode !== "paper" &&
        input.executionMode !== "live"
      ) {
        throw new UnsupportedExecutionModeError(input.executionMode);
      }

      if (legacyOrderSubmissionDisabled()) {
        return finishSubmitOrder(orgContext, input, startedMs, {
          status: "execution_v2_required",
          order: null,
          reason: "LEGACY_ORDER_SUBMISSION_DISABLED",
        });
      }

      if (input.riskAllowanceV2) {
        if (!consumeRiskAllowanceV2) {
          return finishSubmitOrder(orgContext, input, startedMs, {
            status: "risk_allowance_refused",
            order: null,
            reason: "RISK_ALLOWANCE_CONSUMER_UNAVAILABLE",
          });
        }
        await authorizeLivePath(orgContext, input);
        let claim: ConsumeRiskAllowanceForOrderV2Result;
        try {
          claim = await consumeRiskAllowanceV2(orgContext, {
            accountId: input.riskAllowanceV2.accountId,
            riskAllowanceId: input.riskAllowanceV2.riskAllowanceId,
            nonce: input.riskAllowanceV2.nonce,
            consumptionEventId: input.riskAllowanceV2.consumptionEventId,
            order: {
              id: input.riskAllowanceV2.orderId,
              executionMode: input.executionMode,
              symbol: input.symbol,
              side: input.side,
              type: input.type,
              price: input.price ?? null,
              quantity: input.quantity,
              clientOrderId: input.clientOrderId,
              idempotencyKey: input.idempotencyKey,
              strategySignalId: input.strategySignalId ?? null,
              allocationDecisionId: input.allocationDecisionId ?? null,
              credentialId: input.credentialId ?? null,
            },
          });
        } catch (error) {
          return finishSubmitOrder(orgContext, input, startedMs, {
            status: "risk_allowance_refused",
            order: null,
            reason:
              error instanceof RiskV2AdmissionRefusedError
                ? error.reason
                : "RISK_ALLOWANCE_CLAIM_FAILED",
          });
        }
        if (claim.status === "REFUSED") {
          return finishSubmitOrder(orgContext, input, startedMs, {
            status: "risk_allowance_refused",
            order: null,
            reason: claim.reason,
          });
        }
        const consumed = claim;
        if (!hasExactConsumedRiskV2Proof(orgContext, input, consumed)) {
          return finishSubmitOrder(orgContext, input, startedMs, {
            status: "risk_allowance_refused",
            order: null,
            reason: "CONSUMED_ALLOWANCE_PROOF_MISSING_OR_MISMATCHED",
          });
        }
        const resume = resumeResultForExistingOrder(consumed.order);
        if (resume) return finishSubmitOrder(orgContext, input, startedMs, resume);
        const auditIds: SubmissionAuditIds = {};
        if (consumed.consumedNow) {
          auditIds.submissionStarted = await writeOrderAudit(
            writeAudit,
            orgContext,
            consumed.order.id,
            traderAuditActions.orderSubmissionStarted,
            {
              clientOrderId: input.clientOrderId,
              executionMode: input.executionMode,
              riskAllowanceId: consumed.riskAllowanceId,
              orderBindingDigestHex: consumed.orderBindingDigestHex,
            },
            input,
          );
        }
        const approved = await ensureRiskApproved(orgContext, consumed.order);
        if ("conflict" in approved) {
          return finishSubmitOrder(orgContext, input, startedMs, {
            status: "conflict",
            orderId: approved.orderId,
          });
        }
        return finishSubmitOrder(
          orgContext,
          input,
          startedMs,
          await dispatchToConnector(
            orgContext,
            approved.order,
            input,
            undefined,
            auditIds,
            consumed,
          ),
        );
      }

      const existingByClient = await orderRepository.findOrderByClientOrderId(
        orgContext,
        input.clientOrderId,
      );
      const existing =
        existingByClient ??
        (await orderRepository.findOrderByIdempotencyKey(orgContext, input.idempotencyKey));

      if (existing) {
        await authorizeLivePath(orgContext, input);
        const resume = resumeResultForExistingOrder(existing);
        if (resume) {
          return finishSubmitOrder(orgContext, input, startedMs, resume);
        }

        const approved = await ensureRiskApproved(orgContext, existing);
        if ("conflict" in approved) {
          return finishSubmitOrder(orgContext, input, startedMs, {
            status: "conflict",
            orderId: approved.orderId,
          });
        }

        return finishSubmitOrder(
          orgContext,
          input,
          startedMs,
          await dispatchToConnector(orgContext, approved.order, input),
        );
      }

      const placeInput = placeOrderInputFromSubmit(input, input.clientOrderId);
      const riskDecision = await riskEngine.evaluateOrderRequest({
        context: orgContext,
        order: placeInput,
        referencePrice: input.referencePrice,
        accountKey: input.accountKey,
        accountState: input.accountState,
        stopDistanceUsdt: input.stopDistanceUsdt,
      });

      if (isTerminalReject(riskDecision.decision.outcome)) {
        return finishSubmitOrder(orgContext, input, startedMs, {
          status: "risk_rejected",
          riskDecision,
          order: null,
        });
      }

      await authorizeLivePath(orgContext, input, riskDecision);

      const quantity =
        riskDecision.decision.outcome === "RESIZE" && riskDecision.decision.resize
          ? riskDecision.decision.resize.quantity
          : input.quantity;

      const created = await orderRepository.createOrder(orgContext, {
        venue: venueForMode(input.executionMode),
        executionMode: input.executionMode,
        symbol: input.symbol,
        side: input.side,
        type: input.type,
        price: input.price ?? null,
        quantity,
        clientOrderId: input.clientOrderId,
        idempotencyKey: input.idempotencyKey,
        riskDecisionId: riskDecision.riskDecisionId,
        strategySignalId: input.strategySignalId ?? null,
        allocationDecisionId: input.allocationDecisionId ?? null,
        credentialId: input.credentialId ?? null,
      });

      const auditIds: SubmissionAuditIds = {};
      auditIds.submissionStarted = await writeOrderAudit(
        writeAudit,
        orgContext,
        created.id,
        traderAuditActions.orderSubmissionStarted,
        {
          clientOrderId: input.clientOrderId,
          executionMode: input.executionMode,
        },
        input,
      );

      const approved = await transitionOrConflict(orgContext, created, "RISK_APPROVED");
      if ("conflict" in approved) {
        return finishSubmitOrder(orgContext, input, startedMs, {
          status: "conflict",
          orderId: approved.orderId,
        });
      }

      return finishSubmitOrder(
        orgContext,
        input,
        startedMs,
        await dispatchToConnector(orgContext, approved.order, input, riskDecision, auditIds),
      );
    },
  };
}

export function createOrderExecutionServiceFromDeps(
  deps: OrderExecutionServiceDeps,
): OrderExecutionService {
  return createOrderExecutionService(deps);
}

export function createSqliteOrderExecutionService(
  db: WaiaDb,
  overrides: Partial<OrderExecutionServiceDeps> = {},
): OrderExecutionService {
  const nowMs = overrides.nowMs ?? (() => Date.now());
  return createOrderExecutionService({
    riskEngine: overrides.riskEngine ?? createSqliteRiskEngineService(db, { nowMs }),
    orderRepository: overrides.orderRepository ?? createSqliteOrderRepository(db),
    killSwitchResolver:
      overrides.killSwitchResolver ??
      createKillSwitchResolver({
        repository: createSqliteKillSwitchRepository(db),
        nowMs,
      }),
    connectorForMode: overrides.connectorForMode ?? createDefaultConnectorForMode(),
    writeAudit:
      overrides.writeAudit ?? ((input: TraderAuditInput) => writeTraderAuditLogSqlite(db, input)),
    nowMs,
  });
}

export function createPostgresOrderExecutionService(
  db: WaiaPostgresDb,
  overrides: Partial<OrderExecutionServiceDeps> = {},
): OrderExecutionService {
  const nowMs = overrides.nowMs ?? (() => Date.now());
  return createOrderExecutionService({
    riskEngine: overrides.riskEngine ?? createPostgresRiskEngineService(db, { nowMs }),
    orderRepository: overrides.orderRepository ?? createPostgresOrderRepository(db),
    killSwitchResolver:
      overrides.killSwitchResolver ??
      createKillSwitchResolver({
        repository: createPostgresKillSwitchRepository(db),
        nowMs,
      }),
    connectorForMode: overrides.connectorForMode ?? createDefaultConnectorForMode(),
    writeAudit:
      overrides.writeAudit ?? ((input: TraderAuditInput) => writeTraderAuditLogPostgres(db, input)),
    nowMs,
    consumeRiskAllowanceV2:
      overrides.consumeRiskAllowanceV2 ??
      ((context, input) => consumeRiskAllowanceForOrderV2Postgres(db, context, input)),
  });
}

export function createPostgresOrderExecutionServiceFromExecutor(
  ex: PgExecutionExecutor,
  overrides: Partial<OrderExecutionServiceDeps> = {},
): OrderExecutionService {
  const nowMs = overrides.nowMs ?? (() => Date.now());
  return createOrderExecutionService({
    riskEngine: overrides.riskEngine ?? createPostgresRiskEngineService(ex, { nowMs }),
    orderRepository: overrides.orderRepository ?? createPostgresOrderRepositoryFromExecutor(ex),
    killSwitchResolver:
      overrides.killSwitchResolver ??
      createKillSwitchResolver({
        repository: createPostgresKillSwitchRepository(ex),
        nowMs,
      }),
    connectorForMode: overrides.connectorForMode ?? createDefaultConnectorForMode(),
    writeAudit:
      overrides.writeAudit ?? ((input: TraderAuditInput) => writeTraderAuditLogPostgres(ex, input)),
    nowMs,
  });
}
