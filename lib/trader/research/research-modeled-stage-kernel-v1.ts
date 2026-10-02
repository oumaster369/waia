import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import { createAccountingFrontierRepositoryPostgres } from "@/lib/trader/accounting/accounting-frontier-repository-postgres";
import { buildHistoricalAccountingInceptionV2 } from "@/lib/trader/historical-simulation-v2/accounting-inception-v2";
import { createHistoricalSimulatedExchange } from "@/lib/trader/execution/historical-simulated-exchange";
import { createHistoricalMockOrderRepositoryFromExecutor } from "@/lib/trader/execution/historical-mock-order-repository-postgres";
import { deterministicExecutionUuidV2, multiplyExecutionNotionalConservativelyV2 } from "@/lib/trader/execution/v2/contracts";
import type { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { createAdvanceHistoricalModeledExecutionV2 } from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";
import {
  createHistoricalModeledExecutionRegistryV2,
  HISTORICAL_MODELED_EXECUTION_V2_SCHEMA,
  type HistoricalModeledExecutionReceiptV2,
} from "@/lib/trader/historical-simulation-v2/modeled-capital-binding-v2";
import {
  buildHistoricalModeledPortfolioLifecycleV2,
  deriveHistoricalModeledRiskAccountingV2,
} from "@/lib/trader/historical-simulation-v2/historical-modeled-portfolio-reality-v2";
import {
  createHistoricalSimulationExecutionPersistenceV2,
  persistHistoricalModeledExecutionSubmissionV2,
} from "@/lib/trader/historical-simulation-v2/production-transaction-adapters-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { resolveDefaultStopDistance } from "@/lib/trader/portfolio/default-stop-distance-provider";
import type { PortfolioRunConfig } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { computeResearchStopBasedQuantity } from "@/lib/trader/portfolio/stop-based-sizing";
import { evaluateDrawdownPolicy } from "@/lib/trader/risk/drawdown-policy-evaluator";
import { calculateRiskAdmissionV2 } from "@/lib/trader/risk/v2/risk-admission-service-v2";
import { addDecimal, compareDecimal, divideDecimal, multiplyDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { evaluateResearchFeatureInvocationV1, type ResearchFeatureInvocationReceiptV1 } from "@/lib/trader/research/research-feature-invocation-v1";
import type { ResearchModeledStageSourceV1 } from "./research-modeled-stage-source-v1";
import type { resolveResearchTrainingPolicyV1 } from "@/lib/trader/research/research-training-policy-v1";

function refuse(reason: string): never {
  throw new Error(`RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:${reason}`);
}

function assertNonnegativeCash(frontier: AccountingFrontierV1): void {
  // The canonical accounting engine represents arithmetic, including negative
  // cash. A spot-only research stage must not silently create simulated credit
  // when the next eligible fill gaps above the decision-bar affordability test.
  if (compareDecimal(frontier.cash, "0") < 0) refuse("NEGATIVE_CASH_AFTER_FILL");
}

function openPositions(frontier: AccountingFrontierV1) {
  return Object.entries(frontier.positions).filter(([, position]) =>
    compareDecimal(position.quantity, "0") > 0);
}

function sizingAccount(frontier: AccountingFrontierV1, runConfig: PortfolioRunConfig) {
  const positions = openPositions(frontier).map(([symbol, position]) => {
    const mark = frontier.marks[symbol];
    if (!mark || compareDecimal(mark.price, "0") <= 0) refuse("POSITION_MARK_MISSING");
    const avgCost = divideDecimal(position.netPositionBasis, position.quantity);
    const stop = resolveDefaultStopDistance({ entryPrice: avgCost, runConfig });
    const riskAtStopUsdt = multiplyDecimal(position.quantity, stop.stopDistanceUsdt);
    return Object.freeze({ symbol, quantity: position.quantity, avgCost, markPrice: mark.price,
      unrealizedPnlUsdt: multiplyDecimal(subtractDecimal(mark.price, avgCost), position.quantity),
      riskAtStopUsdt, stopDistanceUsdt: stop.stopDistanceUsdt });
  });
  return Object.freeze({ equityUsdt: frontier.equity, availableBalanceUsdt: frontier.cash,
    openRiskUsdt: positions.reduce((total, position) => addDecimal(total, position.riskAtStopUsdt), "0"),
    openPositionCount: positions.length, positions: Object.freeze(positions) });
}

/** Internal modeled loop, called only after the registered stage owner loads its
 * DEVELOPMENT input, validates policy and locks/checks its ledger in this exact
 * transaction. This function is not a registration, stage-access or authority
 * boundary. Do not export it through a public request/service facade. */
export async function runOwnedResearchModeledStageV1(input: Readonly<{
  tx: Pick<WaiaPostgresDb, "select" | "insert" | "update" | "execute">;
  source: ResearchModeledStageSourceV1;
  request: Readonly<{ attemptId: string; trialIndex: number }>;
  policy: ReturnType<typeof resolveResearchTrainingPolicyV1>;
  model: ReturnType<typeof createHistoricalExecutionModelV1>;
}>) {
  const { tx, source, request, policy, model } = input;
  const { scope } = source;
  const { organizationId } = scope.identity;
  const captured = Object.freeze({ organizationId });
  const stageRunId = scope.ledgerScope.historicalRunId;
  const accountKey = scope.ledgerScope.historicalAccountKey;
  const orders = createHistoricalMockOrderRepositoryFromExecutor(tx, scope.ledgerScope, {
    newId() { return deterministicExecutionUuidV2("report", { stageRunId, eventOrdinal: ++eventOrdinal }); },
    now() { return new Date(eventClock); },
  });
  const accountingRepository = createAccountingFrontierRepositoryPostgres(tx);
  let eventOrdinal = 0;
  let eventClock = source.bars[0]!.barOpenTime;
  let accounting = buildHistoricalAccountingInceptionV2({ organizationId, accountId: accountKey,
    runId: stageRunId, startingCash: policy.portfolio.runConfig.startingBalanceUsdt,
    frontierAsOf: eventClock });
  assertNonnegativeCash(accounting);
  accounting = await accountingRepository.append(captured, accounting);
  const exchange = createHistoricalSimulatedExchange(model);
  const registry = createHistoricalModeledExecutionRegistryV2();
  const cycleMap = new Map(source.cycles.map(cycle => [cycle.cycleId, cycle] as const));
  const decisions: Record<string, unknown>[] = [];
  const invocations: ResearchFeatureInvocationReceiptV1[] = [];
  const advances: Record<string, unknown>[] = [];
  const fillDetails: Record<string, unknown>[] = [];
  const advance = createAdvanceHistoricalModeledExecutionV2({ context: captured,
    accountKey, runId: stageRunId, exchange, executionRegistry: registry, model,
    persistence: createHistoricalSimulationExecutionPersistenceV2({ orders, model }),
    accountingRepository: Object.freeze({
      loadLatest: (...args: Parameters<typeof accountingRepository.loadLatest>) =>
        accountingRepository.loadLatest(...args),
      append: async (ctx: OrgContext, frontier: AccountingFrontierV1) => {
        assertNonnegativeCash(frontier);
        const persisted = await accountingRepository.append(ctx, frontier);
        accounting = persisted;
        return persisted;
      },
    }),
    resolveMarketCycle: async id => {
      const cycle = cycleMap.get(id);
      if (!cycle) refuse("CYCLE_NOT_REGISTERED");
      return cycle;
    },
    initialAccountingFrontier: async () => accounting,
    refreshAccountState: async () => ({
      positions: openPositions(accounting).map(([symbol, position]) => ({ symbol, quantity: position.quantity })),
      openOrderCount: exchange.listOpenOrders().length,
      dailyPnl: accounting.netRealizedPnl, drawdown: String(accounting.accountDrawdownBps),
      quoteExposureByCurrency: Object.freeze({}), availableBalanceUsdt: accounting.cash,
      equityUsdt: accounting.equity, openPositionCount: openPositions(accounting).length,
    }),
    reconcileOrder: async () => undefined,
    resolveLatestOrder: id => orders.getOrderById(captured, id),
    persistAdvanceEvidence: async bundle => {
      fillDetails.push(...bundle.fillDetails);
      advances.push(Object.freeze({ cycleId: bundle.cycleId,
        fillEvidence: bundle.fillEvidence, effects: bundle.effects }));
    },
  });

  const firstSourceBarIndex = source.cycles[0]!.barIndex;
  for (let index = 0; index < source.cycles.length; index += 1) {
    const cycle = source.cycles[index]!;
    const bar = source.bars[index]!;
    if (cycle.barIndex !== firstSourceBarIndex + index || cycle.closedBar.barCloseTime !== bar.barCloseTime) {
      refuse("CYCLE_INDEX_MISMATCH");
    }
    eventClock = bar.barCloseTime;
    await advance(cycle.cycleId);
    const { signal, invocationReceipt } = evaluateResearchFeatureInvocationV1({
      parameters: scope.identity.parameters, bars: source.bars,
      symbol: source.experiment.spec.universe.symbol, interval: "1m",
      index, sourceBarIndex: cycle.barIndex, cycleId: cycle.cycleId });
    invocations.push(invocationReceipt);
    if (signal.action === "NONE") continue;
    const before = accounting;
    const held = before.positions[source.experiment.spec.universe.symbol]?.quantity ?? "0";
    const anyPending = exchange.listOpenOrders().length > 0;
    const action = signal.action === "BUY" ? "ENTER_LONG" : "CLOSE";
    const skip = anyPending ? "PENDING_ORDER" :
      signal.action === "BUY" && compareDecimal(held, "0") > 0 ? "ALREADY_LONG" :
      signal.action === "SELL" && compareDecimal(held, "0") <= 0 ? "NO_LONG_POSITION" : null;
    if (skip) {
      decisions.push(Object.freeze({ index, sourceBarIndex: cycle.barIndex, cycleId: cycle.cycleId, signal, disposition: skip }));
      continue;
    }
    const account = sizingAccount(before, policy.portfolio.runConfig);
    if (signal.action === "BUY" && account.openPositionCount >= policy.portfolio.limits.maxConcurrentPositions) {
      decisions.push(Object.freeze({ index, sourceBarIndex: cycle.barIndex, cycleId: cycle.cycleId, signal, disposition: "POSITION_LIMIT" }));
      continue;
    }
    const d20 = evaluateDrawdownPolicy({ equityUsdt: before.equity,
      accountPeakHwm: before.equityHwm,
      monthlyPeakHwm: before.monthlyPeakHwm ?? before.equityHwm }, policy.guardian.drawdownPolicy);
    const posture = d20.breachState === "STOP_ACCOUNT" ? "HALT" :
      d20.breachState === "CLOSE_ONLY" ? "CLOSE_ONLY" : "NORMAL";
    const sized = computeResearchStopBasedQuantity({ side: signal.action === "BUY" ? "buy" : "sell",
      symbol: source.experiment.spec.universe.symbol, entryPrice: bar.close,
      defaultQuantity: policy.declaredQuantityCap, account,
      limits: policy.portfolio.limits, runConfig: policy.portfolio.runConfig,
      costModel: policy.portfolio.costModel });
    if (!sized.ok) {
      decisions.push(Object.freeze({ index, sourceBarIndex: cycle.barIndex, cycleId: cycle.cycleId, signal,
        disposition: sized.reason, accountD20: d20 }));
      continue;
    }
    const modeledAccounting = deriveHistoricalModeledRiskAccountingV2({ frontier: before,
      organizationId, accountId: accountKey, runId: stageRunId,
      exposureLimitNotional: before.equity, worstCasePendingExposureNotional: "0",
      outstandingReservationNotional: "0" });
    const lifecycle = buildHistoricalModeledPortfolioLifecycleV2({ organizationId,
      accountId: accountKey, runId: stageRunId, cycleId: cycle.cycleId,
      symbol: source.experiment.spec.universe.symbol, action,
      quantity: sized.quantity, referencePrice: bar.close, accounting: modeledAccounting });
    const requestedReservationNotional = action === "ENTER_LONG" ?
      multiplyExecutionNotionalConservativelyV2(sized.quantity, bar.close) : "0";
    const admission = calculateRiskAdmissionV2({ accounting: modeledAccounting.accounting,
      requestedReservationNotional, posture,
      strictExposureReduction: lifecycle.strictExposureReduction, reconciliationStatus: "RECONCILED" });
    const decisionBody = Object.freeze({ schemaVersion: "waia.research.training-modeled-decision.v1",
      organizationId, attemptId: request.attemptId, trialIndex: request.trialIndex,
      stageRunId, scopeDigestHex: scope.contentDigest, cycleId: cycle.cycleId, index, sourceBarIndex: cycle.barIndex,
      signal, action, quantity: sized.quantity, stopDistanceUsdt: sized.stopDistanceUsdt,
      accountingFrontierDigestHex: before.semanticContentDigest, lifecycleDigestHex: lifecycle.contentDigestHex });
    const decisionDigest = computeSemanticSha256Hex(decisionBody);
    const decisionId = deterministicExecutionUuidV2("plan", { stageRunId, decisionDigest });
    const riskBody = Object.freeze({ schemaVersion: "waia.research.training-modeled-risk.v1",
      source: "MODELED_HISTORICAL", capitalEligible: false,
      decisionId, decisionDigest, accountingFrontierDigestHex: before.semanticContentDigest,
      lifecycleDigestHex: lifecycle.contentDigestHex, requestedReservationNotional,
      posture, accountD20: d20, admission });
    const riskDigest = computeSemanticSha256Hex(riskBody);
    if (admission.status === "REFUSED") {
      decisions.push(Object.freeze({ ...decisionBody, decisionId, decisionDigest,
        risk: riskBody, riskDigest, disposition: "RISK_VETO" }));
      continue;
    }
    const riskVerdictId = deterministicExecutionUuidV2("risk-event", { stageRunId, riskDigest });
    const modeledAllowanceId = deterministicExecutionUuidV2("risk-event", {
      kind: "research-modeled-only", stageRunId, riskVerdictId });
    const executionPlanId = deterministicExecutionUuidV2("plan", { stageRunId, decisionId, riskDigest });
    const executionAttemptId = deterministicExecutionUuidV2("attempt", { executionPlanId });
    const orderId = deterministicExecutionUuidV2("order", { executionAttemptId });
    const side = signal.action === "BUY" ? "buy" : "sell";
    const executionPlanContentDigestHex = computeSemanticSha256Hex({
      schemaVersion: "waia.research.training-modeled-plan.v1", executionPlanId,
      decisionId, decisionDigest, riskDigest, symbol: source.experiment.spec.universe.symbol,
      side, quantity: sized.quantity, modelDigest: policy.historicalExecutionModelSha256 });
    const executionAttemptContentDigestHex = computeSemanticSha256Hex({
      schemaVersion: "waia.research.training-modeled-attempt.v1", executionAttemptId,
      executionPlanId, executionPlanContentDigestHex, acceptedAtUtc: bar.barCloseTime });
    const orderContentDigestHex = computeSemanticSha256Hex({
      schemaVersion: "waia.research.training-modeled-order.v1", orderId,
      executionAttemptId, executionAttemptContentDigestHex, decisionDigest,
      symbol: source.experiment.spec.universe.symbol, side, quantity: sized.quantity });
    const executionBody = Object.freeze({ schemaVersion: HISTORICAL_MODELED_EXECUTION_V2_SCHEMA,
      source: "MODELED_HISTORICAL" as const, capitalEligible: false as const,
      executionPlanId, executionPlanContentDigestHex,
      executionAttemptId, executionAttemptContentDigestHex, orderId, orderContentDigestHex,
      decisionId, decisionContentDigestHex: decisionDigest, riskVerdictId,
      riskReceiptContentDigestHex: riskDigest,
      symbol: source.experiment.spec.universe.symbol, side, quantity: sized.quantity,
      decisionBarIndex: cycle.barIndex, acceptedAtUtc: bar.barCloseTime });
    const receipt = Object.freeze({ ...executionBody,
      contentDigestHex: computeSemanticSha256Hex(executionBody) }) satisfies HistoricalModeledExecutionReceiptV2;
    const accepted = await persistHistoricalModeledExecutionSubmissionV2({ context: captured,
      orders, organizationId, accountId: accountKey, runId: stageRunId,
      decisionId, riskAllowanceId: modeledAllowanceId, receipt });
    if (accepted.id !== orderId || accepted.state !== "ACCEPTED") refuse("ORDER_NOT_ACCEPTED");
    exchange.registerOrder(accepted, cycle.barIndex, Date.parse(bar.barCloseTime));
    registry.register(receipt);
    decisions.push(Object.freeze({ ...decisionBody, decisionId, decisionDigest,
      risk: riskBody, riskDigest, execution: receipt, disposition: "MODELED_ORDER_ACCEPTED" }));
  }
  const orderRows = await orders.listOrders(captured);
  const openOrderIds = exchange.listOpenOrders().map(entry => entry.order.id);
  return Object.freeze({ accounting, decisions: Object.freeze(decisions),
    invocations: Object.freeze(invocations),
    advances: Object.freeze(advances), fillDetails: Object.freeze(fillDetails),
    orderRows: Object.freeze(orderRows), openOrderIds: Object.freeze(openOrderIds) });
}
