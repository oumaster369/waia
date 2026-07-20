import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { PairingKey, TradeLineageAtOpen } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { buildPairingKey } from "@/lib/trader/lifecycle/trade-lifecycle.types";

export type ResolvePairingScopeInput = {
  organizationId: string;
  order: OrderRow;
  accountKey: string;
  lineage: TradeLineageAtOpen;
};

export function resolvePairingScope(input: ResolvePairingScopeInput): PairingKey {
  return {
    organizationId: input.organizationId,
    symbol: input.order.symbol,
    strategySignalId: input.lineage.strategySignalId,
    positionSide: "LONG",
    accountKey: input.accountKey,
  };
}

export function pairingKeyToString(key: PairingKey): string {
  return buildPairingKey(key);
}

export function scopesMatch(a: PairingKey, b: PairingKey): boolean {
  return (
    a.organizationId === b.organizationId &&
    a.symbol === b.symbol &&
    a.strategySignalId === b.strategySignalId &&
    a.positionSide === b.positionSide &&
    a.accountKey === b.accountKey
  );
}

export type OpenPositionLotsFilter = {
  symbol?: string;
  strategySignalId?: string;
  accountKey?: string;
};

export function openLotsFilterFromScope(scope: PairingKey): OpenPositionLotsFilter {
  return {
    symbol: scope.symbol,
    strategySignalId: scope.strategySignalId,
    accountKey: scope.accountKey,
  };
}
