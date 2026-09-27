import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
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
  fillReferences: readonly Readonly<{ fillId: string; economicsRowId: string; economicsDigest: string }>[];
}>;
export type HistoricalReconciliationFillV1 = Readonly<{
  fillId: string; parentId: string; organizationId: string; accountId: string; runId: string;
  symbol: string; side: "buy" | "sell"; quantity: string;
}>;
export type HistoricalReconciliationEconomicsV1 = HistoricalReconciliationFillV1 & Readonly<{
  economicsRowId: string; economicsDigest: string; netCashEffect: string; fillSequence: number; sourceBarIndex: number;
}>;
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
      p.fillReferences.every((f) => HEX.test(f.economicsDigest)) && HEX.test(p.stateEvent.digest), "PARENT_FILL_REFERENCES");
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
  activeParent: HistoricalReconciliationParentV1 | null; touchedParents: readonly HistoricalReconciliationParentV1[];
  previousObservations: readonly HistoricalReconciliationObservationV1[];
}>): HistoricalReconciliationObservationV1 {
  ensure(input.previousObservations.length < 3 && HISTORICAL_RECONCILIATION_PHASES_V1[input.previousObservations.length] === input.phase &&
    input.previousObservations.every((p, i) => p.phase === HISTORICAL_RECONCILIATION_PHASES_V1[i]), "PHASE_ORDER");
  const d = input.delta;
  assertAccounting(input.accounting, d.scope, d.symbol, d.expectedCashAfter, d.expectedOpenQuantityAfter, d.consumedFillCount, d.lastConsumedFillId);
  ensure(same(d.accounting, input.accounting), "PHASE_ACCOUNTING_IDENTITY");
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
