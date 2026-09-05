import type { AccountingFrontierRepository } from "@/lib/trader/accounting/accounting-frontier-repository-postgres";
import { advanceAccountingFrontier } from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import {
  applyHistoricalExecutionEconomics,
  buildRecordFillPayload,
  type HistoricalExecutionPersistencePort,
  type HistoricalSimulatedExchange,
} from "@/lib/trader/execution/historical-simulated-exchange";
import type { CostedFillEconomics, HistoricalExecutionModelV1, SimulatedFillEvent } from "@/lib/trader/execution/historical-execution-model.types";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import { historicalInstrumentsMatch } from "@/lib/trader/symbols/historical-instrument";
import type { Bar } from "@/lib/trader/intelligence/types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HtxVolumeQualificationReceiptV1 } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { addDecimal } from "@/lib/trader/risk/numeric";
import { deterministicExecutionUuidV2 } from "@/lib/trader/execution/v2/contracts";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { HistoricalModeledExecutionRegistryV2 } from "./modeled-capital-binding-v2";
import type { HistoricalSimulationReasonLedgerV2Draft } from "./reason-ledger-v2";

export const HISTORICAL_SEALED_MARKET_CYCLE_V2_SCHEMA =
  "waia.trader.historical_sealed_market_cycle.v2" as const;
export const HISTORICAL_MODELED_FILL_EVIDENCE_V2_SCHEMA =
  "waia.trader.historical_modeled_fill_evidence.v2" as const;

export type HistoricalSealedMarketCycleV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_SEALED_MARKET_CYCLE_V2_SCHEMA;
  cycleId: string;
  barIndex: number;
  closedBar: Bar;
  htxVolumeAuthorityReceipt: HtxVolumeQualificationReceiptV1;
  htxVolumeRaw: Readonly<{ amount: number; vol: number }>;
  contentDigestHex: string;
}>;

export type HistoricalModeledFillEvidenceV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_MODELED_FILL_EVIDENCE_V2_SCHEMA;
  source: "MODELED_HISTORICAL";
  capitalEligible: false;
  cycleId: string;
  sealedMarketCycleContentDigestHex: string;
  orderId: string;
  fillId: string;
  economicsContentDigestHex: string;
  accountingFrontierContentDigestHex: string;
  contentDigestHex: string;
}>;

export type HistoricalModeledFillDetailV2 = Readonly<{
  schemaVersion: "waia.trader.historical_modeled_fill_detail.v2";
  evidence: HistoricalModeledFillEvidenceV2;
  event: Readonly<Omit<SimulatedFillEvent, "acceptedAt" | "fillTimestamp"> & {
    acceptedAt: string; fillTimestamp: string;
  }>;
  economics: Readonly<Omit<CostedFillEconomics, "sourceBarTimestamp" | "acceptedAt" | "fillTimestamp"> & {
    sourceBarTimestamp: string; acceptedAt: string; fillTimestamp: string;
  }>;
  accountingFrontier: AccountingFrontierV1;
  contentDigestHex: string;
}>;

export type AdvanceHistoricalModeledExecutionV2Input = Readonly<{
  context: OrgContext;
  accountKey: string;
  runId: string;
  exchange: HistoricalSimulatedExchange;
  executionRegistry: HistoricalModeledExecutionRegistryV2;
  model: HistoricalExecutionModelV1;
  persistence: HistoricalExecutionPersistencePort;
  accountingRepository: AccountingFrontierRepository;
  resolveMarketCycle(cycleId: string): Promise<HistoricalSealedMarketCycleV2>;
  initialAccountingFrontier(cycle: HistoricalSealedMarketCycleV2): Promise<AccountingFrontierV1>;
  refreshAccountState(): Promise<AccountRiskState>;
  reconcileOrder(orderId: string): Promise<void>;
  resolveLatestOrder?(orderId: string): Promise<OrderRow | null>;
  /** Must commit the complete validated evidence bundle atomically or commit nothing. */
  persistAdvanceEvidence(bundle: Readonly<{
    cycleId: string;
    fillEvidence: readonly HistoricalModeledFillEvidenceV2[];
    fillDetails: readonly HistoricalModeledFillDetailV2[];
    effects: readonly HistoricalModeledObservedEffectV2[];
  }>): Promise<void>;
}>;

