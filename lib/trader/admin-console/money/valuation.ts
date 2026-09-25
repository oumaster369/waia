import type { AdminDataState } from "@/lib/trader/admin-console/contracts";
import {
  quoteIsStale,
  quoteSetDigest,
  selectUsdQuote,
  valuationKey,
  VALUATION_METHOD_VERSION,
  VALUATION_SKEW_AFTER_MS,
  type AssetQuote,
} from "@/lib/trader/admin-console/money/quotes";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import {
  InvalidDecimalError,
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export type ValuationBalance = { asset: string; free: string; locked: string };
export type ValuationLot = {
  asset: string;
  remainingQty: string;
  avgCost: string;
  accountMatched: boolean;
};

export type ValuationInput = {
  observationId: string;
  recordedAt: string;
  balances: readonly ValuationBalance[];
  lots: readonly ValuationLot[];
  lotsRevision: string;
  quotes: readonly AssetQuote[];
  currency: "USDT" | "USD";
  nowMs: number;
};

export type ValuationResult = {
  state: AdminDataState;
  reasons: string[];
  method: string;
  currency: "USDT" | "USD";
  freeQuote: string | null;
  lockedQuote: string | null;
  holdingsValue: string | null;
  equity: string | null;
  traderLotsValue: string | null;
  traderCostBasis: string | null;
  traderUnrealized: string | null;
  externalValue: string | null;
  valuationKey: string;
  excludedAssets: string[];
  quoteSet?: AssetQuote[];
};

/** Unknown assets are excluded individually; known assets retain a partial value. */
export function equityInclusion(
  reasons: readonly string[],
  equity: string | null,
): { included: boolean; stale: boolean } {
  const blocksEquity = reasons.some(
    (reason) =>
      reason !== ADMIN_REASON.costBasisUnknown &&
      reason !== "LOT_BALANCE_MISMATCH" &&
      reason !== ADMIN_REASON.quoteStale &&
      !reason.startsWith(`${ADMIN_REASON.noQuote}:`),
  );
  return {
    included: equity !== null && !blocksEquity,
    stale: reasons.includes(ADMIN_REASON.quoteStale),
  };
}

function quoteByAsset(quotes: readonly AssetQuote[], nowMs: number): Map<string, AssetQuote> {
  const selected = new Map<string, AssetQuote>();
  const fx = selectUsdQuote(quotes, nowMs);
  if (fx) selected.set("USDT", fx);
  for (const quote of [...quotes].sort(
    (a, b) => b.observedAt.localeCompare(a.observedAt) || a.price.localeCompare(b.price),
  )) {
    const asset = quote.asset.toUpperCase();
    const denomination = quote.quoteCurrency ?? (quote.source === "htx" ? "USDT" : "USD");
    const spot = asset !== "USDT" && quote.source === "htx" && denomination === "USDT";
    if (
      spot &&
      !selected.has(asset) &&
      /^\d+(?:\.\d+)?$/.test(quote.price) &&
      compareDecimal(quote.price, "0") > 0
    )
      selected.set(asset, quote);
  }
  return selected;
}

function worse(current: AdminDataState, next: AdminDataState): AdminDataState {
  const rank: Record<AdminDataState, number> = {
    ok: 0,
    empty: 1,
    stale: 2,
    partial: 3,
    unavailable: 4,
    forbidden: 5,
    not_applicable: 6,
  };
  return rank[next] > rank[current] ? next : current;
}

// Removing insignificant trailing zeroes is exact; rounding observed money is not.
function exactDecimal(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export function valueObservation(input: ValuationInput): ValuationResult {
  let relevantQuotes = input.quotes;
  try {
    const balances = input.balances.map((balance) => ({
      ...balance,
      free: exactDecimal(balance.free),
      locked: exactDecimal(balance.locked),
    }));
    const lots = input.lots.map((lot) => ({
      ...lot,
      remainingQty: exactDecimal(lot.remainingQty),
      avgCost: exactDecimal(lot.avgCost),
    }));
    const assets = new Set(
      balances
        .filter(
          (balance) =>
            compareDecimal(addDecimal(balance.free, balance.locked), "0") !== 0 &&
            balance.asset.toUpperCase() !== "USDT",
        )
        .map((balance) => balance.asset.toUpperCase()),
    );
    for (const lot of lots) if (lot.accountMatched) assets.add(lot.asset.toUpperCase());
    if (input.currency === "USD") assets.add("USDT");
    // Only prices used by this valuation can affect its result or precision state.
    relevantQuotes = input.quotes
      .filter((quote) => assets.has(quote.asset.toUpperCase()))
      .map((quote) => ({ ...quote, price: exactDecimal(quote.price) }));
    return computeObservation({
      ...input,
      balances,
      lots,
      quotes: relevantQuotes,
    });
  } catch (error) {
    if (!(error instanceof InvalidDecimalError)) throw error;
    return {
      state: "unavailable",
      reasons: ["MONEY_PRECISION_UNSUPPORTED"],
      method: input.currency === "USDT" ? VALUATION_METHOD_VERSION : "usdt_usd:unavailable",
      currency: input.currency,
      freeQuote: null,
      lockedQuote: null,
      holdingsValue: null,
      equity: null,
      traderLotsValue: null,
      traderCostBasis: null,
      traderUnrealized: null,
      externalValue: null,
      excludedAssets: [],
      valuationKey: valuationKey({
        observationId: input.observationId,
        lotsRevision: input.lotsRevision,
        quoteSetDigest: quoteSetDigest(relevantQuotes),
        methodVersion: "MONEY_PRECISION_UNSUPPORTED",
      }),
    };
  }
}

function computeObservation(input: ValuationInput): ValuationResult {
  const quotes = quoteByAsset(input.quotes, input.nowMs);
  const reasons: string[] = [];
  let state: AdminDataState = "ok";
  let freeQuote = "0";
  let lockedQuote = "0";
  let holdingsValue = "0";
  const excluded: string[] = [];
  const usedQuotes: AssetQuote[] = [];
  const recordQuote = (quote: AssetQuote) => {
    if (usedQuotes.includes(quote)) return;
    usedQuotes.push(quote);
    if (quoteIsStale(quote, input.nowMs)) {
      reasons.push(ADMIN_REASON.quoteStale);
      state = worse(state, "stale");
    }
    const skew = Math.abs(
      Date.parse(quote.sourceTs ?? quote.observedAt) - Date.parse(input.recordedAt),
    );
    if (Number.isFinite(skew) && skew > VALUATION_SKEW_AFTER_MS) {
      reasons.push(ADMIN_REASON.valuationSkew);
      state = worse(state, "partial");
    }
  };

  for (const balance of input.balances) {
    const asset = balance.asset.toUpperCase();
    if (asset === "USDT") {
      freeQuote = addDecimal(freeQuote, balance.free);
      lockedQuote = addDecimal(lockedQuote, balance.locked);
      continue;
    }
    if (compareDecimal(addDecimal(balance.free, balance.locked), "0") === 0) continue;
    const quote = quotes.get(asset);
    if (!quote) {
      excluded.push(asset);
      reasons.push(`${ADMIN_REASON.noQuote}:${asset}`);
      state = worse(state, "partial");
      continue;
    }
    recordQuote(quote);
    const quantity = addDecimal(balance.free, balance.locked);
    holdingsValue = addDecimal(holdingsValue, multiplyDecimal(quantity, quote.price));
  }

  const equityUsdt = addDecimal(addDecimal(freeQuote, lockedQuote), holdingsValue);
  let traderLotsValue = "0";
  let traderCostBasis = "0";
  let lotsKnown = true;
  const observedQuantities = new Map<string, string>();
  for (const balance of input.balances)
    observedQuantities.set(
      balance.asset.toUpperCase(),
      addDecimal(
        observedQuantities.get(balance.asset.toUpperCase()) ?? "0",
        addDecimal(balance.free, balance.locked),
      ),
    );
  const allocatedQuantities = new Map<string, string>();
  for (const lot of input.lots) {
    if (!lot.accountMatched) {
      lotsKnown = false;
      reasons.push(ADMIN_REASON.costBasisUnknown);
      state = worse(state, "partial");
      continue;
    }
    const quote = quotes.get(lot.asset.toUpperCase());
    if (!quote) {
      lotsKnown = false;
      reasons.push(`${ADMIN_REASON.noQuote}:${lot.asset.toUpperCase()}`);
      reasons.push(ADMIN_REASON.costBasisUnknown);
      state = worse(state, "partial");
      continue;
    }
    recordQuote(quote);
    const asset = lot.asset.toUpperCase();
    const allocated = addDecimal(allocatedQuantities.get(asset) ?? "0", lot.remainingQty);
    allocatedQuantities.set(asset, allocated);
    if (compareDecimal(allocated, observedQuantities.get(asset) ?? "0") > 0) {
      lotsKnown = false;
      reasons.push(ADMIN_REASON.costBasisUnknown, "LOT_BALANCE_MISMATCH");
      state = worse(state, "partial");
    }
    traderLotsValue = addDecimal(traderLotsValue, multiplyDecimal(lot.remainingQty, quote.price));
    traderCostBasis = addDecimal(traderCostBasis, multiplyDecimal(lot.remainingQty, lot.avgCost));
  }
  const traderUnrealized = lotsKnown ? subtractDecimal(traderLotsValue, traderCostBasis) : null;
  const externalValue =
    lotsKnown && excluded.length === 0 ? subtractDecimal(holdingsValue, traderLotsValue) : null;

  const usd = input.currency === "USD" ? quotes.get("USDT") : undefined;
  if (usd) recordQuote(usd);
  const method =
    input.currency === "USD"
      ? `usdt_usd:${usd?.source ?? "unavailable"}`
      : VALUATION_METHOD_VERSION;
  const digest = quoteSetDigest(usedQuotes);
  const key = valuationKey({
    observationId: input.observationId,
    lotsRevision: input.lotsRevision,
    quoteSetDigest: digest,
    methodVersion: method,
  });

  if (input.currency === "USD") {
    if (!usd) {
      return {
        state: "unavailable",
        reasons: [...new Set([...reasons, `${ADMIN_REASON.noQuote}:USDT-USD`])],
        method,
        currency: "USD",
        freeQuote: null,
        lockedQuote: null,
        holdingsValue: null,
        equity: null,
        traderLotsValue: null,
        traderCostBasis: null,
        traderUnrealized: null,
        externalValue: null,
        valuationKey: key,
        excludedAssets: excluded,
        quoteSet: usedQuotes,
      };
    }
    return {
      state,
      reasons: [...new Set(reasons)],
      method,
      currency: "USD",
      freeQuote: multiplyDecimal(freeQuote, usd.price),
      lockedQuote: multiplyDecimal(lockedQuote, usd.price),
      holdingsValue: multiplyDecimal(holdingsValue, usd.price),
      equity: multiplyDecimal(equityUsdt, usd.price),
      traderLotsValue: lotsKnown ? multiplyDecimal(traderLotsValue, usd.price) : null,
      traderCostBasis: lotsKnown ? multiplyDecimal(traderCostBasis, usd.price) : null,
      traderUnrealized: traderUnrealized ? multiplyDecimal(traderUnrealized, usd.price) : null,
      externalValue: externalValue ? multiplyDecimal(externalValue, usd.price) : null,
      valuationKey: key,
      excludedAssets: excluded,
      quoteSet: usedQuotes,
    };
  }

  return {
    state,
    reasons: [...new Set(reasons)],
    method: VALUATION_METHOD_VERSION,
    currency: "USDT",
    freeQuote,
    lockedQuote,
    holdingsValue,
    equity: equityUsdt,
    traderLotsValue: lotsKnown ? traderLotsValue : null,
    traderCostBasis: lotsKnown ? traderCostBasis : null,
    traderUnrealized,
    externalValue,
    valuationKey: key,
    excludedAssets: excluded,
    quoteSet: usedQuotes,
  };
}
