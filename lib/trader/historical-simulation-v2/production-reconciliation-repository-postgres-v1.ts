import type postgres from "postgres";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { subtractDecimal } from "@/lib/trader/risk/numeric";
import { computeEconomicsContentDigest } from "@/lib/trader/execution/fill-economics";
import { historicalFillId, fillExecutionEconomicsRowId } from "@/lib/trader/execution/deterministic-execution-id";
import type { CostedFillEconomics } from "@/lib/trader/execution/historical-execution-model.types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HistoricalSimulationAtomicScopeV2, HistoricalSimulationResumeCursorV2 } from "./atomic-cycle-commit-v2";
import { selectValidatedHistoricalReconciliationStateV1 } from "./production-runtime-state-v2";
import type { HistoricalSimulationProductionRuntimeStateV2 } from "./production-runtime-state-v2";
import {
  HISTORICAL_RECONCILIATION_PROFILE_V1, createHistoricalReconciliationBudgetV1,
  assertHistoricalReconciliationFrontierV1, projectHistoricalReconciliationAccountingV1,
  advanceHistoricalReconciliationV1, sealHistoricalReconciliationCycleV1,
  refuseHistoricalReconciliationV1, type HistoricalReconciliationFrontierV1,
  type HistoricalReconciliationParentV1, type HistoricalReconciliationAccountingV1,
  type HistoricalReconciliationFillV1, type HistoricalReconciliationEconomicsV1,
  type HistoricalReconciliationConsumedV1, historicalReconciliationInstantV1,
} from "./production-reconciliation-frontier-v1";

const refuse: (reason: string) => never = refuseHistoricalReconciliationV1;
type Scope = HistoricalSimulationAtomicScopeV2;
type Mode = Readonly<{ mode: "LEGACY" | "PROFILE"; partition: string | null; symbol: string | null;
  profile: string | null; genesisId: string | null }>;
type ParentSource = Readonly<{
  orderId: string; organizationId: string; accountId: string; runId: string; symbol: string;
  side: "buy" | "sell"; quantity: string; filledQuantity: string; state: string; stateVersion: number;
  venue: string; executionMode: string; credentialId: string | null;
  clientOrderId: string; idempotencyKey: string; riskDecisionId: string; allocationDecisionId: string | null;
  type: string; price: string | null; riskAllowanceId: string | null; riskAllowanceBindingDigest: string | null;
}>;
type EventSource = Readonly<{ id: string; orderId: string; sequence: number; fromState: string | null;
  toState: string; eventType: string; payload: string | null; occurredAt: string }>;
const orderProjection = `jsonb_build_object('orderId',o.id::text,'organizationId',o.organization_id::text,
  'accountId',o.historical_account_key,'runId',o.historical_run_id,'symbol',o.symbol,'side',o.side,
  'quantity',o.quantity,'filledQuantity',o.filled_quantity,'state',o.state,'stateVersion',o.state_version,
  'venue',o.venue,'executionMode',o.execution_mode,'credentialId',o.credential_id::text,
  'clientOrderId',o.client_order_id,'idempotencyKey',o.idempotency_key,'riskDecisionId',o.risk_decision_id,
  'allocationDecisionId',o.allocation_decision_id,'type',o.type,'price',o.price,
  'riskAllowanceId',o.risk_allowance_id::text,'riskAllowanceBindingDigest',o.risk_allowance_binding_digest)`;
const creationDigest = (p: ParentSource) => {
  const immutable = { ...p } as { -readonly [K in keyof ParentSource]?: ParentSource[K] };
  delete immutable.filledQuantity; delete immutable.state; delete immutable.stateVersion;
  return computeSemanticSha256Hex(immutable);
};
const accountingProjection = `jsonb_build_object('id',a.id::text,'digest',a.semantic_content_digest,
  'sequence',a.accounting_sequence,'sourceFillId',a.source_fill_id::text,'economicsDigest',a.source_economics_digest,
  'organizationId',a.organization_id::text,'accountId',a.account_key,'runId',a.run_id,
  'cash',a.cash,'positions',a.position_quantity_json)`;
type StoredAccounting = Omit<HistoricalReconciliationAccountingV1, "consumedFillCount" | "lastConsumedFillId">;
const same = (a: unknown, b: unknown) => computeSemanticSha256Hex(a) === computeSemanticSha256Hex(b);

