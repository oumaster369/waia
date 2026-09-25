import { adminRevision } from "@/lib/trader/admin-console/revision";
import type { AdminMode } from "@/lib/trader/admin-console/contracts";
import { orderMode } from "@/lib/trader/admin-console/modes/order-mode";
import {
  attributeLegs,
  type AttributionCredential,
  type AttributionOrder,
} from "@/lib/trader/admin-console/attribution/trade-attribution";
import type { ValuationLot } from "@/lib/trader/admin-console/money/valuation";

export type LotLegSource = {
  lotId: string;
  organizationId: string;
  symbol: string;
  remainingQty: string;
  avgCost: string;
  accountKey: string;
  legId: string | null;
  legCreatedAt: string | null;
  orderId: string | null;
  strategySignalId: string | null;
  order: AttributionOrder | null;
  credential: AttributionCredential | null;
};

export type AttributedOpenLot = {
  lotId: string;
  organizationId?: string;
  symbol: string;
  remainingQty: string;
  avgCost: string;
  exchangeAccountId: string | null;
  mode: AdminMode | null;
  matched: boolean;
  legCreatedAts: string[];
};

/** Base asset of a USDT spot symbol. Other quotes are not priced as USDT. */
export function baseAssetFromUsdtSymbol(symbol: string): string | null {
  if (symbol.endsWith("USDT") && symbol.length > 4) return symbol.slice(0, -4);
  return null;
}

/** `max(leg.created_at)` plus the leg count. Empty input stays the previous sentinel. */
export function lotsRevisionFromLegs(createdAts: readonly string[]): string {
  if (createdAts.length === 0) return "0";
  const latest = [...createdAts].sort().at(-1) ?? "0";
  return `${latest}:${createdAts.length}`;
}

export function assembleAttributedLots(rows: readonly LotLegSource[]): AttributedOpenLot[] {
  const byLot = new Map<string, LotLegSource[]>();
  for (const row of rows) {
    const list = byLot.get(row.lotId) ?? [];
    list.push(row);
    byLot.set(row.lotId, list);
  }
  return [...byLot.values()].map((legs) => {
    const first = legs[0]!;
    const orders = legs.flatMap((leg) => (leg.order ? [leg.order] : []));
    const credentials = legs.flatMap((leg) => (leg.credential ? [leg.credential] : []));
    const attribution = attributeLegs(
      legs.map((leg) => ({
        id: leg.legId ?? `unbound:${leg.lotId}`,
        organizationId: leg.organizationId,
        orderId: leg.orderId,
        strategySignalId: leg.strategySignalId,
        symbol: leg.symbol,
        accountKey: leg.accountKey,
      })),
      orders,
      credentials,
    );
    const observedModes = new Set(orders.map(orderMode));
    const knownMode =
      legs.every((leg) => leg.order !== null) && observedModes.size === 1
        ? orders[0]
          ? orderMode(orders[0])
          : null
        : null;
    return {
      lotId: first.lotId,
      organizationId: first.organizationId,
      symbol: first.symbol,
      remainingQty: first.remainingQty,
      avgCost: first.avgCost,
      exchangeAccountId: attribution.state === "attributed" ? attribution.exchangeAccountId : null,
      mode: attribution.state === "attributed" ? attribution.mode : knownMode,
      matched: attribution.state === "attributed",
      legCreatedAts: legs.flatMap((leg) => (leg.legCreatedAt ? [leg.legCreatedAt] : [])),
    };
  });
}

/**
 * Real exchange observations take live lots only, including when the console
 * mode is `all`. Paper and history stay on their own mode. An unmatched or
 * non-USDT lot is kept so unrealized stays unavailable.
 */
export function lotsForExchangeAccount(input: {
  organizationId?: string;
  exchangeAccountId: string;
  mode: string;
  lots: readonly AttributedOpenLot[];
}): { lots: ValuationLot[]; lotsRevision: string } {
  const selected = input.lots.filter((lot) => {
    if (input.organizationId && lot.organizationId !== input.organizationId) return false;
    // No account binding is not evidence that this account has no Trader cost
    // basis. Keep the ambiguity as a blocker, without adding its amount.
    if (!lot.matched && lot.exchangeAccountId === null)
      return lot.mode === null || lot.mode === (input.mode === "all" ? "live" : input.mode);
    if (lot.exchangeAccountId !== input.exchangeAccountId) return false;
    if (input.mode === "paper") return lot.mode === "paper";
    if (input.mode === "history") return lot.mode === "history";
    return lot.mode === "live";
  });
  return {
    lots: selected.map((lot) => {
      const asset = baseAssetFromUsdtSymbol(lot.symbol);
      return {
        asset: asset ?? lot.symbol,
        remainingQty: lot.remainingQty,
        avgCost: lot.avgCost,
        accountMatched: lot.matched && asset !== null,
      };
    }),
    lotsRevision: adminRevision(
      [...selected]
        .map((lot) => ({ ...lot, legCreatedAts: [...lot.legCreatedAts].sort() }))
        .sort((a, b) => a.lotId.localeCompare(b.lotId)),
    ),
  };
}
