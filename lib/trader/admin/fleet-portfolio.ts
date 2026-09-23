import { addDecimal } from "@/lib/trader/risk/numeric";
import type { AccountObservation } from "@/lib/trader/account-observation/types";

export const FLEET_PORTFOLIO_MAX_ACCOUNTS = 64;
export const FLEET_PORTFOLIO_BUDGET_MS = 10_000;

export type FleetAccountRef = Readonly<{
  organizationId: string;
  accountName: string;
  credentialId: string;
  exchangeAccountId: string;
}>;

export type FleetObservationRead =
  | Readonly<{ ok: true; observation: AccountObservation | null }>
  | Readonly<{ ok: false; reason: string }>;

export type FleetOpenOrder = Readonly<{
  organizationId: string;
  accountName: string;
  exchangeAccountId: string;
  orderId: string;
  symbol: string;
  side: string;
  type: string;
  status: string;
  price: string | null;
  quantity: string;
}>;

export type FleetPortfolio = Readonly<{
  status: "EMPTY" | "COMPLETE" | "PARTIAL";
  accountsConsidered: number;
  unavailableAccounts: readonly Readonly<{
    organizationId: string;
    exchangeAccountId: string;
    reason: string;
  }>[];
  balances: readonly Readonly<{ asset: string; free: string; locked: string; total: string }>[];
  openOrders: readonly FleetOpenOrder[];
  pnl: Readonly<{ state: "NO_TRADING_ACTIVITY"; reason: string }>;
}>;

const PNL: FleetPortfolio["pnl"] = {
  state: "NO_TRADING_ACTIVITY",
  reason: "Spot holdings are not a realized-profit receipt. Nothing is inferred as PnL.",
};

export async function buildFleetPortfolio(
  input: Readonly<{
    accounts: readonly FleetAccountRef[];
    read: (account: FleetAccountRef, signal: AbortSignal) => Promise<FleetObservationRead>;
    budgetMs?: number;
    maxAccounts?: number;
  }>,
): Promise<FleetPortfolio> {
  const maxAccounts = input.maxAccounts ?? FLEET_PORTFOLIO_MAX_ACCOUNTS;
  const budgetMs = input.budgetMs ?? FLEET_PORTFOLIO_BUDGET_MS;
  if (input.accounts.length === 0) {
    return {
      status: "EMPTY",
      accountsConsidered: 0,
      unavailableAccounts: [],
      balances: [],
      openOrders: [],
      pnl: PNL,
    };
  }
  const selected = input.accounts.slice(0, maxAccounts);
  const dropped = input.accounts.slice(maxAccounts).map((account) => ({
    organizationId: account.organizationId,
    exchangeAccountId: account.exchangeAccountId,
    reason: "ACCOUNT_CAP",
  }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  const balances = new Map<string, { free: string; locked: string; total: string }>();
  const openOrders: FleetOpenOrder[] = [];
  const unavailable = [...dropped];
  try {
    const reads = await Promise.all(
      selected.map(async (account) => {
        try {
          const result = await input.read(account, controller.signal);
          return { account, result };
        } catch {
          return {
            account,
            result: {
              ok: false as const,
              reason: controller.signal.aborted ? "BUDGET" : "READ_FAILED",
            },
          };
        }
      }),
    );
    for (const { account, result } of reads) {
      if (!result.ok) {
        unavailable.push({
          organizationId: account.organizationId,
          exchangeAccountId: account.exchangeAccountId,
          reason: result.reason,
        });
        continue;
      }
      if (!result.observation) continue;
      const contribution = contributionOf(result.observation, account);
      if (!contribution) {
        unavailable.push({
          organizationId: account.organizationId,
          exchangeAccountId: account.exchangeAccountId,
          reason: "UNREADABLE_OBSERVATION",
        });
        continue;
      }
      for (const row of contribution.balances) {
        const current = balances.get(row.asset) ?? { free: "0", locked: "0", total: "0" };
        balances.set(row.asset, {
          free: addDecimal(current.free, row.free),
          locked: addDecimal(current.locked, row.locked),
          total: addDecimal(current.total, row.total),
        });
      }
      openOrders.push(...contribution.openOrders);
      if (result.observation.status !== "COMPLETE") {
        unavailable.push({
          organizationId: account.organizationId,
          exchangeAccountId: account.exchangeAccountId,
          reason: "INCLUDED_PARTIAL_OBSERVATION",
        });
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return {
    status: unavailable.length > 0 ? "PARTIAL" : "COMPLETE",
    accountsConsidered: selected.length,
    unavailableAccounts: unavailable,
    balances: [...balances.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([asset, row]) => ({ asset, ...row })),
    openOrders: openOrders.sort(
      (a, b) =>
        a.exchangeAccountId.localeCompare(b.exchangeAccountId) ||
        a.orderId.localeCompare(b.orderId),
    ),
    pnl: PNL,
  };
}

function contributionOf(
  observation: AccountObservation,
  account: FleetAccountRef,
): {
  balances: { asset: string; free: string; locked: string; total: string }[];
  openOrders: FleetOpenOrder[];
} | null {
  try {
    for (const row of observation.balances.values ?? []) {
      addDecimal(row.free, "0");
      addDecimal(row.locked, "0");
      addDecimal(row.total, "0");
    }
    return {
      balances: [...(observation.balances.values ?? [])],
      openOrders: [...(observation.openOrders.values ?? [])].map((order) => ({
        organizationId: account.organizationId,
        accountName: account.accountName,
        exchangeAccountId: account.exchangeAccountId,
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        status: order.status,
        price: order.price ?? null,
        quantity: order.quantity,
      })),
    };
  } catch {
    return null;
  }
}