export type AdvanceHistoricalModeledExecutionV2Result = Readonly<{
  fillCount: number;
  fillEvidence: readonly HistoricalModeledFillEvidenceV2[];
  fillDetails: readonly HistoricalModeledFillDetailV2[];
  accountingFrontierContentDigestHex: string;
  accountingFrontier: AccountingFrontierV1;
  accountingAdvanced: boolean;
  effects: readonly HistoricalModeledObservedEffectV2[];
}>;

export type HistoricalModeledObservedEffectV2 = Readonly<{
  effectId: string;
  cycleId: string;
  decisionId: string;
  decisionContentDigestHex: string;
  riskReceiptContentDigestHex: string;
  executionPlanId: string;
  executionPlanContentDigestHex: string;
  executionAttemptId: string;
  executionAttemptContentDigestHex: string;
  orderId: string;
  orderContentDigestHex: string;
  status: "NO_FILL" | "PARTIAL_FILL" | "FILLED" | "EXPIRED" | "CANCELLED";
  fillEvidenceContentDigestHexes: readonly string[];
  reportContentDigestHexes: readonly string[];
  reasonCodes: readonly string[];
}>;

export function projectHistoricalModeledEffectsToReasonLedgerV2(
  result: AdvanceHistoricalModeledExecutionV2Result,
): HistoricalSimulationReasonLedgerV2Draft["observedExecutionEffects"] {
  return Object.freeze(result.effects.map((effect) => Object.freeze({
    effectId: effect.effectId,
    originatingDecisionId: effect.decisionId,
    originatingDecisionContentDigestHex: effect.decisionContentDigestHex,
    originatingPlanId: effect.executionPlanId,
    originatingPlanContentDigestHex: effect.executionPlanContentDigestHex,
    originatingAttemptId: effect.executionAttemptId,
    originatingAttemptContentDigestHex: effect.executionAttemptContentDigestHex,
    originatingOrderId: effect.orderId,
    originatingOrderContentDigestHex: effect.orderContentDigestHex,
    status: effect.status,
    reportContentDigestHexes: effect.reportContentDigestHexes,
    fillContentDigestHexes: effect.fillEvidenceContentDigestHexes,
    reasonCodes: effect.reasonCodes,
  })));
}

/** Single typed bridge accepted by the capital binding; prevents raw `effects`/ledger miswiring. */
export function bindHistoricalModeledAdvanceToLedgerV2(input: Readonly<{
  advance(cycleId: string): Promise<AdvanceHistoricalModeledExecutionV2Result>;
}>): (cycle: Readonly<{ cycleId: string }>) => Promise<Readonly<{
  observedExecutionEffects: HistoricalSimulationReasonLedgerV2Draft["observedExecutionEffects"];
  accountingAdvanced: boolean;
}>> {
  return async (cycle) => {
    const result = await input.advance(cycle.cycleId);
    return Object.freeze({
      observedExecutionEffects: projectHistoricalModeledEffectsToReasonLedgerV2(result),
      accountingAdvanced: result.accountingAdvanced,
    });
  };
}

const DIGEST = /^[0-9a-f]{64}$/;

function bodyOfMarketCycle(input: Omit<HistoricalSealedMarketCycleV2, "contentDigestHex">) {
  return {
    ...input,
    closedBar: { ...input.closedBar },
    htxVolumeAuthorityReceipt: { ...input.htxVolumeAuthorityReceipt },
    htxVolumeRaw: { ...input.htxVolumeRaw },
  };
}

function marksForClosedHistoricalBar(
  accounting: AccountingFrontierV1,
  bar: Bar,
  openingPositionSymbol?: string,
): AccountingFrontierV1["marks"] {
  const mark = { price: bar.close, barCloseTime: bar.barCloseTime };
  const marks = { ...accounting.marks, [bar.symbol]: mark };
  // A first fill can create the canonical execution position (for example
  // BTCUSDT) from a market-data bar using the slash form (BTC/USDT).  The
  // pre-fill frontier does not contain that position yet, so bind its exact
  // execution symbol before accounting attaches marks to the new position.
  if (openingPositionSymbol && historicalInstrumentsMatch(openingPositionSymbol, bar.symbol)) {
    marks[openingPositionSymbol] = mark;
  }
  for (const positionSymbol of Object.keys(accounting.positions)) {
    if (historicalInstrumentsMatch(positionSymbol, bar.symbol)) {
      marks[positionSymbol] = mark;
    }
  }
  return marks;
}

