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

type FillEvent = {
  fill: FillRow;
  order: OrderRow;
};

type SymbolLedger = {
  openQty: string;
  avgCost: string;
  realizedPnl: string;
  sellFees: string;
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

function sortFillEvents(events: readonly FillEvent[]): FillEvent[] {
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
 */
export function walkFillsForPnL(
  events: readonly FillEvent[],
  quoteCurrencyBySymbol: Readonly<Record<string, string>>,
): {
  ledgerBySymbol: Map<string, SymbolLedger>;
  feesByAsset: Record<string, string>;
  valuationGaps: string[];
  realizedPnl: string;
  totalFees: string;
} {
  const ledgerBySymbol = new Map<string, SymbolLedger>();
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
      ledger = {
        openQty: "0",
        avgCost: "0",
        realizedPnl: "0",
        sellFees: "0",
      };
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

  const [book, orders] = await Promise.all([
    derivePaperBook({
      context: input.context,
      orderRepository: input.orderRepository,
      executionMode,
    }),
    input.orderRepository.listOrders(input.context, { executionMode }),
  ]);

  const filledOrders = orders.filter(isFilledOrder);
  const symbols = [
    ...new Set([
      ...book.positions.map((position) => position.symbol),
      ...filledOrders.map((order) => order.symbol),
    ]),
  ];
  const quoteCurrency = resolveQuoteCurrency(symbols, input.markPrices);
  const quoteCurrencyBySymbol = Object.fromEntries(
    symbols.map((symbol) => [symbol, parseQuoteCurrency(symbol)]),
  );

  const fillEvents: FillEvent[] = [];
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

  const walk = walkFillsForPnL(fillEvents, quoteCurrencyBySymbol);
  const { positions, unrealizedPnl } = buildOpenPositions(
    book.positions,
    walk.ledgerBySymbol,
    input.markPrices,
    walk.valuationGaps,
  );

  const totalPnl = unrealizedPnl === null ? null : addDecimal(walk.realizedPnl, unrealizedPnl);

  return {
    organizationId: input.context.organizationId,
    executionMode,
    quoteCurrency,
    realizedPnl: walk.realizedPnl,
    unrealizedPnl,
    totalFees: walk.totalFees,
    totalPnl,
    positions,
    feesByAsset: walk.feesByAsset,
    valuationGaps: walk.valuationGaps,
    derivedAt: new Date(),
  };
}
