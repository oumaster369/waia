import type { AdminMode } from "@/lib/trader/admin-console/contracts";
import { orderMode } from "@/lib/trader/admin-console/modes/order-mode";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";

export type AttributionOrder = {
  id: string;
  organizationId: string;
  historicalRunId: string | null;
  executionMode: string;
  credentialId: string | null;
  strategySignalId: string | null;
  symbol: string;
};

export type AttributionCredential = {
  id: string;
  organizationId: string;
  exchangeAccountId: string;
};

export type AttributionLeg = {
  id: string;
  organizationId: string;
  orderId: string | null;
  strategySignalId: string | null;
  symbol: string;
  accountKey: string | null;
};

export type Attribution =
  | { state: "attributed"; mode: AdminMode; exchangeAccountId: string; organizationId: string }
  | { state: "ambiguous"; reason: typeof ADMIN_REASON.attributionAmbiguous }
  | { state: "unattributed"; reason: typeof ADMIN_REASON.unattributed };

/**
 * `trader_risk_account_state_v2.account_id` is the runtime account key.
 * The paper loop writes `accountKey` there. It is not `exchange_account_id`.
 * A lot matches that row only when `trader_position_lots.account_key` is equal.
 */
export function riskStateMatchesLot(input: {
  lotAccountKey: string;
  riskAccountId: string | null;
}): boolean {
  return input.riskAccountId !== null && input.riskAccountId === input.lotAccountKey;
}

export function attributeLegs(
  legs: readonly AttributionLeg[],
  orders: readonly AttributionOrder[],
  credentials: readonly AttributionCredential[],
): Attribution {
  if (legs.length === 0) return { state: "unattributed", reason: ADMIN_REASON.unattributed };
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const credentialById = new Map(credentials.map((credential) => [credential.id, credential]));
  const resolved: Array<{ mode: AdminMode; exchangeAccountId: string; organizationId: string }> =
    [];

  for (const leg of legs) {
    if (leg.orderId) {
      const order = orderById.get(leg.orderId);
      if (!order || order.organizationId !== leg.organizationId) {
        return { state: "unattributed", reason: ADMIN_REASON.unattributed };
      }
      const credential = order.credentialId ? credentialById.get(order.credentialId) : undefined;
      if (!credential || credential.organizationId !== order.organizationId)
        return { state: "unattributed", reason: ADMIN_REASON.unattributed };
      resolved.push({
        mode: orderMode(order),
        exchangeAccountId: credential.exchangeAccountId,
        organizationId: order.organizationId,
      });
      continue;
    }
    const candidates = orders.filter((order) => {
      if (order.organizationId !== leg.organizationId) return false;
      if (order.strategySignalId !== leg.strategySignalId) return false;
      if (order.symbol !== leg.symbol) return false;
      if (!order.credentialId) return false;
      const credential = credentialById.get(order.credentialId);
      if (!credential || credential.organizationId !== order.organizationId) return false;
      const account = credential.exchangeAccountId;
      return leg.accountKey == null || account === leg.accountKey;
    });
    if (candidates.length === 0) {
      return { state: "unattributed", reason: ADMIN_REASON.unattributed };
    }
    if (candidates.length !== 1) {
      return { state: "ambiguous", reason: ADMIN_REASON.attributionAmbiguous };
    }
    const order = candidates[0]!;
    const credential = credentialById.get(order.credentialId!)!;
    resolved.push({
      mode: orderMode(order),
      exchangeAccountId: credential.exchangeAccountId,
      organizationId: order.organizationId,
    });
  }

  const first = resolved[0];
  if (!first) return { state: "unattributed", reason: ADMIN_REASON.unattributed };
  const conflict = resolved.some(
    (item) =>
      item.mode !== first.mode ||
      item.exchangeAccountId !== first.exchangeAccountId ||
      item.organizationId !== first.organizationId,
  );
  if (conflict) return { state: "ambiguous", reason: ADMIN_REASON.attributionAmbiguous };
  return { state: "attributed", ...first };
}
