import type { AccountingFrontierRepository } from "@/lib/trader/accounting/accounting-frontier-repository-postgres";
import { advanceAccountingFrontier } from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import {
  applyHistoricalExecutionEconomics,
  buildRecordFillPayload,
  type HistoricalExecutionPersistencePort,
  type HistoricalSimulatedExchange,
} from "@/lib/trader/execution/historical-simulated-exchange";
import type { HistoricalExecutionModelV1, SimulatedFillEvent } from "@/lib/trader/execution/historical-execution-model.types";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { Bar } from "@/lib/trader/intelligence/types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HtxVolumeQualificationReceiptV1 } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { addDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

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

export type AdvanceHistoricalModeledExecutionV2Input = Readonly<{
  context: OrgContext;
  accountKey: string;
  runId: string;
  exchange: HistoricalSimulatedExchange;
  model: HistoricalExecutionModelV1;
  persistence: HistoricalExecutionPersistencePort;
  accountingRepository: AccountingFrontierRepository;
  resolveMarketCycle(cycleId: string): Promise<HistoricalSealedMarketCycleV2>;
  initialAccountingFrontier(cycle: HistoricalSealedMarketCycleV2): Promise<AccountingFrontierV1>;
  refreshAccountState(): Promise<AccountRiskState>;
  reconcileOrder(orderId: string): Promise<void>;
  resolveLatestOrder?(orderId: string): Promise<OrderRow | null>;
  persistFillEvidence(evidence: HistoricalModeledFillEvidenceV2): Promise<void>;
}>;

export type AdvanceHistoricalModeledExecutionV2Result = Readonly<{
  fillCount: number;
  fillEvidence: readonly HistoricalModeledFillEvidenceV2[];
  accountingFrontierContentDigestHex: string;
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function bodyOfMarketCycle(input: Omit<HistoricalSealedMarketCycleV2, "contentDigestHex">) {
  return {
    ...input,
    closedBar: { ...input.closedBar },
    htxVolumeAuthorityReceipt: { ...input.htxVolumeAuthorityReceipt },
    htxVolumeRaw: { ...input.htxVolumeRaw },
  };
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
    value.closedBar.symbol !== value.htxVolumeAuthorityReceipt.symbol ||
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
          marks: { [event.symbol]: { price: event.sourceBar.close, barCloseTime: event.sourceBar.barCloseTime } },
          frontierAsOf: event.fillTimestamp.toISOString(),
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
        await input.persistFillEvidence(evidence);
        return updated;
      },
    };
    await input.exchange.advanceOnClosedBar({
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
    if (!DIGEST.test(accounting.semanticContentDigest)) {
      throw new Error("HISTORICAL_MODELED_ACCOUNTING_FRONTIER_UNSEALED");
    }
    return Object.freeze({
      fillCount: fillEvidence.length,
      fillEvidence: Object.freeze(fillEvidence),
      accountingFrontierContentDigestHex: accounting.semanticContentDigest,
    });
  };
}
