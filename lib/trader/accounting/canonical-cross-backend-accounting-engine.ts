import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/digest";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  computePeakEquityDrawdownBps,
  resolveMonthKeyUtc,
  updateDrawdownHighWaterMarks,
} from "@/lib/trader/risk/drawdown-policy-evaluator";
import {
  addDecimal,
  compareDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

import {
  ACCOUNTING_BASIS_METHOD,
  ACCOUNTING_ENGINE_ID,
  ACCOUNTING_FRONTIER_SCHEMA_VERSION,
  type AccountingFillInput,
  type AccountingFrontierV1,
  type AccountingStateV1,
  AccountingIdempotencyConflictError,
  AccountingInvariantError,
  type AdvanceAccountingFrontierInput,
  type MarksJsonV1,
  type SymbolPositionBasis,
} from "@/lib/trader/accounting/accounting-frontier.types";

export const CanonicalCrossBackendAccountingEngineV1 = {
  engineId: ACCOUNTING_ENGINE_ID,
  basisMethod: ACCOUNTING_BASIS_METHOD,
  schemaVersion: ACCOUNTING_FRONTIER_SCHEMA_VERSION,
} as const;

function emptyPosition(): SymbolPositionBasis {
  return {
    quantity: "0",
    grossPositionBasis: "0",
    netPositionBasis: "0",
  };
}

function getOrCreatePosition(
  positions: Record<string, SymbolPositionBasis>,
  symbol: string,
): SymbolPositionBasis {
  const existing = positions[symbol];
  if (existing) {
    return existing;
  }
  const created = emptyPosition();
  positions[symbol] = created;
  return created;
}

function truncateAllocateBasis(basis: string, soldQty: string, preQty: string): string {
  const basisScaled = parseDecimal(basis);
  const soldScaled = parseDecimal(soldQty);
  const preScaled = parseDecimal(preQty);
  if (preScaled === 0n) {
    throw new AccountingInvariantError(
      `[accounting] cannot allocate basis with zero pre-sell quantity`,
    );
  }
  const allocated = (basisScaled * soldScaled) / preScaled;
  return formatDecimal(allocated);
}

function zeroFlatPosition(position: SymbolPositionBasis): void {
  if (compareDecimal(position.quantity, "0") === 0) {
    position.grossPositionBasis = "0";
    position.netPositionBasis = "0";
  }
}

export function createInitialAccountingState(input: {
  organizationId: string;
  accountKey: string;
  runId: string;
  startingCash?: string;
  frontierAsOf?: string;
}): AccountingStateV1 {
  const startingCash = input.startingCash ?? HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT;
  const frontierAsOf = input.frontierAsOf ?? new Date(0).toISOString();
  const monthKey = resolveMonthKeyUtc(frontierAsOf);
  return {
    schemaVersion: ACCOUNTING_FRONTIER_SCHEMA_VERSION,
    engineId: ACCOUNTING_ENGINE_ID,
    basisMethod: ACCOUNTING_BASIS_METHOD,
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    runId: input.runId,
    accountingSequence: 1,
    frontierAsOf,
    monthKey,
    cash: startingCash,
    positions: {},
    grossRealizedPnl: "0",
    netRealizedPnl: "0",
    marks: {},
    markedPositionValue: "0",
    equity: startingCash,
    equityHwm: startingCash,
    accountDrawdownBps: 0,
    consumedFillIds: [],
  };
}

function assertFillNotConsumed(state: AccountingStateV1, fillId: string): void {
  if (state.consumedFillIds.includes(fillId)) {
    throw new AccountingInvariantError(
      `[accounting] fill ${fillId} already consumed (one consumption per fill)`,
    );
  }
}

export function applyAccountingFill(
  state: AccountingStateV1,
  fill: AccountingFillInput,
): AccountingStateV1 {
  assertFillNotConsumed(state, fill.fillId);
  const economics = fill.economics;
  const symbol = economics.symbol;
  const quantity = economics.quantity;
  const position = getOrCreatePosition({ ...state.positions }, symbol);
  const nextPositions = { ...state.positions, [symbol]: { ...position } };
  const next = { ...state, positions: nextPositions };

  if (economics.side === "buy") {
    const grossEntryNotional = multiplyDecimal(economics.grossFillPrice, quantity);
    const netEntryCashOutlay = addDecimal(
      multiplyDecimal(economics.netFillPrice, quantity),
      economics.feeAmount,
    );
    next.positions[symbol] = {
      quantity: addDecimal(position.quantity, quantity),
      grossPositionBasis: addDecimal(position.grossPositionBasis, grossEntryNotional),
      netPositionBasis: addDecimal(position.netPositionBasis, netEntryCashOutlay),
    };
  } else if (economics.side === "sell") {
    const preQty = position.quantity;
    if (compareDecimal(quantity, preQty) > 0) {
      throw new AccountingInvariantError(
        `[accounting] sell quantity ${quantity} exceeds open quantity ${preQty}`,
      );
    }
    const grossExitProceeds = multiplyDecimal(economics.grossFillPrice, quantity);
    const netExitCashProceeds = subtractDecimal(
      multiplyDecimal(economics.netFillPrice, quantity),
      economics.feeAmount,
    );
    const allocatedGrossBasis = truncateAllocateBasis(
      position.grossPositionBasis,
      quantity,
      preQty,
    );
    const allocatedNetBasis = truncateAllocateBasis(position.netPositionBasis, quantity, preQty);
    const grossRealized = subtractDecimal(grossExitProceeds, allocatedGrossBasis);
    const netRealized = subtractDecimal(netExitCashProceeds, allocatedNetBasis);
    next.grossRealizedPnl = addDecimal(state.grossRealizedPnl, grossRealized);
    next.netRealizedPnl = addDecimal(state.netRealizedPnl, netRealized);
    const soldPosition: SymbolPositionBasis = {
      quantity: subtractDecimal(preQty, quantity),
      grossPositionBasis: subtractDecimal(position.grossPositionBasis, allocatedGrossBasis),
      netPositionBasis: subtractDecimal(position.netPositionBasis, allocatedNetBasis),
    };
    zeroFlatPosition(soldPosition);
    next.positions[symbol] = soldPosition;
  } else {
    throw new AccountingInvariantError(`[accounting] unsupported fill side`);
  }

  next.cash = addDecimal(state.cash, economics.netCashEffect);
  next.consumedFillIds = [...state.consumedFillIds, fill.fillId];
  next.frontierAsOf = fill.executedAt;
  return next;
}

export function attachAccountingMarks(
  state: AccountingStateV1,
  marks: MarksJsonV1,
  frontierAsOf: string,
): AccountingStateV1 {
  const next = { ...state, marks: { ...marks }, frontierAsOf };
  let markedPositionValue = "0";
  for (const [symbol, position] of Object.entries(next.positions)) {
    if (compareDecimal(position.quantity, "0") <= 0) {
      continue;
    }
    const mark = marks[symbol];
    if (!mark) {
      throw new AccountingInvariantError(`[accounting] missing mark for open symbol ${symbol}`);
    }
    markedPositionValue = addDecimal(
      markedPositionValue,
      multiplyDecimal(position.quantity, mark.price),
    );
  }
  next.markedPositionValue = markedPositionValue;
  next.equity = addDecimal(next.cash, markedPositionValue);
  const monthKey = resolveMonthKeyUtc(frontierAsOf);
  const hwm = updateDrawdownHighWaterMarks({
    equityUsdt: next.equity,
    accountPeakHwm: state.equityHwm,
    monthlyPeakHwm: state.equityHwm,
    priorMonthKey: state.monthKey,
    monthKey,
  });
  next.equityHwm = hwm.accountPeakHwm;
  next.monthKey = monthKey;
  next.accountDrawdownBps = computePeakEquityDrawdownBps(next.equity, next.equityHwm);
  return next;
}

export function computeAccountingSemanticDigest(state: AccountingStateV1): string {
  const positions = Object.fromEntries(
    Object.entries(state.positions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([symbol, pos]) => [symbol, pos]),
  );
  return createHash("sha256")
    .update(
      canonicalJsonString({
        schemaVersion: state.schemaVersion,
        engineId: state.engineId,
        basisMethod: state.basisMethod,
        organizationId: state.organizationId,
        accountKey: state.accountKey,
        runId: state.runId,
        accountingSequence: state.accountingSequence,
        frontierAsOf: state.frontierAsOf,
        monthKey: state.monthKey,
        cash: state.cash,
        positions,
        grossRealizedPnl: state.grossRealizedPnl,
        netRealizedPnl: state.netRealizedPnl,
        marks: state.marks,
        markedPositionValue: state.markedPositionValue,
        equity: state.equity,
        equityHwm: state.equityHwm,
        accountDrawdownBps: state.accountDrawdownBps,
      }),
      "utf8",
    )
    .digest("hex");
}

export function advanceAccountingFrontier(
  input: AdvanceAccountingFrontierInput,
): AccountingFrontierV1 {
  let state = { ...input.state };
  let sourceFillId: string | null = null;
  let sourceEconomicsDigest = "0".repeat(64);

  if (input.fill) {
    state = applyAccountingFill(state, input.fill);
    sourceFillId = input.fill.fillId;
    sourceEconomicsDigest = input.fill.economics.economicsContentDigest;
  }

  if (input.marks) {
    state = attachAccountingMarks(state, input.marks, input.frontierAsOf);
  } else if (input.fill) {
    state = {
      ...state,
      frontierAsOf: input.frontierAsOf,
      equity: state.cash,
      markedPositionValue: "0",
      marks: {},
    };
    const monthKey = resolveMonthKeyUtc(input.frontierAsOf);
    const hwm = updateDrawdownHighWaterMarks({
      equityUsdt: state.equity,
      accountPeakHwm: state.equityHwm,
      monthlyPeakHwm: state.equityHwm,
      priorMonthKey: state.monthKey,
      monthKey,
    });
    state.equityHwm = hwm.accountPeakHwm;
    state.monthKey = monthKey;
    state.accountDrawdownBps = computePeakEquityDrawdownBps(state.equity, state.equityHwm);
  }

  const nextSequence = state.accountingSequence + 1;
  state = { ...state, accountingSequence: nextSequence, frontierAsOf: input.frontierAsOf };

  const semanticContentDigest = computeAccountingSemanticDigest(state);
  const idempotencyKey =
    input.idempotencyKey ??
    `${state.organizationId}:${state.accountKey}:${state.runId}:${nextSequence}`;

  return {
    ...state,
    id: input.frontierId ?? crypto.randomUUID(),
    sourceFillId,
    sourceEconomicsDigest,
    semanticContentDigest,
    idempotencyKey,
  };
}

export function assertAccountingIdempotency(
  existingDigest: string,
  incomingDigest: string,
  idempotencyKey: string,
): void {
  if (existingDigest === incomingDigest) {
    return;
  }
  throw new AccountingIdempotencyConflictError(
    `[accounting] idempotency key ${idempotencyKey} content conflict`,
  );
}

export function remainingGrossPositionBasis(state: AccountingStateV1): string {
  return Object.values(state.positions).reduce(
    (sum, pos) => addDecimal(sum, pos.grossPositionBasis),
    "0",
  );
}

export function remainingNetPositionBasis(state: AccountingStateV1): string {
  return Object.values(state.positions).reduce(
    (sum, pos) => addDecimal(sum, pos.netPositionBasis),
    "0",
  );
}

export function grossUnrealizedPnl(state: AccountingStateV1): string {
  return subtractDecimal(state.markedPositionValue, remainingGrossPositionBasis(state));
}

export function netUnrealizedPnl(state: AccountingStateV1): string {
  return subtractDecimal(state.markedPositionValue, remainingNetPositionBasis(state));
}
