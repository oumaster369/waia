import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import { applyCostToFill } from "@/lib/trader/execution/cost-model";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import {
  applyBuyFill,
  applySellFill,
  cloneLedgerMap,
  deriveCanonicalInventory,
  openPositionsFromCanonicalInventory,
  sortFillEvents,
  type SymbolLedger,
} from "@/lib/trader/paper/derive-canonical-inventory";
import {
  loadPaperFillEvents,
  type PaperPnLFillEvent,
} from "@/lib/trader/paper/load-paper-fill-events";
import {
  PaperPnLReconciliationError,
  PaperPnLScopeError,
} from "@/lib/trader/paper/paper-pnl.errors";
import type {
  PaperPnL,
  PaperPnLMarkPrices,
  PaperPositionPnL,
} from "@/lib/trader/paper/paper-pnl.types";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type DerivePaperPnLInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  executionMode?: PaperBookExecutionMode;
  markPrices?: PaperPnLMarkPrices;
};

export type { PaperPnLFillEvent } from "@/lib/trader/paper/load-paper-fill-events";
export type { LoadPaperFillEventsInput } from "@/lib/trader/paper/load-paper-fill-events";
export { loadPaperFillEvents } from "@/lib/trader/paper/load-paper-fill-events";

export type PaperPnLWalkResult = {
  ledgerBySymbol: Map<string, SymbolLedger>;
  feesByAsset: Record<string, string>;
  valuationGaps: string[];
  realizedPnl: string;
  totalFees: string;
};

function parseQuoteCurrency(symbol: string): string {
  const parts = symbol.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`[trader/paper] invalid symbol for quote currency: ${symbol}`);
  }
  return parts[1];
}

/**
 * Pure avg-cost fill walk. Exported for deterministic ordering tests.
 *
 * When `initialLedgerBySymbol` is supplied, the map is cloned before mutation.
 */
export function walkFillsForPnL(
  events: readonly PaperPnLFillEvent[],
  quoteCurrencyBySymbol: Readonly<Record<string, string>>,
  initialLedgerBySymbol?: Map<string, SymbolLedger>,
): PaperPnLWalkResult {
  const inventory = deriveCanonicalInventory(events, quoteCurrencyBySymbol, initialLedgerBySymbol);
  return {
    ledgerBySymbol: inventory.ledgerBySymbol,
    feesByAsset: inventory.feesByAsset,
    valuationGaps: inventory.valuationGaps,
    realizedPnl: inventory.realizedPnl,
    totalFees: inventory.totalFees,
  };
}

export type PaperFillClosedTrade = {
  fillId: string;
  orderId: string;
  symbol: string;
  executedAt: Date;
  quantity: string;
  price: string;
  tradePnl: string;
};

/** Synthetic window-boundary mark-to-close (H2 — not a real exchange SELL fill). */
export type PaperMarkToCloseTrade = {
  syntheticId: string;
  symbol: string;
  executedAt: Date;
  quantity: string;
  boundaryClosePrice: string;
  adjustedSellPrice: string;
  sellFee: string;
  tradePnl: string;
  syntheticClose: true;
};

/**
 * Walk opening + in-window fills and record per-sell trade PnL for in-window sells only.
 * Uses the same avg-cost economics as `walkFillsForPnL`.
 */
