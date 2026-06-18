import type {
  FillRow,
  OrderRepository,
  OrderRow,
} from "@/lib/trader/execution/order-repository.types";
import { derivePaperBook } from "@/lib/trader/paper/derive-paper-book";
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
  divideDecimal,
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

export type PaperPnLFillEvent = {
  fill: FillRow;
  order: OrderRow;
};

type SymbolLedger = {
  openQty: string;
  avgCost: string;
  realizedPnl: string;
  sellFees: string;
};

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

function isFilledOrder(order: OrderRow): boolean {
  return order.state === "FILLED" && compareDecimal(order.filledQuantity, "0") > 0;
}

function sortFillEvents(events: readonly PaperPnLFillEvent[]): PaperPnLFillEvent[] {
  return [...events].sort((a, b) => {
    const timeDelta = a.fill.executedAt.getTime() - b.fill.executedAt.getTime();
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return a.fill.id.localeCompare(b.fill.id);
  });
}

function accumulateFee(
  feesByAsset: Record<string, string>,
  valuationGaps: string[],
  feeAsset: string,
  fee: string,
  quoteCurrency: string,
  fillId: string,
): { quoteFee: string } {
  if (compareDecimal(fee, "0") === 0) {
    return { quoteFee: "0" };
  }

  if (feeAsset === quoteCurrency) {
    return { quoteFee: fee };
  }

  const current = feesByAsset[feeAsset] ?? "0";
  feesByAsset[feeAsset] = addDecimal(current, fee);
  valuationGaps.push(
    `Non-quote fee asset ${feeAsset} on fill ${fillId} recorded in feesByAsset only`,
  );
  return { quoteFee: "0" };
}

function createEmptyLedger(): SymbolLedger {
  return {
    openQty: "0",
    avgCost: "0",
    realizedPnl: "0",
    sellFees: "0",
  };
}

function cloneLedgerMap(source: Map<string, SymbolLedger>): Map<string, SymbolLedger> {
  const clone = new Map<string, SymbolLedger>();
  for (const [symbol, ledger] of source) {
    clone.set(symbol, { ...ledger });
  }
  return clone;
}

function applyBuyFill(
  ledger: SymbolLedger,
  fillPrice: string,
  fillQty: string,
  quoteBuyFee: string,
): void {
  const buyNotional = multiplyDecimal(fillPrice, fillQty);
  const effectiveUnitCost = divideDecimal(addDecimal(buyNotional, quoteBuyFee), fillQty);

  if (compareDecimal(ledger.openQty, "0") === 0) {
    ledger.avgCost = effectiveUnitCost;
    ledger.openQty = fillQty;
    return;
  }

  const priorCostBasis = multiplyDecimal(ledger.openQty, ledger.avgCost);
  const buyCostBasis = multiplyDecimal(fillQty, effectiveUnitCost);
  const nextQty = addDecimal(ledger.openQty, fillQty);
  ledger.avgCost = divideDecimal(addDecimal(priorCostBasis, buyCostBasis), nextQty);
  ledger.openQty = nextQty;
}