export function sealHistoricalMarketCycleV2(
  input: Omit<HistoricalSealedMarketCycleV2, "schemaVersion" | "contentDigestHex">,
): HistoricalSealedMarketCycleV2 {
  const body = bodyOfMarketCycle({ ...input, schemaVersion: HISTORICAL_SEALED_MARKET_CYCLE_V2_SCHEMA });
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function assertHistoricalMarketCycleV2(
  value: HistoricalSealedMarketCycleV2,
  cycleId: string,
): void {
  const { contentDigestHex, ...body } = value;
  if (
    value.schemaVersion !== HISTORICAL_SEALED_MARKET_CYCLE_V2_SCHEMA ||
    value.cycleId !== cycleId ||
    !Number.isSafeInteger(value.barIndex) || value.barIndex < 0 ||
    !DIGEST.test(contentDigestHex) || computeSemanticSha256Hex(bodyOfMarketCycle(body)) !== contentDigestHex ||
    !historicalInstrumentsMatch(value.closedBar.symbol, value.htxVolumeAuthorityReceipt.symbol) ||
    value.closedBar.interval !== "1m" || value.htxVolumeAuthorityReceipt.interval !== "1m" ||
    value.closedBar.barCloseTime !== new Date(value.closedBar.barCloseTime).toISOString() ||
    value.htxVolumeAuthorityReceipt.verdict !== "HTX_VOLUME_AUTHORITY_QUALIFIED" ||
    value.htxVolumeAuthorityReceipt.authorityField !== "amount"
  ) throw new Error("HISTORICAL_SEALED_MARKET_CYCLE_V2_INVALID");
}

/**
 * Advances the real historical simulator and canonical accounting engine. The wrapped persistence
 * remains the sole order/fill store; this adapter adds immutable modeled evidence and an accounting
 * frontier for each costed simulated fill. No connector or Reality V2 port is accepted.
 */
export function createAdvanceHistoricalModeledExecutionV2(
  input: AdvanceHistoricalModeledExecutionV2Input,
): (cycleId: string) => Promise<AdvanceHistoricalModeledExecutionV2Result> {
  return async (cycleId) => {
    const market = await input.resolveMarketCycle(cycleId);
    assertHistoricalMarketCycleV2(market, cycleId);
    let accounting = await input.accountingRepository.loadLatest(input.context, {
      accountKey: input.accountKey,
      runId: input.runId,
    }) ?? await input.initialAccountingFrontier(market);
    const fillEvidence: HistoricalModeledFillEvidenceV2[] = [];
    const fillDetails: HistoricalModeledFillDetailV2[] = [];
    const ordersBefore = input.exchange.listOpenOrders().map((entry) => entry.order).filter((order) => {
      const receipt = input.executionRegistry.get(order.id);
      if (!receipt) throw new Error("HISTORICAL_MODELED_EXECUTION_LINEAGE_MISSING");
      return receipt.decisionBarIndex < market.barIndex;
    });
    const expired = new Set<string>();
    const cancelled = new Set<string>();

    const persistence: HistoricalExecutionPersistencePort = {
      ...input.persistence,
      async recordSimulatedFill(context, order, event, isFirstSlice) {
        const economics = applyHistoricalExecutionEconomics(event, input.model);
        const filledQuantity = addDecimal(order.filledQuantity, event.sliceQuantity);
        const payload = buildRecordFillPayload(
          event, economics, context.organizationId, order.id, order.side,
          economics.netFillPrice, filledQuantity, !isFirstSlice,
        );
        const updated = await input.persistence.recordSimulatedFill(context, order, event, isFirstSlice);
        accounting = advanceAccountingFrontier({
          state: accounting,
          fill: {
            fillId: payload.fillId!,
            economics,
            executedAt: event.fillTimestamp.toISOString(),
          },
          marks: marksForClosedHistoricalBar(accounting, event.sourceBar, order.symbol),
          frontierAsOf: event.fillTimestamp.toISOString(),
          // PostgreSQL accounting frontiers use UUID primary keys.  The generic
          // accounting engine's human-readable fallback is useful in memory but
          // is not a durable identity authority.
          frontierId: deterministicExecutionUuidV2("report", {
            kind: "historical-modeled-accounting-frontier",
            organizationId: input.context.organizationId,
            accountKey: accounting.accountKey,
            runId: input.runId,
            previousSequence: accounting.accountingSequence,
            fillId: payload.fillId!,
          }),
          idempotencyKey: `historical-v2:${input.runId}:${payload.fillId}`,
        });
        accounting = await input.accountingRepository.append(input.context, accounting);
        const body = {
          schemaVersion: HISTORICAL_MODELED_FILL_EVIDENCE_V2_SCHEMA,
          source: "MODELED_HISTORICAL" as const,
          capitalEligible: false as const,
          cycleId,
          sealedMarketCycleContentDigestHex: market.contentDigestHex,
          orderId: order.id,
          fillId: payload.fillId!,
          economicsContentDigestHex: economics.economicsContentDigest,
          accountingFrontierContentDigestHex: accounting.semanticContentDigest,
        };
        const evidence = Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
        fillEvidence.push(evidence);
        const detailBody = { schemaVersion: "waia.trader.historical_modeled_fill_detail.v2" as const,
          evidence, event: { ...event, acceptedAt: event.acceptedAt.toISOString(),
            fillTimestamp: event.fillTimestamp.toISOString() }, economics: { ...economics,
            sourceBarTimestamp: economics.sourceBarTimestamp.toISOString(), acceptedAt: economics.acceptedAt.toISOString(),
            fillTimestamp: economics.fillTimestamp.toISOString() }, accountingFrontier: accounting };
        fillDetails.push(Object.freeze({ ...detailBody, contentDigestHex: computeSemanticSha256Hex(detailBody) }));
        return updated;
      },
      async transitionOrderExpired(context, order) {
        const updated = await input.persistence.transitionOrderExpired(context, order);
        expired.add(order.id);
        return updated;
      },
      async transitionOrderCancelled(context, order) {
        const updated = await input.persistence.transitionOrderCancelled(context, order);
        cancelled.add(order.id);
        return updated;
      },
      ...(input.persistence.transitionOrderCancelledFromRequested
        ? { async transitionOrderCancelledFromRequested(context: OrgContext, order: OrderRow) {
            const updated = await input.persistence.transitionOrderCancelledFromRequested!(context, order);
            cancelled.add(order.id);
            return updated;
          } }
        : {}),
    };
    const advanced = await input.exchange.advanceOnClosedBar({
      context: input.context,
      closedBar: market.closedBar,
      barIndex: market.barIndex,
      model: input.model,
      persistence,
      replayNowMs: Date.parse(market.closedBar.barCloseTime),
      htxVolumeAuthorityReceipt: market.htxVolumeAuthorityReceipt,
      htxVolumeRaw: market.htxVolumeRaw,
      resolveLatestOrder: input.resolveLatestOrder,
      refreshAccountState: input.refreshAccountState,
      reconcileOrder: input.reconcileOrder,
    });
    // Fill frontiers capture execution economics, but capital, Guardian and Reality must observe
    // the current closed-bar mark even when no order fills. Persist one deterministic terminal
    // mark frontier per cycle after all fills so the next Forecast/Risk sees exact current equity.
    accounting = advanceAccountingFrontier({
      state: accounting,
      marks: marksForClosedHistoricalBar(accounting, market.closedBar),
      frontierAsOf: market.closedBar.barCloseTime,
      frontierId: deterministicExecutionUuidV2("report", {
        kind: "historical-modeled-accounting-closed-bar-mark",
        organizationId: input.context.organizationId,
        accountKey: input.accountKey,
        runId: input.runId,
        cycleId,
        barIndex: market.barIndex,
        sealedMarketCycleContentDigestHex: market.contentDigestHex,
      }),
      idempotencyKey:
        `historical-v2:${input.runId}:${input.accountKey}:${cycleId}:closed-bar-mark`,
    });
    accounting = await input.accountingRepository.append(input.context, accounting);
    if (!DIGEST.test(accounting.semanticContentDigest)) {
      throw new Error("HISTORICAL_MODELED_ACCOUNTING_FRONTIER_UNSEALED");
    }
    const openAfter = new Set(input.exchange.listOpenOrders().map((entry) => entry.order.id));
    const evidenceByOrder = new Map<string, HistoricalModeledFillEvidenceV2[]>();
    for (const evidence of fillEvidence) {
      const values = evidenceByOrder.get(evidence.orderId) ?? [];
      values.push(evidence);
      evidenceByOrder.set(evidence.orderId, values);
    }
    const effects = ordersBefore.map((order): HistoricalModeledObservedEffectV2 => {
      const receipt = input.executionRegistry.get(order.id)!;
      const fills = evidenceByOrder.get(order.id) ?? [];
      const status = expired.has(order.id) ? "EXPIRED" as const
        : cancelled.has(order.id) ? "CANCELLED" as const
        : fills.length === 0 ? "NO_FILL" as const
        : openAfter.has(order.id) ? "PARTIAL_FILL" as const
        : "FILLED" as const;
      return Object.freeze({
        effectId: computeSemanticSha256Hex({ cycleId, orderId: order.id, status, fills: fills.map((value) => value.contentDigestHex) }),
        cycleId,
        decisionId: receipt.decisionId,
        decisionContentDigestHex: receipt.decisionContentDigestHex,
        riskReceiptContentDigestHex: receipt.riskReceiptContentDigestHex,
        executionPlanId: receipt.executionPlanId,
        executionPlanContentDigestHex: receipt.executionPlanContentDigestHex,
        executionAttemptId: receipt.executionAttemptId,
        executionAttemptContentDigestHex: receipt.executionAttemptContentDigestHex,
        orderId: order.id,
        orderContentDigestHex: receipt.orderContentDigestHex,
        status,
        fillEvidenceContentDigestHexes: Object.freeze(fills.map((value) => value.contentDigestHex)),
        reportContentDigestHexes: Object.freeze([computeSemanticSha256Hex({
          schemaVersion: "waia.trader.historical_modeled_execution_report.v2",
          source: "MODELED_HISTORICAL",
          capitalEligible: false,
          cycleId,
          decisionId: receipt.decisionId,
          decisionContentDigestHex: receipt.decisionContentDigestHex,
          executionPlanId: receipt.executionPlanId,
          executionPlanContentDigestHex: receipt.executionPlanContentDigestHex,
          orderId: order.id,
          orderContentDigestHex: receipt.orderContentDigestHex,
          executionAttemptId: receipt.executionAttemptId,
          executionAttemptContentDigestHex: receipt.executionAttemptContentDigestHex,
          status,
          fillEvidenceContentDigestHexes: fills.map((value) => value.contentDigestHex),
        })]),
        reasonCodes: Object.freeze(
          status === "NO_FILL" ? ["NO_FILL_ON_CURRENT_BAR"]
          : status === "EXPIRED" ? ["MODELED_ORDER_ELIGIBILITY_WINDOW_EXPIRED"]
          : status === "CANCELLED" ? ["MODELED_PROTECTIVE_CANCEL_EFFECTIVE"]
          : [],
        ),
      });
    });
    if (advanced.fillEvents.length !== fillEvidence.length) {
      throw new Error("HISTORICAL_MODELED_FILL_EVIDENCE_INCOMPLETE");
    }
    await input.persistAdvanceEvidence({
      cycleId,
      fillEvidence: Object.freeze([...fillEvidence]),
      fillDetails: Object.freeze([...fillDetails]),
      effects: Object.freeze([...effects]),
    });
    return Object.freeze({
      fillCount: fillEvidence.length,
      fillEvidence: Object.freeze(fillEvidence),
      fillDetails: Object.freeze(fillDetails),
      accountingFrontierContentDigestHex: accounting.semanticContentDigest,
      accountingFrontier: accounting,
      accountingAdvanced: true,
      effects: Object.freeze(effects),
    });
  };
}
