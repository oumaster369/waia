import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import { computeAccountingSemanticDigest, createInitialAccountingState } from
  "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import type postgres from "postgres";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { createHistoricalSimulatedExchange, type HistoricalSimulatedExchange } from
  "@/lib/trader/execution/historical-simulated-exchange";
import type { HistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model.types";
import {
  createHistoricalSimulationDurableStateSnapshotV2,
  restoreHistoricalModeledExchangeOrdersV2,
  restoreHistoricalSimulationDurableStateSnapshotV2,
  validateHistoricalSimulationResumeCursorV2,
  type HistoricalSimulationAtomicScopeV2,
  type HistoricalSimulationDurableStateSnapshotV2,
  type HistoricalSimulationResumeCursorV2,
} from "./atomic-cycle-commit-v2";
import {
  createHistoricalModeledExecutionRegistryV2,
  type HistoricalModeledExecutionReceiptV2,
  type HistoricalModeledExecutionRegistryV2,
} from "./modeled-capital-binding-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export type HistoricalSimulationKnowledgeRuntimeStateV2 = Readonly<{
  checkpointSequence: number; checkpointContentDigestHex: string;
  durableCheckpointContentDigestHex: string;
  knowledgeContentDigestHex: string; visibleThroughPitAnchor: string;
}>;
export type HistoricalSimulationGuardianRuntimeStateV2 = Readonly<{
  assessmentContentDigestHex: string; posture: "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT"; assessedAt: string;
}>;
export type HistoricalSimulationLearningRuntimeStateV2 = Readonly<{
  appliedClosureWatermarkUtc: string | null; pendingForecastAuthorityContentDigestHexes: readonly string[];
}>;

export type HistoricalSimulationProductionRuntimeStateV2 = Readonly<{
  model: HistoricalExecutionModelV1;
  exchange: HistoricalSimulatedExchange;
  executionRegistry: HistoricalModeledExecutionRegistryV2;
  executionReceipts: readonly HistoricalModeledExecutionReceiptV2[];
  accounting: AccountingFrontierV1;
  knowledge: HistoricalSimulationKnowledgeRuntimeStateV2;
  guardian: HistoricalSimulationGuardianRuntimeStateV2;
  learning: HistoricalSimulationLearningRuntimeStateV2;
}>;

/** Loads inception from the exact 0187 preregistration and its sequence-one 0100 frontier. */
export async function loadHistoricalSimulationInceptionAccountingV2(input: Readonly<{
  tx: postgres.Sql; scope: HistoricalSimulationAtomicScopeV2; preregistrationId: string;
  expectedAuthorityBundleContentDigestHex: string;
}>): Promise<AccountingFrontierV1> {
  const rows = await input.tx<Array<Record<string, unknown>>>`
    SELECT p.authority_bundle_json,p.authority_bundle_digest_hex,
      f.id::text,f.organization_id::text,f.account_key,f.run_id,f.accounting_sequence,f.frontier_as_of,
      f.cash,f.position_quantity_json,f.gross_position_basis_json,f.net_position_basis_json,
      f.gross_realized_pnl,f.net_realized_pnl,f.marks_json,f.equity,f.equity_hwm,f.account_drawdown_bps,
      f.source_fill_id,f.source_economics_digest,f.semantic_content_digest,f.idempotency_key,f.schema_version
    FROM trader_dee659_authority_preregistration_v2 p
    JOIN trader_accounting_frontier f ON f.id=(p.authority_bundle_json->'initialAccountingIdentity'->>'id')::uuid
      AND f.organization_id=p.organization_id AND f.account_key=p.account_id AND f.run_id=p.run_id
    WHERE p.id=${input.preregistrationId}::uuid AND p.organization_id=${input.scope.organizationId}::uuid
      AND p.account_id=${input.scope.accountId} AND p.run_id=${input.scope.runId}
    FOR SHARE`;
  if (rows.length !== 1) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:INCEPTION_NOT_FOUND");
  const row = rows[0]!; const bundle = row.authority_bundle_json as Record<string, unknown>;
  const identity = bundle.initialAccountingIdentity as Record<string, unknown> | undefined;
  if (row.authority_bundle_digest_hex !== input.expectedAuthorityBundleContentDigestHex ||
      computeStableJsonDigest(bundle) !== row.authority_bundle_digest_hex || Number(row.accounting_sequence) !== 1 ||
      identity?.id !== row.id ||
      identity?.semanticContentDigest !== row.semantic_content_digest) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:INCEPTION_IDENTITY");
  }
  const inception = createInitialAccountingState({ organizationId: String(row.organization_id),
    accountKey: String(row.account_key), runId: String(row.run_id), startingCash: String(row.cash),
    frontierAsOf: new Date(row.frontier_as_of as string | Date).toISOString() });
  const empty = (value: unknown) => value !== null && typeof value === "object" && Object.keys(value).length === 0;
  const digest = computeAccountingSemanticDigest(inception);
  if (digest !== row.semantic_content_digest || row.schema_version !== inception.schemaVersion ||
      String(row.gross_realized_pnl) !== "0" || String(row.net_realized_pnl) !== "0" ||
      row.equity !== inception.equity || row.equity_hwm !== inception.equityHwm ||
      Number(row.account_drawdown_bps) !== 0 || row.source_fill_id !== null ||
      !empty(row.position_quantity_json) || !empty(row.gross_position_basis_json) ||
      !empty(row.net_position_basis_json) || !empty(row.marks_json)) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:INCEPTION_ACCOUNTING");
  }
  return Object.freeze({ ...inception, id: String(row.id), sourceFillId: null,
    sourceEconomicsDigest: String(row.source_economics_digest), semanticContentDigest: digest,
    idempotencyKey: String(row.idempotency_key) });
}