function applySellFill(
  ledger: SymbolLedger,
  fillPrice: string,
  fillQty: string,
  quoteSellFee: string,
): void {
  if (compareDecimal(fillQty, ledger.openQty) > 0) {
    throw new PaperPnLReconciliationError(
      `sell quantity ${fillQty} exceeds open quantity ${ledger.openQty}`,
    );
  }

  const proceeds = multiplyDecimal(fillPrice, fillQty);
  const cost = multiplyDecimal(fillQty, ledger.avgCost);
  const tradePnl = subtractDecimal(subtractDecimal(proceeds, cost), quoteSellFee);
  ledger.realizedPnl = addDecimal(ledger.realizedPnl, tradePnl);
  ledger.sellFees = addDecimal(ledger.sellFees, quoteSellFee);
  ledger.openQty = subtractDecimal(ledger.openQty, fillQty);
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
  const ledgerBySymbol = initialLedgerBySymbol
    ? cloneLedgerMap(initialLedgerBySymbol)
    : new Map<string, SymbolLedger>();
  const feesByAsset: Record<string, string> = {};
  const valuationGaps: string[] = [];

  for (const { fill, order } of sortFillEvents(events)) {
    const quoteCurrency = quoteCurrencyBySymbol[order.symbol];
    if (!quoteCurrency) {
      throw new Error(`[trader/paper/pnl] missing quote currency for symbol ${order.symbol}`);
    }

    const { quoteFee } = accumulateFee(
      feesByAsset,
      valuationGaps,
      fill.feeAsset,
      fill.fee,
      quoteCurrency,
      fill.id,
    );

    let ledger = ledgerBySymbol.get(order.symbol);
    if (!ledger) {
      ledger = createEmptyLedger();
      ledgerBySymbol.set(order.symbol, ledger);
    }

    if (order.side === "buy") {
      applyBuyFill(ledger, fill.price, fill.quantity, quoteFee);
    } else {
      applySellFill(ledger, fill.price, fill.quantity, quoteFee);
    }
  }

  let realizedPnl = "0";
  let totalFees = "0";
  for (const ledger of ledgerBySymbol.values()) {
    realizedPnl = addDecimal(realizedPnl, ledger.realizedPnl);
    totalFees = addDecimal(totalFees, ledger.sellFees);
  }

  return { ledgerBySymbol, feesByAsset, valuationGaps, realizedPnl, totalFees };
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

function openPositionsFromLedger(
  ledgerBySymbol: Map<string, SymbolLedger>,
): { symbol: string; quantity: string }[] {
  return [...ledgerBySymbol.entries()]
    .filter(([, ledger]) => compareDecimal(ledger.openQty, "0") > 0)
    .sort(([symbolA], [symbolB]) => symbolA.localeCompare(symbolB))
    .map(([symbol, ledger]) => ({ symbol, quantity: ledger.openQty }));
}

function computeUnrealizedFromLedger(
  ledgerBySymbol: Map<string, SymbolLedger>,
  markPrices: PaperPnLMarkPrices,
  valuationGaps: string[],
): string | null {
  const openPositions = openPositionsFromLedger(ledgerBySymbol);
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

export type LoadPaperFillEventsInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  executionMode: PaperBookExecutionMode;
};

export async function loadPaperFillEvents(
  input: LoadPaperFillEventsInput,
): Promise<{ fillEvents: PaperPnLFillEvent[]; filledOrders: OrderRow[] }> {
  const orders = await input.orderRepository.listOrders(input.context, {
    executionMode: input.executionMode,
  });
  const filledOrders = orders.filter(isFilledOrder);
  const fillEvents: PaperPnLFillEvent[] = [];

  for (const order of filledOrders) {
    const fills = await input.orderRepository.listFills(input.context, order.id);
    let fillQtySum = "0";
    for (const fill of fills) {
      fillQtySum = addDecimal(fillQtySum, fill.quantity);
      fillEvents.push({ fill, order });
    }
    if (compareDecimal(fillQtySum, order.filledQuantity) !== 0) {
      throw new PaperPnLReconciliationError(
        `order ${order.id} filled_quantity ${order.filledQuantity} does not match fill sum ${fillQtySum}`,
      );
    }
  }

  return { fillEvents, filledOrders };
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
  const openPositions = openPositionsFromLedger(input.walk.ledgerBySymbol);
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

  const [book, { fillEvents, filledOrders }] = await Promise.all([
    derivePaperBook({
      context: input.context,
      orderRepository: input.orderRepository,
      executionMode,
    }),
    loadPaperFillEvents({
      context: input.context,
      orderRepository: input.orderRepository,
      executionMode,
    }),
  ]);

  const symbols = [
    ...new Set([
      ...book.positions.map((position) => position.symbol),
      ...filledOrders.map((order) => order.symbol),
    ]),
  ];
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

  for (const bookPosition of book.positions) {
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