export function extractInWindowClosedTrades(
  openingEvents: readonly PaperPnLFillEvent[],
  inWindowEvents: readonly PaperPnLFillEvent[],
  quoteCurrencyBySymbol: Readonly<Record<string, string>>,
): PaperFillClosedTrade[] {
  const inWindowFillIds = new Set(inWindowEvents.map((event) => event.fill.id));
  const openingWalk = walkFillsForPnL(openingEvents, quoteCurrencyBySymbol);
  const ledgerBySymbol = cloneLedgerMap(openingWalk.ledgerBySymbol);
  const feesByAsset: Record<string, string> = { ...openingWalk.feesByAsset };
  const valuationGaps: string[] = [...openingWalk.valuationGaps];
  const closedTrades: PaperFillClosedTrade[] = [];

  for (const { fill, order } of sortFillEvents([...openingEvents, ...inWindowEvents])) {
    const quoteCurrency = quoteCurrencyBySymbol[order.symbol];
    if (!quoteCurrency) {
      throw new Error(`[trader/paper/pnl] missing quote currency for symbol ${order.symbol}`);
    }

    let ledger = ledgerBySymbol.get(order.symbol);
    if (!ledger) {
      ledger = { openQty: "0", avgCost: "0", realizedPnl: "0", sellFees: "0" };
      ledgerBySymbol.set(order.symbol, ledger);
    }

    if (order.side === "buy") {
      const quoteFee =
        fill.feeAsset === quoteCurrency && compareDecimal(fill.fee, "0") !== 0 ? fill.fee : "0";
      applyBuyFill(ledger, fill.price, fill.quantity, quoteFee);
      continue;
    }

    const quoteFee =
      fill.feeAsset === quoteCurrency && compareDecimal(fill.fee, "0") !== 0 ? fill.fee : "0";
    const proceeds = multiplyDecimal(fill.price, fill.quantity);
    const cost = multiplyDecimal(fill.quantity, ledger.avgCost);
    const tradePnl = subtractDecimal(subtractDecimal(proceeds, cost), quoteFee);

    if (inWindowFillIds.has(fill.id)) {
      closedTrades.push({
        fillId: fill.id,
        orderId: order.id,
        symbol: order.symbol,
        executedAt: fill.executedAt,
        quantity: fill.quantity,
        price: fill.price,
        tradePnl,
      });
    }

    applySellFill(ledger, fill.price, fill.quantity, quoteFee);
  }

  return closedTrades;
}

function defaultSyntheticFlatId(symbol: string): string {
  return `synthetic-flat:${symbol}`;
}

/**
 * Applies forced-flat mark-to-close at the evaluation window boundary (H2).
 * Uses boundary-bar close price, sell-side applyCostToFill, and marked PnL economics.
 */
