import type { AdminDataState } from "@/lib/trader/admin-console/contracts";
import {
  quoteIsStale,
  quoteSetDigest,
  USD_METHOD_VERSION,
  valuationKey,
  VALUATION_METHOD_VERSION,
  VALUATION_SKEW_AFTER_MS,
  type AssetQuote,
} from "@/lib/trader/admin-console/money/quotes";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import { addDecimal, multiplyDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

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
};

/** Quote gaps and skew block equity. A missing lot match does not. */
export function equityInclusion(
  reasons: readonly string[],
  equity: string | null,
): { included: boolean; stale: boolean } {
  const blocksEquity = reasons.some(
    (reason) => reason !== ADMIN_REASON.costBasisUnknown && reason !== ADMIN_REASON.quoteStale,
  );
  return {
    included: equity !== null && !blocksEquity,
    stale: reasons.includes(ADMIN_REASON.quoteStale),
  };
}

function quoteByAsset(quotes: readonly AssetQuote[]): Map<string, AssetQuote> {
  return new Map(quotes.map((quote) => [quote.asset.toUpperCase(), quote]));
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

export function valueObservation(input: ValuationInput): ValuationResult {
  const quotes = quoteByAsset(input.quotes);
  const reasons: string[] = [];
  let state: AdminDataState = "ok";
  let freeQuote = "0";
  let lockedQuote = "0";
  let holdingsValue = "0";
  const excluded: string[] = [];
  const usedQuotes: AssetQuote[] = [];

  for (const balance of input.balances) {
    const asset = balance.asset.toUpperCase();
    if (asset === "USDT") {
      freeQuote = addDecimal(freeQuote, balance.free);
      lockedQuote = addDecimal(lockedQuote, balance.locked);
      continue;
    }
    const quote = quotes.get(asset);
    if (!quote) {
      excluded.push(asset);
      reasons.push(`${ADMIN_REASON.noQuote}:${asset}`);
      state = worse(state, "partial");
      continue;
    }
    usedQuotes.push(quote);
    const quantity = addDecimal(balance.free, balance.locked);
    holdingsValue = addDecimal(holdingsValue, multiplyDecimal(quantity, quote.price));
    if (quoteIsStale(quote, input.nowMs)) {
      reasons.push(ADMIN_REASON.quoteStale);
      state = worse(state, "stale");
    }
    if (quote.sourceTs) {
      const skew = Math.abs(Date.parse(quote.sourceTs) - Date.parse(input.recordedAt));
      if (Number.isFinite(skew) && skew > VALUATION_SKEW_AFTER_MS) {
        reasons.push(ADMIN_REASON.valuationSkew);
        state = worse(state, "partial");
      }
    }
  }

  const equityUsdt = addDecimal(addDecimal(freeQuote, lockedQuote), holdingsValue);
  let traderLotsValue = "0";
  let traderCostBasis = "0";
  let lotsKnown = true;
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
    traderLotsValue = addDecimal(traderLotsValue, multiplyDecimal(lot.remainingQty, quote.price));
    traderCostBasis = addDecimal(traderCostBasis, multiplyDecimal(lot.remainingQty, lot.avgCost));
  }
  const traderUnrealized = lotsKnown ? subtractDecimal(traderLotsValue, traderCostBasis) : null;
  const externalValue =
    lotsKnown && excluded.length === 0 ? subtractDecimal(holdingsValue, traderLotsValue) : null;

  const digest = quoteSetDigest(usedQuotes);
  const key = valuationKey({
    observationId: input.observationId,
    lotsRevision: input.lotsRevision,
    quoteSetDigest: digest,
  });

  if (input.currency === "USD") {
    const usd = quotes.get("USDT");
    if (!usd || usd.source !== "coinbase") {
      return {
        state: "unavailable",
        reasons: [...new Set([...reasons, `${ADMIN_REASON.noQuote}:USDT-USD`])],
        method: USD_METHOD_VERSION,
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
      };
    }
    return {
      state,
      reasons,
      method: USD_METHOD_VERSION,
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
  };
}
