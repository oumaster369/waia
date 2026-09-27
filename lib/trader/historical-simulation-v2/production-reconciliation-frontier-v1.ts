import { reconcileAccountingInvariants } from "@/lib/trader/accounting/accounting-reconciliation";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import { buildRecordFillPayload } from "@/lib/trader/execution/historical-simulated-exchange";
import type { CostedFillEconomics } from "@/lib/trader/execution/historical-execution-model.types";
import type { HistoricalModeledFillDetailV2 } from "./modeled-execution-advance-v2";
import { deterministicExecutionUuidV2 } from "@/lib/trader/execution/v2/contracts";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { addDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import type { HistoricalSimulationAtomicScopeV2 } from "./atomic-cycle-commit-v2";

/** Private producer grammar. Its hashes are content identities, not source authority. */
export const HISTORICAL_RECONCILIATION_PROFILE_V1 = "HISTORICAL_PG_RECONCILIATION_V1" as const;
export const HISTORICAL_RECONCILIATION_SCHEMA_V1 = "waia.trader.historical_reconciliation.v1" as const;
export const HISTORICAL_RECONCILIATION_PROJECTION_BYTES_V1 = 1_048_576;
export const HISTORICAL_RECONCILIATION_AGGREGATE_BYTES_V1 = 8_388_608;
export const HISTORICAL_RECONCILIATION_PHASES_V1 = [
  "frontier_mutation", "before_guardian", "before_cycle_complete",
] as const;
type Scope = HistoricalSimulationAtomicScopeV2;
type Phase = (typeof HISTORICAL_RECONCILIATION_PHASES_V1)[number];
const HEX = /^[0-9a-f]{64}$/;
export function refuseHistoricalReconciliationV1(reason: string): never {
  throw new Error(`HISTORICAL_RECONCILIATION_REFUSED:${reason}`);
}
const refuse: (reason: string) => never = refuseHistoricalReconciliationV1;
const ensure = (ok: unknown, reason: string): void => { if (!ok) refuse(reason); };

/** One budget per owner attempt; charge metadata before loading a PG JSON value. */
export function createHistoricalReconciliationBudgetV1() {
  let used = 0; let failed = false;
  return Object.freeze({
    charge(bytes: number) {
      if (failed || !Number.isSafeInteger(bytes) || bytes < 0 ||
          bytes > HISTORICAL_RECONCILIATION_PROJECTION_BYTES_V1 ||
          bytes > HISTORICAL_RECONCILIATION_AGGREGATE_BYTES_V1 - used) {
        failed = true; refuse("RESOURCE_ENVELOPE");
      }
      used += bytes;
    },
    get usedBytes() { return used; },
  });
}
export type HistoricalReconciliationBudgetV1 = ReturnType<typeof createHistoricalReconciliationBudgetV1>;

/** Preflight in-memory owned projections before canonical serialization/copying. */
function assertBoundedProjection(value: unknown): void {
  let bytes = 0; const ancestors = new Set<object>();
  const add = (size: number) => {
    bytes += size;
    if (bytes > HISTORICAL_RECONCILIATION_PROJECTION_BYTES_V1) refuse("RESOURCE_ENVELOPE");
  };
  const quotedString = (value: string) => {
    add(2);
    for (const character of value) {
      const point = character.codePointAt(0)!;
      add(character === '"' || character === "\\" || [8, 9, 10, 12, 13].includes(point) ? 2 :
        point < 32 || point >= 0xd800 && point <= 0xdfff ? 6 : Buffer.byteLength(character, "utf8"));
    }
  };
  const visit = (item: unknown, depth: number): void => {
    if (depth > 32) refuse("PROJECTION_SHAPE");
    if (typeof item === "string") { quotedString(item); return; }
    if (item === null || typeof item === "boolean") { add(String(item).length); return; }
    if (typeof item === "number" && Number.isFinite(item)) { add(JSON.stringify(item).length); return; }
    if (typeof item !== "object" || ancestors.has(item)) refuse("PROJECTION_SHAPE");
    ancestors.add(item); add(2);
    // Fixed profile bodies have small arrays/maps. This bound is structural, not financial.
    const keys = Object.keys(item);
    if (keys.length > 128) refuse("PROJECTION_SHAPE");
    keys.forEach((key, index) => {
      if (index) add(1);
      if (!Array.isArray(item)) { quotedString(key); add(1); }
      visit((item as Record<string, unknown>)[key], depth + 1);
    });
    ancestors.delete(item);
  };
  visit(value, 0);
}
function copy<T>(value: T): T {
  assertBoundedProjection(value);
  const cloned: T = JSON.parse(JSON.stringify(value));
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  freeze(cloned); return cloned;
}
function same(left: unknown, right: unknown) { return computeSemanticSha256Hex(left) === computeSemanticSha256Hex(right); }
function sequence(value: number, minimum = 0) { ensure(Number.isSafeInteger(value) && value >= minimum, "SEQUENCE"); }
function scopeEqual(actual: Scope, expected: Scope) {
  ensure(actual.organizationId === expected.organizationId && actual.accountId === expected.accountId &&
    actual.runId === expected.runId && actual.split === expected.split, "SCOPE");
}

export type HistoricalReconciliationAccountingV1 = Readonly<{
  id: string; digest: string; sequence: number; sourceFillId: string | null; economicsDigest: string;
  organizationId: string; accountId: string; runId: string; cash: string;
  positions: Readonly<Record<string, string>>; consumedFillCount: number; lastConsumedFillId: string | null;
}>;
/** Intentionally never traverses/copies canonical cumulative consumedFillIds. */
export function projectHistoricalReconciliationAccountingV1(value: AccountingFrontierV1): HistoricalReconciliationAccountingV1 {
  const keys = Object.keys(value.positions);
  if (keys.length > 1) refuse("SYMBOL_SCOPE");
  const count = value.consumedFillIds.length;
  return copy({ id: value.id, digest: value.semanticContentDigest, sequence: value.accountingSequence,
    sourceFillId: value.sourceFillId, economicsDigest: value.sourceEconomicsDigest,
    organizationId: value.organizationId, accountId: value.accountKey, runId: value.runId, cash: value.cash,
    positions: Object.fromEntries(keys.map((key) => [key, value.positions[key]!.quantity])),
    consumedFillCount: count, lastConsumedFillId: count === 0 ? null : value.consumedFillIds[count - 1]!,
  });
}
export type HistoricalReconciliationParentV1 = Readonly<{
  orderId: string; organizationId: string; accountId: string; runId: string; symbol: string;
  receiptDigest: string; creationDigest: string; state: string; stateVersion: number; side: "buy" | "sell";
  quantity: string; filledQuantity: string; remainingQuantity: string;
  acceptedAt: number; firstEligibleAt: number; eligibleBarsSeen: number; fillSequence: number;
  pendingCancel: Readonly<{ requestedAtTs: number; cancelEffectiveTs: number }> | null;
  stateEvent: Readonly<{ id: string; sequence: number; digest: string }>;
  fillReferences: readonly Readonly<{ fillId: string; economicsRowId: string; economicsDigest: string;
    fillSourceDigest: string; economicsSourceDigest: string }>[];
}>;
export type HistoricalReconciliationFillV1 = Readonly<{
  fillId: string; parentId: string; organizationId: string; accountId: string; runId: string;
  symbol: string; side: "buy" | "sell"; quantity: string;
  price: string; fee: string; feeAsset: string; exchangeTradeId: string; executedAt: number;
}>;
export type HistoricalReconciliationEconomicsV1 = Pick<HistoricalReconciliationFillV1,
  "fillId" | "parentId" | "organizationId" | "accountId" | "runId" | "symbol" | "side" | "quantity"> & Readonly<{
  economicsRowId: string; economicsDigest: string; netCashEffect: string; fillSequence: number; sourceBarIndex: number;
  exchangeTradeId: string; schemaVersion: string;
  sourceEconomics: Readonly<Omit<CostedFillEconomics, "sourceBarTimestamp" | "acceptedAt" | "fillTimestamp"> & {
    sourceBarTimestamp: number; acceptedAt: number; fillTimestamp: number;
  }>;
}>;
/** Exact supported instant, without lexical timezone equality or fractional-ms truncation. */
export function historicalReconciliationInstantV1(value: string | number | Date): number {
  const result = typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(value);
  ensure(Number.isSafeInteger(result), "SOURCE_TIME");
  return result;
}
export function captureHistoricalReconciliationProducedFillsV1(scope: Scope,
  details: readonly HistoricalModeledFillDetailV2[]) {
  ensure(details.length <= 1, "FILL_MEMBERSHIP");
  return copy(details.map((detail) => {
    const event = { ...detail.event, acceptedAt: new Date(historicalReconciliationInstantV1(detail.event.acceptedAt)),
      fillTimestamp: new Date(historicalReconciliationInstantV1(detail.event.fillTimestamp)) };
    const economics = { ...detail.economics,
      sourceBarTimestamp: new Date(historicalReconciliationInstantV1(detail.economics.sourceBarTimestamp)),
      acceptedAt: new Date(historicalReconciliationInstantV1(detail.economics.acceptedAt)),
      fillTimestamp: new Date(historicalReconciliationInstantV1(detail.economics.fillTimestamp)) };
    ensure(event.organizationId === scope.organizationId && event.orderId === detail.evidence.orderId &&
      event.symbol === economics.symbol && event.side === economics.side && event.sliceQuantity === economics.quantity &&
      event.fillSequence === economics.fillSequence && event.sourceBarIndex === economics.sourceBarIndex &&
      event.grossFillPrice === economics.grossFillPrice && event.remainingQuantityAfter === economics.remainingQuantityAfter &&
      event.submitLatencyMs === economics.submitLatencyMs && event.cancelLatencyMs === economics.cancelLatencyMs &&
      event.acceptedAt.getTime() === economics.acceptedAt.getTime() && event.fillTimestamp.getTime() === economics.fillTimestamp.getTime() &&
      historicalReconciliationInstantV1(event.sourceBar.barCloseTime) === economics.sourceBarTimestamp.getTime(), "PRODUCED_DETAIL");
    const payload = buildRecordFillPayload(event, economics, scope.organizationId, event.orderId,
      event.side, economics.netFillPrice, event.sliceQuantity, false);
    ensure(payload.fillId === detail.evidence.fillId && economics.economicsContentDigest === detail.evidence.economicsContentDigestHex &&
      detail.accountingFrontier.sourceFillId === payload.fillId &&
      detail.accountingFrontier.semanticContentDigest === detail.evidence.accountingFrontierContentDigestHex, "PRODUCED_DETAIL");
    const identity = { fillId: payload.fillId!, parentId: event.orderId, organizationId: scope.organizationId,
      accountId: scope.accountId, runId: scope.runId, symbol: event.symbol, side: event.side, quantity: event.sliceQuantity };
    const fill: HistoricalReconciliationFillV1 = { ...identity, price: payload.price, fee: payload.fee!,
      feeAsset: payload.feeAsset!, exchangeTradeId: payload.exchangeTradeId, executedAt: event.fillTimestamp.getTime() };
    const persistedEconomics: HistoricalReconciliationEconomicsV1 = { ...identity,
      economicsRowId: payload.economicsRow!.id, economicsDigest: economics.economicsContentDigest,
      netCashEffect: economics.netCashEffect, fillSequence: economics.fillSequence, sourceBarIndex: economics.sourceBarIndex,
      exchangeTradeId: payload.economicsRow!.exchangeTradeId, schemaVersion: payload.economicsRow!.schemaVersion,
      sourceEconomics: { ...economics, acceptedAt: economics.acceptedAt.getTime(),
        fillTimestamp: economics.fillTimestamp.getTime(), sourceBarTimestamp: economics.sourceBarTimestamp.getTime() } };
    // Only the bounded Accounting projection is retained; no new digest/copy of its cumulative IDs.
    return { fill, economics: persistedEconomics, accounting: projectHistoricalReconciliationAccountingV1(detail.accountingFrontier) };
  }));
}
export type HistoricalReconciliationProducedFillsV1 = ReturnType<typeof captureHistoricalReconciliationProducedFillsV1>;
export function assertHistoricalReconciliationProducedFillsV1(produced: HistoricalReconciliationProducedFillsV1,
  fills: readonly HistoricalReconciliationFillV1[], economics: readonly HistoricalReconciliationEconomicsV1[],
  steps: readonly HistoricalReconciliationAccountingV1[]) {
  ensure(produced.length === fills.length && produced.length === economics.length, "PRODUCED_SOURCE_MEMBERSHIP");
  produced.forEach((expected, index) => {
    ensure(same(expected.fill, fills[index]) && same(expected.economics, economics[index]) &&
      same(expected.accounting, steps[index]), "PRODUCED_SOURCE_CONTENT");
  });
}
export type HistoricalReconciliationConsumedV1 = Readonly<{
  fillId: string; accountingId: string; accountingSequence: number; accountingDigest: string; economicsDigest: string;
}>;
export type HistoricalReconciliationFillDeltaV1 = Readonly<{
  fillId: string; parentId: string; economicsRowId: string; economicsDigest: string;
  signedQuantity: string; netCashEffect: string; fillSequence: number; sourceBarIndex: number;
  fillAccountingId: string; fillAccountingSequence: number; fillAccountingDigest: string;
}>;
export type HistoricalReconciliationObservationV1 = Readonly<{
  phase: Phase; accountingDigest: string; projectionDigest: string;
}>;
export type HistoricalReconciliationFrontierV1 = Readonly<{
  schemaVersion: typeof HISTORICAL_RECONCILIATION_SCHEMA_V1;
  profile: typeof HISTORICAL_RECONCILIATION_PROFILE_V1;
  scope: Scope; symbol: "BTCUSDT" | "ETHUSDT"; cycleSequence: number; cycleId: string | null;
  initialRecordIndex: number; recordIndex: number; releaseSha: string; modelDigest: string; authorityDigest: string;
  genesisId: string | null; previousId: string | null; previousDigest: string | null;
  inceptionAccountingId: string; inceptionAccountingDigest: string; inceptionAuthorityId: string; startingCash: string;
  checkpointDigest: string | null; membershipDigest: string | null; marketDigest: string | null;
  previousAccountingSequence: number; accounting: HistoricalReconciliationAccountingV1;
  expectedCashAfter: string; expectedOpenQuantityAfter: string; consumedFillCount: number; lastConsumedFillId: string | null;
  sourceEventCount: number; sourceChainDigest: string;
  fillDelta: HistoricalReconciliationFillDeltaV1 | null;
  steps: readonly HistoricalReconciliationAccountingV1[];
  activeParentAfter: HistoricalReconciliationParentV1 | null; touchedParentsAfter: readonly HistoricalReconciliationParentV1[];
  observations: readonly HistoricalReconciliationObservationV1[];
  id: string; contentDigest: string;
}>;
type FrontierBody = Omit<HistoricalReconciliationFrontierV1, "id" | "contentDigest">;
export type HistoricalReconciliationDeltaV1 = Omit<FrontierBody,
  "checkpointDigest" | "observations" | "activeParentAfter" | "touchedParentsAfter">;

function seal(body: FrontierBody): HistoricalReconciliationFrontierV1 {
  const frozen = copy(body);
  const contentDigest = computeSemanticSha256Hex(frozen);
  return Object.freeze({ ...frozen, contentDigest,
    id: deterministicExecutionUuidV2("report", { kind: HISTORICAL_RECONCILIATION_SCHEMA_V1, contentDigest }) });
}
function assertAccounting(value: HistoricalReconciliationAccountingV1, scope: Scope, symbol: string,
  cash: string, quantity: string, count: number, last: string | null) {
  ensure(value.organizationId === scope.organizationId && value.accountId === scope.accountId && value.runId === scope.runId, "SCOPE");
  sequence(value.sequence, 1); sequence(value.consumedFillCount);
  ensure(HEX.test(value.digest) && HEX.test(value.economicsDigest), "ACCOUNTING_DIGEST");
  ensure(Object.keys(value.positions).every((key) => key === symbol), "SYMBOL_SCOPE");
  ensure(compareDecimal(value.cash, cash) === 0, "CASH_MISMATCH");
  ensure(compareDecimal(value.positions[symbol] ?? "0", quantity) === 0, "INVENTORY_MISMATCH");
  ensure(value.consumedFillCount === count && value.lastConsumedFillId === last, "CONSUMED_FRONTIER");
}
function assertParents(scope: Scope, symbol: string, active: HistoricalReconciliationParentV1 | null,
  touched: readonly HistoricalReconciliationParentV1[]) {
  ensure(touched.length <= 2 && new Set(touched.map((p) => p.orderId)).size === touched.length, "PARENT_CARDINALITY");
  for (const p of touched) {
    ensure(p.organizationId === scope.organizationId && p.accountId === scope.accountId && p.runId === scope.runId && p.symbol === symbol, "PARENT_SCOPE");
    sequence(p.stateVersion); sequence(p.eligibleBarsSeen); sequence(p.fillSequence);
    ensure(p.fillReferences.length === p.fillSequence && p.fillReferences.length <= 3 &&
      new Set(p.fillReferences.map((f) => f.fillId)).size === p.fillReferences.length &&
      p.fillReferences.every((f) => HEX.test(f.economicsDigest) && HEX.test(f.fillSourceDigest) && HEX.test(f.economicsSourceDigest)) && HEX.test(p.stateEvent.digest), "PARENT_FILL_REFERENCES");
    ensure(p.fillSequence <= 3 && p.eligibleBarsSeen <= 3 && HEX.test(p.receiptDigest) && HEX.test(p.creationDigest), "PARENT_MODEL");
    ensure(compareDecimal(p.quantity, "0") > 0 && compareDecimal(p.filledQuantity, "0") >= 0 &&
      compareDecimal(p.remainingQuantity, "0") >= 0 && compareDecimal(addDecimal(p.filledQuantity, p.remainingQuantity), p.quantity) === 0, "PARENT_QUANTITY");
  }
  if (active) ensure(touched.some((p) => same(p, active)), "ACTIVE_PARENT_MEMBERSHIP");
}
export function createHistoricalReconciliationGenesisV1(input: Readonly<{
  scope: Scope; symbol: "BTCUSDT" | "ETHUSDT"; inception: AccountingFrontierV1;
  authorityId: string; authorityDigest: string; modelDigest: string; releaseSha: string; initialRecordIndex: number;
}>): HistoricalReconciliationFrontierV1 {
  const accounting = projectHistoricalReconciliationAccountingV1(input.inception);
  ensure(accounting.sequence === 1 && accounting.sourceFillId === null && Object.keys(accounting.positions).length === 0, "INCEPTION");
  sequence(input.initialRecordIndex);
  assertAccounting(accounting, input.scope, input.symbol, input.inception.cash, "0", 0, null);
  const body: FrontierBody = { schemaVersion: HISTORICAL_RECONCILIATION_SCHEMA_V1,
    profile: HISTORICAL_RECONCILIATION_PROFILE_V1, scope: input.scope, symbol: input.symbol,
    cycleSequence: -1, cycleId: null, initialRecordIndex: input.initialRecordIndex, recordIndex: input.initialRecordIndex - 1,
    releaseSha: input.releaseSha, modelDigest: input.modelDigest, authorityDigest: input.authorityDigest,
    genesisId: null, previousId: null, previousDigest: null, inceptionAccountingId: accounting.id,
    inceptionAccountingDigest: accounting.digest, inceptionAuthorityId: input.authorityId, startingCash: accounting.cash, checkpointDigest: null,
    membershipDigest: null, marketDigest: null, previousAccountingSequence: 1, accounting,
    expectedCashAfter: accounting.cash, expectedOpenQuantityAfter: "0", consumedFillCount: 0, lastConsumedFillId: null,
    sourceEventCount: 0, sourceChainDigest: computeSemanticSha256Hex({ domain: HISTORICAL_RECONCILIATION_SCHEMA_V1,
      scope: input.scope, inception: { id: accounting.id, digest: accounting.digest }, modelDigest: input.modelDigest }),
    fillDelta: null, steps: [], activeParentAfter: null, touchedParentsAfter: [], observations: [] };
  ensure(HEX.test(input.authorityDigest) && HEX.test(input.modelDigest) && /^[0-9a-f]{40}$/.test(input.releaseSha), "GENESIS_IDENTITY");
  return seal(body);
}

export function advanceHistoricalReconciliationV1(input: Readonly<{
  previous: HistoricalReconciliationFrontierV1; cycleId: string; cycleSequence: number;
  recordIndex: number; membershipDigest: string; marketDigest: string; releaseSha: string;
  steps: readonly HistoricalReconciliationAccountingV1[];
  fills: readonly HistoricalReconciliationFillV1[]; economics: readonly HistoricalReconciliationEconomicsV1[];
  consumed: readonly HistoricalReconciliationConsumedV1[];
}>): HistoricalReconciliationDeltaV1 {
  const p = input.previous; assertHistoricalReconciliationFrontierV1(p, p.scope);
  ensure(input.cycleSequence === p.cycleSequence + 1 && input.recordIndex === p.recordIndex + 1, "CYCLE_SEQUENCE");
  ensure(HEX.test(input.membershipDigest) && HEX.test(input.marketDigest) && /^[0-9a-f]{40}$/.test(input.releaseSha), "CYCLE_IDENTITY");
  ensure(input.fills.length <= 1 && input.economics.length === input.fills.length && input.consumed.length === input.fills.length, "FILL_MEMBERSHIP");
  ensure(input.steps.length === input.fills.length + 1 && input.steps.length <= 2, "STEP_ORDER");
  let cash = p.expectedCashAfter; let quantity = p.expectedOpenQuantityAfter;
  let count = p.consumedFillCount; let last = p.lastConsumedFillId;
  let fillDelta: HistoricalReconciliationFillDeltaV1 | null = null;
  if (input.fills.length) {
    const f = input.fills[0]!; const e = input.economics[0]!; const a = input.consumed[0]!; const step = input.steps[0]!;
    ensure(f.fillId === e.fillId && f.fillId === a.fillId && f.fillId === step.sourceFillId && f.parentId === e.parentId &&
      f.organizationId === p.scope.organizationId && f.accountId === p.scope.accountId && f.runId === p.scope.runId &&
      e.organizationId === f.organizationId && e.accountId === f.accountId && e.runId === f.runId &&
      f.symbol === p.symbol && e.symbol === f.symbol && f.side === e.side && compareDecimal(f.quantity, e.quantity) === 0 &&
      a.accountingId === step.id && a.accountingSequence === step.sequence && a.accountingDigest === step.digest &&
      a.economicsDigest === e.economicsDigest && step.economicsDigest === e.economicsDigest, "FILL_MEMBERSHIP");
    ensure(p.activeParentAfter?.orderId === f.parentId && e.fillSequence === p.activeParentAfter.fillSequence + 1 &&
      e.fillSequence <= 3 && e.sourceBarIndex === input.recordIndex && compareDecimal(f.quantity, "0") > 0, "FILL_PARENT");
    const signedQuantity = f.side === "buy" ? f.quantity : subtractDecimal("0", f.quantity);
    cash = addDecimal(cash, e.netCashEffect); quantity = addDecimal(quantity, signedQuantity);
    ensure(compareDecimal(quantity, "0") >= 0, "INVENTORY_MISMATCH"); count += 1; last = f.fillId;
    assertAccounting(step, p.scope, p.symbol, cash, quantity, count, last);
    fillDelta = { fillId: f.fillId, parentId: f.parentId, economicsRowId: e.economicsRowId,
      economicsDigest: e.economicsDigest, signedQuantity, netCashEffect: e.netCashEffect, fillSequence: e.fillSequence,
      sourceBarIndex: e.sourceBarIndex, fillAccountingId: a.accountingId, fillAccountingSequence: a.accountingSequence,
      fillAccountingDigest: a.accountingDigest };
  }
  const mark = input.steps.at(-1)!;
  ensure(mark.sourceFillId === null, "STEP_ORDER");
  input.steps.forEach((step, i) => ensure(step.sequence === p.accounting.sequence + i + 1, "ACCOUNTING_SEQUENCE"));
  ensure(new Set(input.steps.map((step) => step.id)).size === input.steps.length, "ACCOUNTING_IDENTITY");
  assertAccounting(mark, p.scope, p.symbol, cash, quantity, count, last);
  const base = { ...p } as Partial<HistoricalReconciliationFrontierV1>;
  for (const key of ["id", "contentDigest", "checkpointDigest", "observations", "activeParentAfter", "touchedParentsAfter"] as const) delete base[key];
  return copy({ ...(base as HistoricalReconciliationDeltaV1), cycleSequence: input.cycleSequence, cycleId: input.cycleId, recordIndex: input.recordIndex,
    releaseSha: input.releaseSha, genesisId: p.genesisId ?? p.id, previousId: p.id, previousDigest: p.contentDigest,
    membershipDigest: input.membershipDigest, marketDigest: input.marketDigest,
    previousAccountingSequence: p.accounting.sequence, accounting: mark,
    expectedCashAfter: cash, expectedOpenQuantityAfter: quantity, consumedFillCount: count, lastConsumedFillId: last,
    sourceEventCount: p.sourceEventCount + input.steps.length,
    sourceChainDigest: computeSemanticSha256Hex({ domain: HISTORICAL_RECONCILIATION_SCHEMA_V1,
      previous: p.sourceChainDigest, cycleId: input.cycleId, steps: input.steps, fillDelta }),
    fillDelta, steps: input.steps });
}
export function observeHistoricalReconciliationV1(input: Readonly<{
  delta: HistoricalReconciliationDeltaV1; phase: Phase; accounting: HistoricalReconciliationAccountingV1;
  state: AccountingFrontierV1;
  activeParent: HistoricalReconciliationParentV1 | null; touchedParents: readonly HistoricalReconciliationParentV1[];
  previousObservations: readonly HistoricalReconciliationObservationV1[];
}>): HistoricalReconciliationObservationV1 {
  ensure(input.previousObservations.length < 3 && HISTORICAL_RECONCILIATION_PHASES_V1[input.previousObservations.length] === input.phase &&
    input.previousObservations.every((p, i) => p.phase === HISTORICAL_RECONCILIATION_PHASES_V1[i]), "PHASE_ORDER");
  const d = input.delta;
  assertAccounting(input.accounting, d.scope, d.symbol, d.expectedCashAfter, d.expectedOpenQuantityAfter, d.consumedFillCount, d.lastConsumedFillId);
  ensure(same(d.accounting, input.accounting), "PHASE_ACCOUNTING_IDENTITY");
  ensure(same(projectHistoricalReconciliationAccountingV1(input.state), input.accounting), "PHASE_STATE_IDENTITY");
  // The actual existing Accounting invariant is mandatory at each fresh owner gate.
  // Starting equity is immutable flat inception; cash reconciliation is only the
  // independently checked increment. Explicit IDs prevent the historical fallback.
  const cashEvents = d.fillDelta ? [{ fillId: d.fillDelta.fillId, netCashEffect: d.fillDelta.netCashEffect }] : [];
  const invariant = reconcileAccountingInvariants({ state: input.state,
    startingEquityUsdt: d.startingCash,
    startingCashUsdt: subtractDecimal(d.expectedCashAfter, d.fillDelta?.netCashEffect ?? "0"),
    cashEvents, cashEventIntegrityFillIds: cashEvents.map((event) => event.fillId),
    inventoryOpenQtyBySymbol: Object.fromEntries([...new Set([d.symbol, ...Object.keys(input.state.positions)])]
      .map((symbol) => [symbol, symbol === d.symbol ? d.expectedOpenQuantityAfter : "0"])),
    expectedAccountingSequence: d.accounting.sequence,
  });
  if (!invariant.pass) refuse(`ACCOUNTING_INVARIANT:${invariant.violations.map((value) => value.code).join(",")}`);
  assertParents(d.scope, d.symbol, input.activeParent, input.touchedParents);
  return copy({ phase: input.phase, accountingDigest: input.accounting.digest,
    projectionDigest: computeSemanticSha256Hex({ accounting: input.accounting,
      activeParent: input.activeParent, touchedParents: input.touchedParents }) });
}
export function sealHistoricalReconciliationCycleV1(input: Readonly<{
  delta: HistoricalReconciliationDeltaV1; checkpointDigest: string;
  activeParent: HistoricalReconciliationParentV1 | null; touchedParents: readonly HistoricalReconciliationParentV1[];
  observations: readonly HistoricalReconciliationObservationV1[];
}>): HistoricalReconciliationFrontierV1 {
  ensure(input.observations.length === 3 && input.observations.every((v, i) => v.phase === HISTORICAL_RECONCILIATION_PHASES_V1[i]), "PHASE_ORDER");
  ensure(HEX.test(input.checkpointDigest), "CHECKPOINT_IDENTITY");
  assertParents(input.delta.scope, input.delta.symbol, input.activeParent, input.touchedParents);
  const expected = computeSemanticSha256Hex({ accounting: input.delta.accounting,
    activeParent: input.activeParent, touchedParents: input.touchedParents });
  ensure(input.observations[2]!.projectionDigest === expected, "FINAL_OBSERVATION");
  return seal({ ...input.delta, checkpointDigest: input.checkpointDigest, activeParentAfter: input.activeParent,
    touchedParentsAfter: input.touchedParents, observations: input.observations });
}
export function assertHistoricalReconciliationFrontierV1(value: HistoricalReconciliationFrontierV1, scope: Scope): void {
  assertBoundedProjection(value); scopeEqual(value.scope, scope);
  const { id, contentDigest, ...body } = value;
  ensure(value.schemaVersion === HISTORICAL_RECONCILIATION_SCHEMA_V1 && value.profile === HISTORICAL_RECONCILIATION_PROFILE_V1 &&
    (value.symbol === "BTCUSDT" || value.symbol === "ETHUSDT"), "PROFILE");
  ensure(HEX.test(contentDigest) && computeSemanticSha256Hex(body) === contentDigest &&
    deterministicExecutionUuidV2("report", { kind: HISTORICAL_RECONCILIATION_SCHEMA_V1, contentDigest }) === id, "DIGEST");
  sequence(value.cycleSequence, -1); sequence(value.consumedFillCount); sequence(value.sourceEventCount);
  assertAccounting(value.accounting, scope, value.symbol, value.expectedCashAfter,
    value.expectedOpenQuantityAfter, value.consumedFillCount, value.lastConsumedFillId);
  assertParents(scope, value.symbol, value.activeParentAfter, value.touchedParentsAfter);
  if (value.cycleSequence === -1) ensure(value.previousId === null && value.genesisId === null && value.steps.length === 0 &&
    value.observations.length === 0 && value.accounting.sequence === 1 && value.fillDelta === null, "GENESIS_SHAPE");
  else ensure(value.previousId !== null && value.genesisId !== null && value.checkpointDigest !== null &&
    value.observations.length === 3 && value.observations.every((v, i) => v.phase === HISTORICAL_RECONCILIATION_PHASES_V1[i]) &&
    value.steps.length >= 1 && value.steps.length <= 2 && same(value.steps.at(-1), value.accounting), "CYCLE_SHAPE");
}


/** Bounded candidates only. The database independently compares every selected field
 * with the original inserted source; this function conveys no admission authority. */
export function projectHistoricalReconciliationSourceValueV1(kind: string, input: unknown): unknown | null {
  const object = (value: unknown): Record<string, unknown> => {
    ensure(value !== null && typeof value === "object" && !Array.isArray(value), "SOURCE_PROJECTION");
    return value as Record<string, unknown>;
  };
  const scalar = (value: unknown): string | number | boolean | null => {
    ensure(value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" && Number.isFinite(value), "SOURCE_PROJECTION");
    return value as string | number | boolean | null;
  };
  const pick = (value: unknown, keys: readonly string[]) => {
    const row = object(value);
    return Object.fromEntries(keys.map((key) => [key, scalar(row[key])]));
  };
  const array = (value: unknown, maximum: number): readonly unknown[] => {
    ensure(Array.isArray(value) && value.length <= maximum, "SOURCE_PROJECTION");
    return value as unknown[];
  };
  if (kind === "ACCOUNTING_FRONTIER") {
    const state = object(input); const positions = object(state.positions);
    const positionBasis: Record<string, Record<string, string | number | boolean | null>> = {};
    for (const symbol in positions) {
      if (!Object.hasOwn(positions, symbol)) continue;
      ensure((symbol === "BTCUSDT" || symbol === "ETHUSDT") && Object.keys(positionBasis).length === 0, "SOURCE_PROJECTION");
      positionBasis[symbol] = pick(positions[symbol], ["quantity", "grossPositionBasis", "netPositionBasis"]);
    }
    return copy({ accounting: projectHistoricalReconciliationAccountingV1(input as AccountingFrontierV1), positionBasis });
  }
  if (kind === "MODELED_EXCHANGE") {
    const state = object(input); const checkpoint = object(state.checkpoint);
    const orders = array(state.openOrders, 1); const entries = array(checkpoint.openOrders, 1);
    ensure(orders.length === entries.length, "SOURCE_PROJECTION");
    if (!orders.length) return copy({ orders: 0, entries: 0, parent: null });
    const order = object(orders[0]); const entry = object(entries[0]);
    return copy({ orders: 1, entries: 1, parent: {
      orderId: scalar(order.id), state: scalar(order.state), stateVersion: scalar(order.stateVersion),
      filledQuantity: scalar(order.filledQuantity), entryOrderId: scalar(entry.orderId),
      acceptedAt: scalar(entry.acceptedAtTs), firstEligibleAt: scalar(entry.firstEligibleTs),
      eligibleBarsSeen: scalar(entry.sameSymbolEligibleBarsSeen), remainingQuantity: scalar(entry.remainingQty),
      entryFilledQuantity: scalar(entry.filledQty), fillSequence: scalar(entry.fillSequence),
      pendingCancel: entry.pendingCancel == null ? null : pick(entry.pendingCancel, ["requestedAtTs", "cancelEffectiveTs"]),
    } });
  }
  if (kind === "ACCOUNTING") {
    const artifacts = array(input, 1); ensure(artifacts.length === 1, "SOURCE_PROJECTION");
    const row = object(artifacts[0]);
    ensure(Object.keys(row).length === 3 && row.artifactKind === "ACCOUNTING_FRONTIER", "SOURCE_PROJECTION");
    return copy({ artifactCount: 1, artifact: pick(row, ["artifactKind", "artifactId", "contentDigestHex"]) });
  }
  if (kind !== "OBSERVED_EXECUTION_EFFECTS") return null;
  const artifacts = array(input, 2); ensure(artifacts.length >= 1, "SOURCE_PROJECTION");
  let detailCount = 0;
  const selected = artifacts.map((item) => {
    const artifact = object(item);
    const payload = artifact.payload == null ? null : object(artifact.payload);
    const lineage = payload?.lineagePayload == null ? null : object(payload.lineagePayload);
    const raw = lineage?.fillDetail;
    let detail: unknown = null;
    if (raw != null) {
      ensure(++detailCount <= 1, "SOURCE_PROJECTION");
      const source = object(raw); const event = object(source.event); const accounting = object(source.accountingFrontier);
      detail = {
        event: { ...pick(event, ["orderId", "organizationId", "symbol", "side", "fillSequence", "sourceBarIndex",
          "grossFillPrice", "sliceQuantity", "remainingQuantityAfter", "acceptedAt", "fillTimestamp", "submitLatencyMs", "cancelLatencyMs"]),
          sourceBar: pick(event.sourceBar, ["symbol", "interval", "open", "high", "low", "close", "volume", "barOpenTime", "barCloseTime"]) },
        economics: pick(source.economics, ["executionFactKind", "grossFillPrice", "grossNotional", "feeAmount", "feeAsset",
          "spreadCost", "impactSlippageCost", "totalExecutionCost", "netFillPrice", "netCashEffect", "economicsContentDigest",
          "executionModelId", "executionModelSchemaVersion", "simulatorId", "simulatorVersion", "sourceBarTimestamp", "sourceBarIndex",
          "acceptedAt", "fillTimestamp", "submitLatencyMs", "cancelLatencyMs", "remainingQuantityAfter", "fillSequence", "symbol", "side", "quantity"]),
        evidence: pick(source.evidence, ["schemaVersion", "source", "capitalEligible", "cycleId", "sealedMarketCycleContentDigestHex",
          "orderId", "fillId", "economicsContentDigestHex", "accountingFrontierContentDigestHex", "contentDigestHex"]),
        accountingId: scalar(accounting.id), accountingDigest: scalar(accounting.semanticContentDigest),
      };
    }
    return { ...pick(artifact, ["artifactKind", "artifactId", "contentDigestHex"]), detail };
  });
  return copy({ artifactCount: artifacts.length, artifacts: selected });
}
