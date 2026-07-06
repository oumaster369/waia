import { PaperPnLReconciliationError } from "@/lib/trader/paper/paper-pnl.errors";
import {
  INVENTORY_SEMANTICS_VERSION,
  type InventorySemanticsVersion,
} from "@/lib/trader/paper/inventory-semantics";
import type { PaperPnLFillEvent } from "@/lib/trader/paper/load-paper-fill-events";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  minDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export type { PaperPnLFillEvent } from "@/lib/trader/paper/load-paper-fill-events";

export type SymbolLedger = {
  openQty: string;
  avgCost: string;
  realizedPnl: string;
  sellFees: string;
};

export type CanonicalInventoryWalkResult = {
  semanticsVersion: InventorySemanticsVersion;
  ledgerBySymbol: Map<string, SymbolLedger>;
  openQtyBySymbol: Map<string, string>;
  avgCostBySymbol: Map<string, string>;
  feesByAsset: Record<string, string>;
  valuationGaps: string[];
  realizedPnl: string;
  totalFees: string;
};

export function sortFillEvents(events: readonly PaperPnLFillEvent[]): PaperPnLFillEvent[] {
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

export function cloneLedgerMap(source: Map<string, SymbolLedger>): Map<string, SymbolLedger> {
  const clone = new Map<string, SymbolLedger>();
  for (const [symbol, ledger] of source) {
    clone.set(symbol, { ...ledger });
  }
  return clone;
}

export function applyBuyFill(
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

export function applySellFill(
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

function buildOpenQtyMaps(ledgerBySymbol: Map<string, SymbolLedger>): {
  openQtyBySymbol: Map<string, string>;
  avgCostBySymbol: Map<string, string>;
} {
  const openQtyBySymbol = new Map<string, string>();
  const avgCostBySymbol = new Map<string, string>();
  for (const [symbol, ledger] of ledgerBySymbol.entries()) {
    openQtyBySymbol.set(symbol, ledger.openQty);
    avgCostBySymbol.set(symbol, ledger.avgCost);
  }
  return { openQtyBySymbol, avgCostBySymbol };
}

/**
 * Canonical symbol-level inventory from fill events (fee-adjusted avg cost, strict sells).
 */
export function deriveCanonicalInventory(
  events: readonly PaperPnLFillEvent[],
  quoteCurrencyBySymbol: Readonly<Record<string, string>>,
  initialLedgerBySymbol?: Map<string, SymbolLedger>,
): CanonicalInventoryWalkResult {
  const ledgerBySymbol = initialLedgerBySymbol
    ? cloneLedgerMap(initialLedgerBySymbol)
    : new Map<string, SymbolLedger>();
  const feesByAsset: Record<string, string> = {};
  const valuationGaps: string[] = [];

  for (const { fill, order } of sortFillEvents(events)) {
    const quoteCurrency = quoteCurrencyBySymbol[order.symbol];
    if (!quoteCurrency) {
      throw new Error(`[trader/paper/inventory] missing quote currency for symbol ${order.symbol}`);
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

  const { openQtyBySymbol, avgCostBySymbol } = buildOpenQtyMaps(ledgerBySymbol);

  return {
    semanticsVersion: INVENTORY_SEMANTICS_VERSION,
    ledgerBySymbol,
    openQtyBySymbol,
    avgCostBySymbol,
    feesByAsset,
    valuationGaps,
    realizedPnl,
    totalFees,
  };
}

export function getCanonicalOpenQty(
  openQtyBySymbol: ReadonlyMap<string, string>,
  symbol: string,
): string {
  return openQtyBySymbol.get(symbol) ?? "0";
}

/** Caps sell quantity to symbol open qty minus already-allocated batch exits. */
export function capSellQuantityToInventory(input: {
  symbol: string;
  requestedQty: string;
  openQtyBySymbol: ReadonlyMap<string, string>;
  batchAllocatedBySymbol?: ReadonlyMap<string, string>;
}): string {
  const openQty = getCanonicalOpenQty(input.openQtyBySymbol, input.symbol);
  const allocated = input.batchAllocatedBySymbol?.get(input.symbol) ?? "0";
  const available = subtractDecimal(openQty, allocated);
  if (compareDecimal(available, "0") <= 0) {
    return "0";
  }
  return minDecimal(input.requestedQty, available);
}

export function openPositionsFromCanonicalInventory(
  inventory: Pick<CanonicalInventoryWalkResult, "ledgerBySymbol">,
): { symbol: string; quantity: string }[] {
  return [...inventory.ledgerBySymbol.entries()]
    .filter(([, ledger]) => compareDecimal(ledger.openQty, "0") > 0)
    .sort(([symbolA], [symbolB]) => symbolA.localeCompare(symbolB))
    .map(([symbol, ledger]) => ({ symbol, quantity: ledger.openQty }));
}
