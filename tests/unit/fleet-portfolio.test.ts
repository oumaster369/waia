import { describe, expect, it } from "vitest";

import type { AccountObservation } from "@/lib/trader/account-observation/types";
import { buildFleetPortfolio, type FleetAccountRef } from "@/lib/trader/admin/fleet-portfolio";

const account = (id: string, name: string): FleetAccountRef => ({
  organizationId: `00000000-0000-4000-8000-00000000000${id}`,
  accountName: name,
  credentialId: `00000000-0000-4000-8000-00000000010${id}`,
  exchangeAccountId: `htx-${id}`,
});

function observed(input: {
  asset: string;
  free: string;
  locked: string;
  total: string;
  orderId?: string;
  status?: AccountObservation["status"];
}): AccountObservation {
  const now = 1_700_000_000_000;
  const component = {
    status: "COMPLETE" as const,
    values: [] as never[],
    error: null,
    sourceAsOfMs: now,
    readStartedAtMs: now,
    readCompletedAtMs: now,
  };
  return {
    schemaVersion: "account-observation/v1",
    observationId: "33333333-3333-4333-8333-333333333333",
    binding: {
      organizationId: "00000000-0000-4000-8000-000000000001",
      credentialId: "00000000-0000-4000-8000-000000000101",
      exchangeAccountId: "htx-1",
      credentialRevision: "1",
      configurationRevision: "1",
    },
    collectionStartedAtMs: now,
    collectionCompletedAtMs: now,
    status: input.status ?? "COMPLETE",
    balances: {
      ...component,
      values: [{ asset: input.asset, free: input.free, locked: input.locked, total: input.total }],
    },
    openOrders: {
      ...component,
      values: input.orderId
        ? [
            {
              orderId: input.orderId,
              clientOrderId: input.orderId,
              symbol: "BTC-USDT",
              side: "buy",
              type: "limit",
              status: "open",
              price: "1",
              quantity: "2",
              filledQuantity: "0",
              createdAt: "2026-09-22T00:00:00.000Z",
              updatedAt: null,
            },
          ]
        : [],
    },
    trades: [{ symbol: "BTC-USDT", component }],
    holdings: null,
  };
}

describe("fleet portfolio fan-out", () => {
  it("sums two accounts and keeps the order's account", async () => {
    const first = account("1", "One");
    const second = account("2", "Two");
    const portfolio = await buildFleetPortfolio({
      accounts: [first, second],
      read: async (row) => ({
        ok: true,
        observation: observed({
          asset: "USDT",
          free: row.exchangeAccountId.endsWith("1") ? "10" : "0.5",
          locked: "1",
          total: row.exchangeAccountId.endsWith("1") ? "11" : "1.5",
          orderId: `order-${row.exchangeAccountId}`,
        }),
      }),
    });
    expect(portfolio.status).toBe("COMPLETE");
    expect(portfolio.balances).toEqual([
      { asset: "USDT", free: "10.5", locked: "2", total: "12.5" },
    ]);
    expect(portfolio.openOrders.map((order) => order.exchangeAccountId)).toEqual([
      "htx-1",
      "htx-2",
    ]);
    expect(portfolio.pnl.state).toBe("NO_TRADING_ACTIVITY");
  });

  it("is empty when no account is authorized", async () => {
    const portfolio = await buildFleetPortfolio({
      accounts: [],
      read: async () => ({ ok: true, observation: null }),
    });
    expect(portfolio.status).toBe("EMPTY");
    expect(portfolio.balances).toEqual([]);
  });

  it("does not treat an unauthorized account as zero", async () => {
    const visible = account("1", "One");
    const hidden = account("2", "Two");
    const portfolio = await buildFleetPortfolio({
      accounts: [visible, hidden],
      read: async (row) =>
        row.exchangeAccountId === "htx-2"
          ? { ok: false, reason: "HTTP_403" }
          : {
              ok: true,
              observation: observed({ asset: "USDT", free: "4", locked: "0", total: "4" }),
            },
    });
    expect(portfolio.status).toBe("PARTIAL");
    expect(portfolio.balances).toEqual([{ asset: "USDT", free: "4", locked: "0", total: "4" }]);
    expect(portfolio.unavailableAccounts).toEqual([
      { organizationId: hidden.organizationId, exchangeAccountId: "htx-2", reason: "HTTP_403" },
    ]);
  });

  it("names accounts dropped by the cap instead of pretending the sum is complete", async () => {
    const portfolio = await buildFleetPortfolio({
      accounts: [account("1", "One"), account("2", "Two")],
      maxAccounts: 1,
      read: async () => ({
        ok: true,
        observation: observed({ asset: "USDT", free: "1", locked: "0", total: "1" }),
      }),
    });
    expect(portfolio.status).toBe("PARTIAL");
    expect(portfolio.accountsConsidered).toBe(1);
    expect(portfolio.unavailableAccounts[0]?.reason).toBe("ACCOUNT_CAP");
    expect(portfolio.balances).toEqual([{ asset: "USDT", free: "1", locked: "0", total: "1" }]);
  });
});