/** Only called by the private, already locked SERIALIZABLE production owner. No pool/transaction/certifier injection. */
export function createHistoricalReconciliationRepositoryV1(tx: postgres.Sql, scopeInput: Scope) {
  const scope = Object.freeze({ ...scopeInput });
  const prefix = [scope.organizationId, scope.accountId, scope.runId];
  const budget = createHistoricalReconciliationBudgetV1();
  // SQL fragments are closed constants below. Metadata is materialized first; source bodies
  // cannot reach the application until all selected sizes/cardinalities pass this budget.
  const read = async <T>(query: string, parameters: readonly unknown[], maximum: number): Promise<readonly T[]> => {
    const bounded = `SELECT projection FROM (${query}) selected LIMIT ${maximum + 1}`;
    const sizes = await tx.unsafe<Array<{ bytes: number }>>(
      `SELECT octet_length(projection::text) AS bytes FROM (${bounded}) bounded`, [...parameters] as never[]);
    if (sizes.length > maximum) refuse("SOURCE_CARDINALITY");
    for (const row of sizes) budget.charge(Number(row.bytes));
    const rows = await tx.unsafe<Array<{ projection: T }>>(bounded, [...parameters] as never[]);
    if (rows.length !== sizes.length) refuse("SOURCE_SNAPSHOT");
    return rows.map((row) => row.projection);
  };
  const readMode = async (): Promise<Mode | null> => {
    const rows = await read<Mode>(`SELECT jsonb_build_object('mode',mode,'profile',profile,
      'partition',partition,'symbol',symbol,'genesisId',genesis_id::text) projection
      FROM trader_historical_reconciliation_scope_mode_v1
      WHERE organization_id=$1::uuid AND account_id=$2 AND run_id=$3`, prefix, 1);
    const value = rows[0] ?? null;
    if (value && value.mode !== "LEGACY" && value.mode !== "PROFILE") refuse("MODE");
    if (value?.mode === "PROFILE" && (value.profile !== HISTORICAL_RECONCILIATION_PROFILE_V1 ||
        value.partition !== scope.split || !value.genesisId)) refuse("MODE_SCOPE");
    return value;
  };
  const loadFrontier = async (sequence: number): Promise<HistoricalReconciliationFrontierV1> => {
    const rows = await read<{ body: HistoricalReconciliationFrontierV1; id: string; contentDigest: string;
      profile: string; partition: string; symbol: string; previousId: string | null; genesisId: string | null;
      checkpointDigest: string | null }>(`SELECT jsonb_build_object('body',body_json,'id',id::text,
      'contentDigest',content_digest,'profile',profile,'partition',partition,'symbol',symbol,
      'previousId',previous_id::text,'genesisId',genesis_id::text,'checkpointDigest',checkpoint_digest) projection
      FROM trader_historical_reconciliation_frontier_v1
      WHERE organization_id=$1::uuid AND account_id=$2 AND run_id=$3 AND cycle_sequence=$4`, [...prefix, sequence], 1);
    if (rows.length !== 1) refuse("FRONTIER_MISSING");
    const row = rows[0]!; const value = row.body;
    assertHistoricalReconciliationFrontierV1(value, scope);
    if (row.id !== value.id || row.contentDigest !== value.contentDigest || row.profile !== value.profile ||
        row.partition !== value.scope.split || row.symbol !== value.symbol || row.previousId !== value.previousId ||
        row.genesisId !== value.genesisId || row.checkpointDigest !== value.checkpointDigest) refuse("FRONTIER_COLUMNS");
    if (value.cycleSequence !== sequence) refuse("FRONTIER_SEQUENCE");
    return value;
  };
  const verifyAccounting = async (expected: readonly HistoricalReconciliationAccountingV1[]) => {
    if (expected.length < 1 || expected.length > 2) refuse("ACCOUNTING_CARDINALITY");
    const rows = await read<StoredAccounting>(`SELECT ${accountingProjection} projection FROM trader_accounting_frontier a
      WHERE a.organization_id=$1::uuid AND a.account_key=$2 AND a.run_id=$3
      AND a.accounting_sequence BETWEEN $4 AND $5 ORDER BY a.accounting_sequence`,
    [...prefix, expected[0]!.sequence, expected.at(-1)!.sequence], 2);
    if (rows.length !== expected.length) refuse("ACCOUNTING_SOURCE_MEMBERSHIP");
    rows.forEach((row, i) => {
      const source = { ...expected[i]! } as { -readonly [K in keyof HistoricalReconciliationAccountingV1]?: HistoricalReconciliationAccountingV1[K] };
      delete source.consumedFillCount; delete source.lastConsumedFillId;
      if (!same(row, source)) refuse("ACCOUNTING_SOURCE_CONTENT");
    });
  };
  const parentSources = (ids: readonly string[]) => read<ParentSource>(
    `SELECT ${orderProjection} projection FROM trader_orders o
      WHERE o.organization_id=$1::uuid AND o.historical_account_key=$2 AND o.historical_run_id=$3
      AND o.id=ANY($4::uuid[]) ORDER BY o.id`, [...prefix, ids], 2);
  const fillSources = async (parent: string, selectedIds?: readonly string[]) => {
    const select = selectedIds ? " AND f.id=ANY($5::uuid[])" : "";
    const params = selectedIds ? [...prefix, parent, selectedIds] : [...prefix, parent];
    const fills = await read<HistoricalReconciliationFillV1>(`SELECT jsonb_build_object('fillId',f.id::text,
      'parentId',f.order_id::text,'organizationId',f.organization_id::text,'accountId',o.historical_account_key,
      'runId',o.historical_run_id,'symbol',o.symbol,'side',o.side,'quantity',f.quantity,
      'price',f.price,'fee',f.fee,'feeAsset',f.fee_asset,'exchangeTradeId',f.exchange_trade_id,
      'executedAt',extract(epoch FROM f.executed_at)*1000) projection
      FROM trader_fills f JOIN trader_orders o ON o.organization_id=f.organization_id AND o.id=f.order_id
      WHERE o.organization_id=$1::uuid AND o.historical_account_key=$2 AND o.historical_run_id=$3
      AND o.id=$4::uuid${select} ORDER BY f.id`, params, 3);
    // Independent direction: query economics by actual parent/scope, not by a join that hides
    // an economics/order mismatch or missing economics for a real fill.
    const economics = await read<HistoricalReconciliationEconomicsV1>(`SELECT jsonb_build_object('fillId',e.fill_id::text,
      'parentId',e.order_id::text,'organizationId',e.organization_id::text,'accountId',o.historical_account_key,
      'runId',o.historical_run_id,'symbol',e.symbol,'side',e.side,'quantity',e.quantity,
      'economicsRowId',e.id::text,'economicsDigest',e.economics_content_digest,'netCashEffect',e.net_cash_effect,
      'fillSequence',e.fill_sequence,'sourceBarIndex',e.source_bar_index,
      'exchangeTradeId',e.exchange_trade_id,'schemaVersion',e.schema_version,
      'sourceEconomics',jsonb_build_object('executionFactKind',e.execution_fact_kind,
        'grossFillPrice',e.gross_fill_price,'grossNotional',e.gross_notional,'feeAmount',e.fee_amount,
        'feeAsset',e.fee_asset,'spreadCost',e.spread_cost,'impactSlippageCost',e.impact_slippage_cost,
        'totalExecutionCost',e.total_execution_cost,'netFillPrice',e.net_fill_price,'netCashEffect',e.net_cash_effect,
        'executionModelId',e.execution_model_id,'executionModelSchemaVersion',e.execution_model_schema_version,
        'simulatorId',e.simulator_id,'simulatorVersion',e.simulator_version,'sourceBarIndex',e.source_bar_index,
        'fillSequence',e.fill_sequence,'symbol',e.symbol,'side',e.side,'quantity',e.quantity,
        'remainingQuantityAfter',e.remaining_quantity_after,'submitLatencyMs',e.submit_latency_ms,'cancelLatencyMs',e.cancel_latency_ms,
        'economicsContentDigest',e.economics_content_digest,'sourceBarTimestamp',extract(epoch FROM e.source_bar_timestamp)*1000,
        'acceptedAt',extract(epoch FROM e.accepted_at)*1000,'fillTimestamp',extract(epoch FROM e.fill_timestamp)*1000)) projection
      FROM trader_fill_execution_economics e JOIN trader_orders o ON o.organization_id=e.organization_id AND o.id=e.order_id
      WHERE o.organization_id=$1::uuid AND o.historical_account_key=$2 AND o.historical_run_id=$3
      AND o.id=$4::uuid${selectedIds ? " AND e.fill_id=ANY($5::uuid[])" : ""} ORDER BY e.fill_id`, params, 3);
    for (const f of fills) historicalReconciliationInstantV1(f.executedAt);
    for (const e of economics) {
      const full: CostedFillEconomics = { ...e.sourceEconomics,
        acceptedAt: new Date(historicalReconciliationInstantV1(e.sourceEconomics.acceptedAt)),
        fillTimestamp: new Date(historicalReconciliationInstantV1(e.sourceEconomics.fillTimestamp)),
        sourceBarTimestamp: new Date(historicalReconciliationInstantV1(e.sourceEconomics.sourceBarTimestamp)) };
      if (computeEconomicsContentDigest(full) !== e.economicsDigest || full.economicsContentDigest !== e.economicsDigest ||
          fillExecutionEconomicsRowId(e.fillId) !== e.economicsRowId ||
          historicalFillId({ organizationId: scope.organizationId, orderId: e.parentId,
            fillSequence: e.fillSequence, sourceBarIndex: e.sourceBarIndex }) !== e.fillId) refuse("ECONOMICS_SOURCE_CONTENT");
    }
    if (fills.length !== economics.length || fills.some((f, i) => {
      const e = economics[i]!;
      return f.fillId !== e.fillId || f.parentId !== e.parentId || f.organizationId !== e.organizationId ||
        f.accountId !== e.accountId || f.runId !== e.runId || f.symbol !== e.symbol || f.side !== e.side || f.quantity !== e.quantity ||
        f.price !== e.sourceEconomics.netFillPrice || f.fee !== e.sourceEconomics.feeAmount ||
        f.feeAsset !== e.sourceEconomics.feeAsset || f.exchangeTradeId !== e.exchangeTradeId ||
        f.executedAt !== e.sourceEconomics.fillTimestamp;
    })) refuse("PARENT_FILL_MEMBERSHIP");
    if (selectedIds && (fills.length !== selectedIds.length || fills.some((f) => !selectedIds.includes(f.fillId)))) refuse("HISTORICAL_FILL_MEMBERSHIP");
    return { fills, economics };
  };
  const eventSource = async (orderId: string, selectedSequence?: number) => {
    const rows = await read<EventSource>(`SELECT jsonb_build_object('id',e.id::text,'orderId',e.order_id::text,
      'sequence',e.seq,'fromState',e.from_state,'toState',e.to_state,'eventType',e.event_type,
      'payload',e.payload,'occurredAt',to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) projection
      FROM trader_order_events e JOIN trader_orders o ON o.id=e.order_id AND o.organization_id=e.organization_id
      WHERE o.organization_id=$1::uuid AND o.historical_account_key=$2 AND o.historical_run_id=$3
      AND o.id=$4::uuid${selectedSequence === undefined ? " ORDER BY e.seq DESC LIMIT 1" : " AND e.seq=$5"}`,
    selectedSequence === undefined ? [...prefix, orderId] : [...prefix, orderId, selectedSequence], 1);
    if (rows.length !== 1) refuse("PARENT_STATE_EVENT"); return rows[0]!;
  };
  const observeParents = async (runtime: HistoricalSimulationProductionRuntimeStateV2,
    previousActive: HistoricalReconciliationParentV1 | null,
    earlierEntries: ReturnType<HistoricalSimulationProductionRuntimeStateV2["exchange"]["listOpenOrders"]>) => {
    const open = runtime.exchange.listOpenOrders();
    if (open.length > 1) refuse("PARENT_CARDINALITY");
    const ids = [...new Set([...(previousActive ? [previousActive.orderId] : []), ...open.map((p) => p.order.id)])].sort();
    const sources = ids.length ? await parentSources(ids) : [];
    if (sources.length !== ids.length) refuse("PARENT_SOURCE_MISSING");
    const touched: HistoricalReconciliationParentV1[] = [];
    const fills: HistoricalReconciliationFillV1[] = []; const economics: HistoricalReconciliationEconomicsV1[] = [];
    for (const source of sources) {
      const active = open.find((p) => p.order.id === source.orderId);
      const old = previousActive?.orderId === source.orderId ? previousActive : null;
      const receipt = runtime.executionRegistry.get(source.orderId);
      if (!receipt || source.venue !== "HISTORICAL_SIMULATED_EXCHANGE" || source.executionMode !== "mock" || source.credentialId !== null ||
          source.symbol !== receipt.symbol || source.quantity !== receipt.quantity || source.side !== receipt.side ||
          source.type !== "market" || source.price !== null || source.riskAllowanceId !== null || source.riskAllowanceBindingDigest !== null ||
          source.clientOrderId !== `hsv2-${receipt.executionAttemptId}` ||
          source.idempotencyKey !== `historical-modeled-v2-${receipt.contentDigestHex}` ||
          source.riskDecisionId !== receipt.riskVerdictId || source.allocationDecisionId !== receipt.decisionId) refuse("PARENT_SOURCE_IDENTITY");
      const persisted = await fillSources(source.orderId);
      const refs = persisted.economics.map((e, index) => ({ fillId: e.fillId, economicsRowId: e.economicsRowId,
        economicsDigest: e.economicsDigest, fillSourceDigest: computeSemanticSha256Hex(persisted.fills[index]),
        economicsSourceDigest: computeSemanticSha256Hex(e) }));
      if (old && old.fillReferences.some((ref) => !refs.some((next) => same(ref, next)))) refuse("PARENT_PREFIX_CHANGED");
      for (const f of persisted.fills) if (!old?.fillReferences.some((ref) => ref.fillId === f.fillId)) fills.push(f);
      for (const e of persisted.economics) if (!old?.fillReferences.some((ref) => ref.fillId === e.fillId)) economics.push(e);
      const event = await eventSource(source.orderId);
      if (event.toState !== source.state) refuse("PARENT_STATE_EVENT");
      if (active && (active.order.stateVersion !== source.stateVersion || active.order.state !== source.state ||
          active.order.filledQuantity !== source.filledQuantity)) refuse("PARENT_CURRENT_STATE");
      // The exchange mutates these actual entry objects before deleting a closed parent.
      // Keep that owned reference through this one cycle; never invent eligible/cancel timing.
      const observed = active ?? earlierEntries.find((entry) => entry.order.id === source.orderId);
      if (!observed) refuse("PARENT_OBSERVATION_MISSING");
      const p: HistoricalReconciliationParentV1 = {
        orderId: source.orderId, organizationId: source.organizationId, accountId: source.accountId, runId: source.runId,
        symbol: source.symbol, receiptDigest: receipt.contentDigestHex, creationDigest: creationDigest(source),
        state: source.state, stateVersion: source.stateVersion, side: source.side, quantity: source.quantity,
        filledQuantity: source.filledQuantity,
        remainingQuantity: observed.remainingQty,
        acceptedAt: observed.acceptedAtTs, firstEligibleAt: observed.firstEligibleTs,
        eligibleBarsSeen: observed.sameSymbolEligibleBarsSeen, fillSequence: observed.fillSequence,
        pendingCancel: observed.pendingCancel ?? null,
        stateEvent: { id: event.id, sequence: event.sequence, digest: computeSemanticSha256Hex(event) }, fillReferences: refs,
      };
      if (subtractDecimal(p.quantity, p.filledQuantity) !== p.remainingQuantity) refuse("PARENT_QUANTITY");
      if (old && old.creationDigest !== p.creationDigest) refuse("PARENT_CREATION_CHANGED");
      touched.push(p);
    }
    const activeParent = touched.find((p) => open[0]?.order.id === p.orderId) ?? null;
    return { activeParent, touchedParents: touched, fills, economics };
  };
  const verifyGenesis = async (genesis: HistoricalReconciliationFrontierV1) => {
    if (genesis.cycleSequence !== -1) refuse("GENESIS_SHAPE");
    await verifyAccounting([genesis.accounting]);
    const rows = await read<{ body: Record<string, unknown>; digest: string }>(`SELECT
      jsonb_build_object('body',authority_bundle_json,'digest',authority_bundle_digest_hex) projection
      FROM trader_dee659_authority_preregistration_v2 WHERE organization_id=$1::uuid AND account_id=$2 AND run_id=$3
      AND id=$4::uuid`, [...prefix, genesis.inceptionAuthorityId], 1);
    const source = rows[0];
    const identity = source?.body.initialAccountingIdentity as Record<string, unknown> | undefined;
    if (rows.length !== 1 || source!.digest !== genesis.authorityDigest || computeStableJsonDigest(source!.body) !== source!.digest ||
        identity?.id !== genesis.inceptionAccountingId || identity?.semanticContentDigest !== genesis.inceptionAccountingDigest) refuse("GENESIS_AUTHORITY");
  };
  const validateCursor = async (cursor: HistoricalSimulationResumeCursorV2, historical: boolean,
    runtime?: HistoricalSimulationProductionRuntimeStateV2 | null) => {
    if (!historical && !runtime) refuse("CONTINUATION_RUNTIME_MISSING");
    const value = await loadFrontier(cursor.nextCycleSequence - 1);
    if (value.checkpointDigest !== cursor.contentDigestHex || value.cycleId !== cursor.committedCycleId ||
        value.recordIndex !== cursor.nextRecordIndex - 1) refuse("CHECKPOINT_IDENTITY");
    const prior = await loadFrontier(value.cycleSequence - 1);
    if (prior.id !== value.previousId || prior.contentDigest !== value.previousDigest || prior.genesisId !== null && prior.genesisId !== value.genesisId) refuse("PREDECESSOR");
    const genesis = prior.cycleSequence === -1 ? prior : await loadFrontier(-1);
    await verifyGenesis(genesis);
    if (genesis.id !== value.genesisId || value.modelDigest !== genesis.modelDigest || value.symbol !== genesis.symbol ||
        value.inceptionAuthorityId !== genesis.inceptionAuthorityId || value.authorityDigest !== genesis.authorityDigest) refuse("GENESIS_CHAIN");
    const mode = await readMode();
    if (mode?.mode !== "PROFILE" || mode.genesisId !== genesis.id || mode.symbol !== value.symbol) refuse("MODE_SCOPE");
    const selected = selectValidatedHistoricalReconciliationStateV1(cursor);
    if (!same(projectHistoricalReconciliationAccountingV1(runtime?.accounting ?? selected.accounting), value.accounting)) refuse("RESTORE_ACCOUNTING");
    await verifyAccounting(value.steps);
    // Historical retry reads only the selected N references. Never compare N to today's
    // mutable quantity/stateVersion or enumerate fills added after N on the same parent.
    const parents = value.touchedParentsAfter.length ? await parentSources(value.touchedParentsAfter.map((p) => p.orderId)) : [];
    if (parents.length !== value.touchedParentsAfter.length) refuse("PARENT_SOURCE_MISSING");
    const currentFills: HistoricalReconciliationFillV1[] = [];
    const currentEconomics: HistoricalReconciliationEconomicsV1[] = [];
    for (const p of value.touchedParentsAfter) {
      const source = parents.find((row) => row.orderId === p.orderId)!;
      if (creationDigest(source) !== p.creationDigest) refuse("PARENT_CREATION_CHANGED");
      const event = await eventSource(p.orderId, p.stateEvent.sequence);
      if (event.id !== p.stateEvent.id || computeSemanticSha256Hex(event) !== p.stateEvent.digest || event.toState !== p.state) refuse("HISTORICAL_PARENT_EVENT");
      const sources = await fillSources(p.orderId, p.fillReferences.map((f) => f.fillId));
      for (const f of sources.fills) if (!prior.activeParentAfter?.fillReferences.some((ref) => ref.fillId === f.fillId)) currentFills.push(f);
      for (const e of sources.economics) if (!prior.activeParentAfter?.fillReferences.some((ref) => ref.fillId === e.fillId)) currentEconomics.push(e);
      if (sources.economics.some((e) => !p.fillReferences.some((f) => f.fillId === e.fillId &&
          f.economicsRowId === e.economicsRowId && f.economicsDigest === e.economicsDigest &&
          f.fillSourceDigest === computeSemanticSha256Hex(sources.fills.find((fill) => fill.fillId === e.fillId)) &&
          f.economicsSourceDigest === computeSemanticSha256Hex(e)))) refuse("HISTORICAL_PARENT_FILL");
      if (!historical && (source.stateVersion !== p.stateVersion || source.state !== p.state || source.filledQuantity !== p.filledQuantity)) refuse("PARENT_CURRENT_STATE");
    }
    const consumed = value.steps.filter((step) => step.sourceFillId !== null).map((step) => ({ fillId: step.sourceFillId!,
      accountingId: step.id, accountingSequence: step.sequence, accountingDigest: step.digest, economicsDigest: step.economicsDigest }));
    const rebuilt = sealHistoricalReconciliationCycleV1({ delta: advanceHistoricalReconciliationV1({
      previous: prior, cycleId: value.cycleId!, cycleSequence: value.cycleSequence, recordIndex: value.recordIndex,
      membershipDigest: value.membershipDigest!, marketDigest: value.marketDigest!, releaseSha: value.releaseSha,
      steps: value.steps, fills: currentFills, economics: currentEconomics, consumed }),
      checkpointDigest: value.checkpointDigest!, observations: value.observations,
      activeParent: value.activeParentAfter, touchedParents: value.touchedParentsAfter });
    if (!same(rebuilt, value)) refuse("HISTORICAL_DELTA_REPLAY");
    const open = runtime ? runtime.exchange.listOpenOrders() : selected.open;
    if (open.length !== (value.activeParentAfter ? 1 : 0)) refuse("RESTORE_PARENT");
    if (value.activeParentAfter) {
      const p = value.activeParentAfter; const actual = open[0]!;
      if (actual.order.id !== p.orderId || actual.order.stateVersion !== p.stateVersion || actual.order.state !== p.state ||
          actual.filledQty !== p.filledQuantity || actual.remainingQty !== p.remainingQuantity || actual.fillSequence !== p.fillSequence ||
          actual.sameSymbolEligibleBarsSeen !== p.eligibleBarsSeen || actual.acceptedAtTs !== p.acceptedAt || actual.firstEligibleTs !== p.firstEligibleAt ||
          !same(actual.pendingCancel ?? null, p.pendingCancel)) refuse("RESTORE_PARENT");
    }
    return value;
  };
  const append = async (value: HistoricalReconciliationFrontierV1) => {
    assertHistoricalReconciliationFrontierV1(value, scope);
    const body = JSON.stringify(value); budget.charge(Buffer.byteLength(body));
    await tx`INSERT INTO trader_historical_reconciliation_frontier_v1
      (id,organization_id,account_id,run_id,cycle_sequence,partition,profile,symbol,
       previous_id,genesis_id,checkpoint_digest,content_digest,body_json)
      VALUES (${value.id}::uuid,${scope.organizationId}::uuid,${scope.accountId},${scope.runId},${value.cycleSequence},
        ${scope.split},${value.profile},${value.symbol},${value.previousId}::uuid,${value.genesisId}::uuid,
        ${value.checkpointDigest},${value.contentDigest},${body}::jsonb)`;
  };
  return Object.freeze({ readMode, loadFrontier, validateCursor, observeParents, verifyAccounting, append,
    async enroll(genesis: HistoricalReconciliationFrontierV1) {
      assertHistoricalReconciliationFrontierV1(genesis, scope);
      if (genesis.cycleSequence !== -1) refuse("GENESIS_SHAPE");
      await tx`INSERT INTO trader_historical_reconciliation_scope_mode_v1
        (organization_id,account_id,run_id,mode,profile,partition,symbol,genesis_id)
        VALUES (${scope.organizationId}::uuid,${scope.accountId},${scope.runId},'PROFILE',
          ${HISTORICAL_RECONCILIATION_PROFILE_V1},${scope.split},${genesis.symbol},${genesis.id}::uuid)
        ON CONFLICT (organization_id,account_id,run_id) DO NOTHING`;
      const mode = await readMode();
      if (!mode) refuse("MODE_WINNER_NOT_VISIBLE");
      if (mode.mode !== "PROFILE" || mode.genesisId !== genesis.id || mode.symbol !== genesis.symbol) refuse("LEGACY_PREFIX_UNSUPPORTED");
      await verifyGenesis(genesis);
      await append(genesis);
    },
    async readConsumed(steps: readonly HistoricalReconciliationAccountingV1[]): Promise<readonly HistoricalReconciliationConsumedV1[]> {
      await verifyAccounting(steps);
      return steps.filter((step) => step.sourceFillId !== null).map((step) => ({ fillId: step.sourceFillId!,
        accountingId: step.id, accountingSequence: step.sequence, accountingDigest: step.digest, economicsDigest: step.economicsDigest }));
    },
  });
}
export type HistoricalReconciliationRepositoryV1 = ReturnType<typeof createHistoricalReconciliationRepositoryV1>;
