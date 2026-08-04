import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/digest";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  computePeakEquityDrawdownBps,
  resolveMonthKeyUtc,
  updateDrawdownHighWaterMarks,
} from "@/lib/trader/risk/drawdown-policy-evaluator";
import {
  buildStrategyAttributionKey,
  computeStrategyEquity,
  computeVirtualStrategyAllocations,
} from "@/lib/trader/risk/strategy-attribution";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
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

function emptyDrawdownMaps(): {
  strategyPeakHwmByKey: Record<string, string>;
  strategyDrawdownBpsByKey: Record<string, number>;
} {
  return { strategyPeakHwmByKey: {}, strategyDrawdownBpsByKey: {} };
}

function initialStrategyPeaksFromAllocations(startingEquity: string): Record<string, string> {
  const allocations = computeVirtualStrategyAllocations({ totalVirtualEquityUsdt: startingEquity });
  const peaks: Record<string, string> = {};
  for (const [key, allocation] of Object.entries(allocations)) {
    if (compareDecimal(allocation, "0") > 0) {
      peaks[key] = allocation;
    }
  }
  return peaks;
}

let cachedVirtualAllocationEntries: {
  totalAllocation: string;
  entries: Array<{ attrKey: string; allocation: string }>;
} | null = null;

function getVirtualAllocationEntries(): {
  totalAllocation: string;
  entries: Array<{ attrKey: string; allocation: string }>;
} {
  if (cachedVirtualAllocationEntries) {
    return cachedVirtualAllocationEntries;
  }
  const allocations = computeVirtualStrategyAllocations();
  const entries: Array<{ attrKey: string; allocation: string }> = [];
  let totalAllocation = "0";
  for (const [rawKey, allocation] of Object.entries(allocations)) {
    if (compareDecimal(allocation, "0") <= 0) {
      continue;
    }
    const [strategyId, strategyVersion] = rawKey.split("@");
    if (!strategyId || !strategyVersion) {
      continue;
    }
    totalAllocation = addDecimal(totalAllocation, allocation);
    entries.push({
      attrKey: buildStrategyAttributionKey(strategyId, strategyVersion),
      allocation,
    });
  }
  cachedVirtualAllocationEntries = { totalAllocation, entries };
  return cachedVirtualAllocationEntries;
}

function updateStrategyDrawdownMaps(input: {
  equityUsdt: string;
  strategyPeakHwmByKey: Record<string, string>;
  strategyDrawdownBpsByKey: Record<string, number>;
}): {
  strategyPeakHwmByKey: Record<string, string>;
  strategyDrawdownBpsByKey: Record<string, number>;
} {
  const { totalAllocation, entries } = getVirtualAllocationEntries();
  const strategyPeakHwmByKey = { ...input.strategyPeakHwmByKey };
  const strategyDrawdownBpsByKey = { ...input.strategyDrawdownBpsByKey };
  for (const { attrKey, allocation } of entries) {
    const prorataEquity =
      compareDecimal(totalAllocation, "0") > 0
        ? divideDecimal(multiplyDecimal(input.equityUsdt, allocation), totalAllocation)
        : allocation;
    const strategyEquity = computeStrategyEquity({
      allocationUsdt: allocation,
      cumulativeRealizedNetPnlUsdt: subtractDecimal(prorataEquity, allocation),
      pointInTimeUnrealizedNetPnlUsdt: "0",
      attributableCostsUsdt: "0",
    });
    const priorPeak = strategyPeakHwmByKey[attrKey] ?? allocation;
    const nextPeak = compareDecimal(strategyEquity, priorPeak) > 0 ? strategyEquity : priorPeak;
    strategyPeakHwmByKey[attrKey] = nextPeak;
    strategyDrawdownBpsByKey[attrKey] = computePeakEquityDrawdownBps(strategyEquity, nextPeak);
  }
  return { strategyPeakHwmByKey, strategyDrawdownBpsByKey };
}