export function extractForcedFlatMarkToCloseTrades(input: {
  openingEvents: readonly PaperPnLFillEvent[];
  inWindowEvents: readonly PaperPnLFillEvent[];
  quoteCurrencyBySymbol: Readonly<Record<string, string>>;
  boundaryClosePrice: string;
  boundaryTimestamp: Date;
  costModel: Pick<CostModelV1, "feesBps" | "slippageBps">;
  newSyntheticId?: (symbol: string) => string;
}): PaperMarkToCloseTrade[] {
  const openingWalk = walkFillsForPnL(input.openingEvents, input.quoteCurrencyBySymbol);
  const endWalk = walkFillsForPnL(
    input.inWindowEvents,
    input.quoteCurrencyBySymbol,
    openingWalk.ledgerBySymbol,
  );
  const newSyntheticId = input.newSyntheticId ?? defaultSyntheticFlatId;
  const markToCloseTrades: PaperMarkToCloseTrade[] = [];

  for (const [symbol, ledger] of endWalk.ledgerBySymbol.entries()) {
    if (compareDecimal(ledger.openQty, "0") <= 0) {
      continue;
    }

    const { adjustedPrice, fee } = applyCostToFill(
      input.boundaryClosePrice,
      ledger.openQty,
      "sell",
      input.costModel,
    );
    const proceeds = multiplyDecimal(adjustedPrice, ledger.openQty);
    const cost = multiplyDecimal(ledger.openQty, ledger.avgCost);
    const tradePnl = subtractDecimal(subtractDecimal(proceeds, cost), fee);

    markToCloseTrades.push({
      syntheticId: newSyntheticId(symbol),
      symbol,
      executedAt: input.boundaryTimestamp,
      quantity: ledger.openQty,
      boundaryClosePrice: input.boundaryClosePrice,
      adjustedSellPrice: adjustedPrice,
      sellFee: fee,
      tradePnl,
      syntheticClose: true,
    });
  }

  return markToCloseTrades.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function countOpenPositionsFromLedger(ledgerBySymbol: Map<string, SymbolLedger>): number {
  return [...ledgerBySymbol.values()].filter((ledger) => compareDecimal(ledger.openQty, "0") > 0)
    .length;
}

function resolveQuoteCurrency(
  symbols: readonly string[],
  markPrices: PaperPnLMarkPrices | undefined,
): string {
  const quoteCurrencies = new Set(symbols.map(parseQuoteCurrency));
  if (quoteCurrencies.size === 0) {
    return markPrices?.quoteCurrency ?? "USDT";
  }
  if (quoteCurrencies.size > 1) {
    throw new PaperPnLScopeError(
      `mixed quote currencies in book: ${[...quoteCurrencies].join(", ")}`,
    );
  }
  const inferred = [...quoteCurrencies][0]!;
  if (markPrices?.quoteCurrency && markPrices.quoteCurrency !== inferred) {
    throw new PaperPnLScopeError(
      `markPrices.quoteCurrency ${markPrices.quoteCurrency} does not match book quote ${inferred}`,
    );
  }
  return inferred;
}

function buildOpenPositions(
  bookPositions: readonly { symbol: string; quantity: string }[],
  ledgerBySymbol: Map<string, SymbolLedger>,
  markPrices: PaperPnLMarkPrices | undefined,
  valuationGaps: string[],
): { positions: PaperPositionPnL[]; unrealizedPnl: string | null } {
  if (bookPositions.length === 0) {
    return { positions: [], unrealizedPnl: markPrices ? "0" : null };
  }

  const marksProvided = markPrices !== undefined;
  let aggregateUnrealized: string | null = marksProvided ? "0" : null;
  const positions: PaperPositionPnL[] = [];

  for (const bookPosition of bookPositions) {
    const ledger = ledgerBySymbol.get(bookPosition.symbol);
    if (!ledger) {
      throw new PaperPnLReconciliationError(
        `paper book position ${bookPosition.symbol} missing from fill walk`,
      );
    }
    if (compareDecimal(ledger.openQty, bookPosition.quantity) !== 0) {
      throw new PaperPnLReconciliationError(
        `quantity mismatch for ${bookPosition.symbol}: book=${bookPosition.quantity} walk=${ledger.openQty}`,
      );
    }

    const costBasis = multiplyDecimal(bookPosition.quantity, ledger.avgCost);
    let markPrice: string | null = null;
    let marketValue: string | null = null;
    let unrealizedPnl: string | null = null;

    if (marksProvided) {
      const mark = markPrices.marks[bookPosition.symbol];
      if (mark === undefined) {
        valuationGaps.push(`Missing mark price for open symbol ${bookPosition.symbol}`);
        aggregateUnrealized = null;
      } else {
        markPrice = mark;
        marketValue = multiplyDecimal(bookPosition.quantity, mark);
        unrealizedPnl = subtractDecimal(marketValue, costBasis);
        if (aggregateUnrealized !== null) {
          aggregateUnrealized = addDecimal(aggregateUnrealized, unrealizedPnl);
        }
      }
    }

    positions.push({
      symbol: bookPosition.symbol,
      quantity: bookPosition.quantity,
      avgCost: ledger.avgCost,
      costBasis,
      markPrice,
      marketValue,
      realizedPnl: ledger.realizedPnl,
      unrealizedPnl,
      fees: ledger.sellFees,
    });
  }

  return { positions, unrealizedPnl: aggregateUnrealized };
}

function computeUnrealizedFromLedger(
  ledgerBySymbol: Map<string, SymbolLedger>,
  markPrices: PaperPnLMarkPrices,
  valuationGaps: string[],
): string | null {
  const openPositions = openPositionsFromCanonicalInventory({ ledgerBySymbol });
  if (openPositions.length === 0) {
    return "0";
  }

  let aggregateUnrealized: string | null = "0";
  for (const position of openPositions) {
    const ledger = ledgerBySymbol.get(position.symbol);
    if (!ledger) {
      continue;
    }
    const mark = markPrices.marks[position.symbol];
    if (mark === undefined) {
      valuationGaps.push(`Missing mark price for open symbol ${position.symbol}`);
      return null;
    }
    const costBasis = multiplyDecimal(position.quantity, ledger.avgCost);
    const marketValue = multiplyDecimal(position.quantity, mark);
    const unrealizedPnl = subtractDecimal(marketValue, costBasis);
    if (aggregateUnrealized !== null) {
      aggregateUnrealized = addDecimal(aggregateUnrealized, unrealizedPnl);
    }
  }

  return aggregateUnrealized;
}

export function resolvePaperPnLQuoteCurrency(
  symbols: readonly string[],
  markPrices: PaperPnLMarkPrices | undefined,
): string {
  return resolveQuoteCurrency(symbols, markPrices);
}

export function buildQuoteCurrencyBySymbol(symbols: readonly string[]): Record<string, string> {
  return Object.fromEntries(symbols.map((symbol) => [symbol, parseQuoteCurrency(symbol)]));
}

export type BuildPaperPnLFromLedgerInput = {
  organizationId: string;
  executionMode: PaperBookExecutionMode;
  quoteCurrency: string;
  walk: PaperPnLWalkResult;
  markPrices?: PaperPnLMarkPrices;
  derivedAt?: Date;
};

/** Build a PaperPnL snapshot from a completed fill walk (as-of boundary ledger). */
export function buildPaperPnLFromLedger(input: BuildPaperPnLFromLedgerInput): PaperPnL {
  const valuationGaps = [...input.walk.valuationGaps];
  const openPositions = openPositionsFromCanonicalInventory({
    ledgerBySymbol: input.walk.ledgerBySymbol,
  });
  const { positions, unrealizedPnl } = buildOpenPositions(
    openPositions,
    input.walk.ledgerBySymbol,
    input.markPrices,
    valuationGaps,
  );
  const totalPnl =
    unrealizedPnl === null ? null : addDecimal(input.walk.realizedPnl, unrealizedPnl);

  return {
    organizationId: input.organizationId,
    executionMode: input.executionMode,
    quoteCurrency: input.quoteCurrency,
    realizedPnl: input.walk.realizedPnl,
    unrealizedPnl,
    totalFees: input.walk.totalFees,
    totalPnl,
    positions,
    feesByAsset: { ...input.walk.feesByAsset },
    valuationGaps,
    derivedAt: input.derivedAt ?? new Date(),
  };
}

export function computeUnrealizedFromLedgerForMarks(
  ledgerBySymbol: Map<string, SymbolLedger>,
  markPrices: PaperPnLMarkPrices,
  valuationGaps: string[],
): string | null {
  return computeUnrealizedFromLedger(ledgerBySymbol, markPrices, valuationGaps);
}

/**
 * Idempotent derived Paper PnL from persisted mock/paper orders and fills.
 *
 * Operational read model — not billing, HWM, equity, or accounting ledger.
 */
export async function derivePaperPnL(input: DerivePaperPnLInput): Promise<PaperPnL> {
  const executionMode = input.executionMode ?? "mock";
  if (executionMode !== "mock" && executionMode !== "paper") {
    throw new PaperPnLScopeError(`execution mode ${executionMode} is out of scope for paper PnL`);
  }

  const [{ fillEvents, filledOrders }] = await Promise.all([
    loadPaperFillEvents({
      context: input.context,
      orderRepository: input.orderRepository,
      executionMode,
    }),
  ]);

  const symbols = [...new Set(filledOrders.map((order) => order.symbol))];
  const quoteCurrency = resolveQuoteCurrency(symbols, input.markPrices);
  const quoteCurrencyBySymbol = buildQuoteCurrencyBySymbol(symbols);

  const walk = walkFillsForPnL(fillEvents, quoteCurrencyBySymbol);
  const endSnapshot = buildPaperPnLFromLedger({
    organizationId: input.context.organizationId,
    executionMode,
    quoteCurrency,
    walk,
    markPrices: input.markPrices,
  });

  for (const bookPosition of openPositionsFromCanonicalInventory({
    ledgerBySymbol: walk.ledgerBySymbol,
  })) {
    const ledger = walk.ledgerBySymbol.get(bookPosition.symbol);
    if (!ledger) {
      throw new PaperPnLReconciliationError(
        `paper book position ${bookPosition.symbol} missing from fill walk`,
      );
    }
    if (compareDecimal(ledger.openQty, bookPosition.quantity) !== 0) {
      throw new PaperPnLReconciliationError(
        `quantity mismatch for ${bookPosition.symbol}: book=${bookPosition.quantity} walk=${ledger.openQty}`,
      );
    }
  }

  return endSnapshot;
}

export type { SymbolLedger } from "@/lib/trader/paper/derive-canonical-inventory";