/**
 * Reconstructs every mutable in-memory component from the single validated 0188 cursor.
 * There is intentionally no partial/default restore: inception is a separate path and
 * must be built from canonically loaded persisted authorities.
 */
export function restoreHistoricalSimulationProductionRuntimeStateV2(input: Readonly<{
  scope: HistoricalSimulationAtomicScopeV2;
  cursor: HistoricalSimulationResumeCursorV2;
}>): HistoricalSimulationProductionRuntimeStateV2 {
  validateHistoricalSimulationResumeCursorV2(input.cursor, input.scope);
  const cycleScope = { ...input.scope, cycleId: input.cursor.committedCycleId };
  const receiptsState = restoreHistoricalSimulationDurableStateSnapshotV2(
    input.cursor.modeledExecutionRegistrySnapshot, cycleScope,
  ) as Readonly<{ receipts: readonly HistoricalModeledExecutionReceiptV2[] }>;
  const executionRegistry = createHistoricalModeledExecutionRegistryV2();
  for (const receipt of receiptsState.receipts) executionRegistry.register(receipt);
  const model = createHistoricalExecutionModelV1();
  const exchange = createHistoricalSimulatedExchange(model);
  const exchangeState = restoreHistoricalSimulationDurableStateSnapshotV2(
    input.cursor.modeledExchangeSnapshot, cycleScope,
  ) as Readonly<{ checkpoint: Parameters<HistoricalSimulatedExchange["restoreFromCheckpointSlice"]>[0] }>;
  exchange.restoreFromCheckpointSlice(exchangeState.checkpoint,
    restoreHistoricalModeledExchangeOrdersV2(input.cursor.modeledExchangeSnapshot as
      HistoricalSimulationDurableStateSnapshotV2<"MODELED_EXCHANGE">, cycleScope));
  const accounting = restoreHistoricalSimulationDurableStateSnapshotV2(
    input.cursor.accountingFrontierSnapshot, cycleScope,
  ) as AccountingFrontierV1;
  const knowledge = restoreHistoricalSimulationDurableStateSnapshotV2(
    input.cursor.knowledgeSnapshot, cycleScope,
  ) as HistoricalSimulationKnowledgeRuntimeStateV2;
  const guardian = restoreHistoricalSimulationDurableStateSnapshotV2(
    input.cursor.guardianSnapshot, cycleScope,
  ) as HistoricalSimulationGuardianRuntimeStateV2;
  const learning = restoreHistoricalSimulationDurableStateSnapshotV2(
    input.cursor.learningSnapshot, cycleScope,
  ) as HistoricalSimulationLearningRuntimeStateV2;
  return Object.freeze({ model, exchange, executionRegistry,
    executionReceipts: Object.freeze([...receiptsState.receipts]), accounting, knowledge, guardian, learning });
}

export function snapshotHistoricalSimulationProductionRuntimeStateV2(input: Readonly<{
  scope: HistoricalSimulationAtomicScopeV2; cycleId: string;
  runtime: HistoricalSimulationProductionRuntimeStateV2;
}>): Readonly<{
  knowledgeSnapshot: HistoricalSimulationDurableStateSnapshotV2<"KNOWLEDGE">;
  modeledExecutionRegistrySnapshot: HistoricalSimulationDurableStateSnapshotV2<"MODELED_EXECUTION_REGISTRY">;
  modeledExchangeSnapshot: HistoricalSimulationDurableStateSnapshotV2<"MODELED_EXCHANGE">;
  accountingFrontierSnapshot: HistoricalSimulationDurableStateSnapshotV2<"ACCOUNTING_FRONTIER">;
  guardianSnapshot: HistoricalSimulationDurableStateSnapshotV2<"GUARDIAN">;
  learningSnapshot: HistoricalSimulationDurableStateSnapshotV2<"LEARNING">;
}> {
  const identity = { ...input.scope, cycleId: input.cycleId };
  const openOrders = input.runtime.exchange.listOpenOrders().map(({ order }) => {
    const body = { ...order, createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString() };
    return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
  });
  return Object.freeze({
    knowledgeSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity,
      stateKind: "KNOWLEDGE", state: input.runtime.knowledge }),
    modeledExecutionRegistrySnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity,
      stateKind: "MODELED_EXECUTION_REGISTRY", state: { receipts: input.runtime.executionReceipts } }),
    modeledExchangeSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity,
      stateKind: "MODELED_EXCHANGE", state: { checkpoint: input.runtime.exchange.buildCheckpointSlice(), openOrders } }),
    accountingFrontierSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity,
      stateKind: "ACCOUNTING_FRONTIER", state: input.runtime.accounting }),
    guardianSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity,
      stateKind: "GUARDIAN", state: input.runtime.guardian }),
    learningSnapshot: createHistoricalSimulationDurableStateSnapshotV2({ ...identity,
      stateKind: "LEARNING", state: input.runtime.learning }),
  });
}