function applyEquityDrawdownState(
  state: AccountingStateV1,
  equityUsdt: string,
  frontierAsOf: string,
  /**
   * Equity before this advance. Required for the same-month short-circuit because
   * callers (attachAccountingMarks) may already have written `state.equity`.
   */
  priorEquityUsdt?: string,
): AccountingStateV1 {
  const monthKey = resolveMonthKeyUtc(frontierAsOf);
  const priorEquity = priorEquityUsdt ?? state.equity;
  // IDHPS hot path: unchanged equity within the same UTC month cannot move HWM/drawdown maps.
  if (equityUsdt === priorEquity && monthKey === state.monthKey) {
    return state.equity === equityUsdt ? state : { ...state, equity: equityUsdt };
  }
  const hwm = updateDrawdownHighWaterMarks({
    equityUsdt,
    accountPeakHwm: state.equityHwm,
    monthlyPeakHwm: state.monthlyPeakHwm ?? state.equityHwm,
    priorMonthKey: state.monthKey,
    monthKey,
  });
  const strategyMaps = updateStrategyDrawdownMaps({
    equityUsdt,
    strategyPeakHwmByKey: state.strategyPeakHwmByKey ?? {},
    strategyDrawdownBpsByKey: state.strategyDrawdownBpsByKey ?? {},
  });
  return {
    ...state,
    equity: equityUsdt,
    equityHwm: hwm.accountPeakHwm,
    monthlyPeakHwm: hwm.monthlyPeakHwm,
    monthKey,
    accountDrawdownBps: computePeakEquityDrawdownBps(equityUsdt, hwm.accountPeakHwm),
    monthlyDrawdownBps: computePeakEquityDrawdownBps(equityUsdt, hwm.monthlyPeakHwm),
    strategyPeakHwmByKey: strategyMaps.strategyPeakHwmByKey,
    strategyDrawdownBpsByKey: strategyMaps.strategyDrawdownBpsByKey,
  };
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
  const strategyPeaks = initialStrategyPeaksFromAllocations(startingCash);
  const strategyPeaksByAttrKey: Record<string, string> = {};
  for (const [rawKey, allocation] of Object.entries(strategyPeaks)) {
    const [strategyId, strategyVersion] = rawKey.split("@");
    if (strategyId && strategyVersion) {
      strategyPeaksByAttrKey[buildStrategyAttributionKey(strategyId, strategyVersion)] = allocation;
    }
  }
  const { strategyDrawdownBpsByKey } = emptyDrawdownMaps();
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
    monthlyPeakHwm: startingCash,
    monthlyDrawdownBps: 0,
    strategyPeakHwmByKey: strategyPeaksByAttrKey,
    strategyDrawdownBpsByKey,
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
  const priorEquity = state.equity;
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
  return applyEquityDrawdownState(next, next.equity, frontierAsOf, priorEquity);
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
        monthlyPeakHwm: state.monthlyPeakHwm,
        monthlyDrawdownBps: state.monthlyDrawdownBps,
        strategyPeakHwmByKey: state.strategyPeakHwmByKey,
        strategyDrawdownBpsByKey: state.strategyDrawdownBpsByKey,
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
    const priorEquity = state.equity;
    state = {
      ...state,
      frontierAsOf: input.frontierAsOf,
      equity: state.cash,
      markedPositionValue: "0",
      marks: {},
    };
    state = applyEquityDrawdownState(state, state.equity, input.frontierAsOf, priorEquity);
  }

  const nextSequence = state.accountingSequence + 1;
  state = { ...state, accountingSequence: nextSequence, frontierAsOf: input.frontierAsOf };

  // Hot-path mark/fill advances (IDHPS): defer SHA-256 until checkpoint/terminal capture.
  const semanticContentDigest = input.skipSemanticDigest
    ? ""
    : computeAccountingSemanticDigest(state);
  const idempotencyKey =
    input.idempotencyKey ??
    `${state.organizationId}:${state.accountKey}:${state.runId}:${nextSequence}`;

  return {
    ...state,
    // Deterministic frontier id — avoids crypto.randomUUID() on every bar.
    id: input.frontierId ?? `${state.runId}:${nextSequence}`,
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
