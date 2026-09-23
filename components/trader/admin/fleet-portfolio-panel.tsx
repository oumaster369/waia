"use client";

import * as React from "react";

import {
  AdminErrorState,
  AdminLoadingState,
  adminFetch,
} from "@/components/trader/admin/admin-org-selector";
import { WaiaSurface } from "@/components/waia/waia-surface";
import type { FleetPortfolio } from "@/lib/trader/admin/fleet-portfolio";

export function FleetPortfolioPanel() {
  const [portfolio, setPortfolio] = React.useState<FleetPortfolio | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const result = await adminFetch<FleetPortfolio>("/api/trader/admin/portfolio");
    if (!result.ok) {
      setError(result.message);
      setPortfolio(null);
    } else {
      setError(null);
      setPortfolio(result.data);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    const timer = window.setInterval(() => void load(), 60_000);
    const initial = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
    };
  }, [load]);

  return (
    <WaiaSurface variant="raised" className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Fleet balances and open orders</h2>
        {portfolio ? (
          <p className="font-mono text-xs" data-testid="fleet-portfolio-status">
            {portfolio.status}
          </p>
        ) : null}
      </div>
      {loading && !portfolio ? <AdminLoadingState label="Loading fleet…" /> : null}
      {error ? <AdminErrorState message={error} onRetry={() => void load()} /> : null}
      {portfolio ? (
        <>
          <p className="text-muted-foreground text-sm">{portfolio.pnl.reason}</p>
          <p className="font-mono text-sm" data-testid="fleet-pnl-state">
            {portfolio.pnl.state}
          </p>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 font-medium">Asset</th>
                <th className="py-1 font-medium">Free</th>
                <th className="py-1 font-medium">Locked</th>
                <th className="py-1 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.balances.length === 0 ? (
                <tr>
                  <td className="py-2" colSpan={4}>
                    No observed balances.
                  </td>
                </tr>
              ) : (
                portfolio.balances.map((row) => (
                  <tr key={row.asset}>
                    <td className="py-1">{row.asset}</td>
                    <td className="py-1 font-mono">{row.free}</td>
                    <td className="py-1 font-mono">{row.locked}</td>
                    <td className="py-1 font-mono">{row.total}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <h3 className="text-sm font-medium">Open orders</h3>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 font-medium">Account</th>
                <th className="py-1 font-medium">Symbol</th>
                <th className="py-1 font-medium">Side</th>
                <th className="py-1 font-medium">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.openOrders.length === 0 ? (
                <tr>
                  <td className="py-2" colSpan={4}>
                    No observed open orders.
                  </td>
                </tr>
              ) : (
                portfolio.openOrders.map((order) => (
                  <tr key={`${order.exchangeAccountId}:${order.orderId}`}>
                    <td className="py-1">{order.accountName}</td>
                    <td className="py-1">{order.symbol}</td>
                    <td className="py-1">{order.side}</td>
                    <td className="py-1 font-mono">{order.quantity}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {portfolio.unavailableAccounts.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              Not in the complete sum:{" "}
              {portfolio.unavailableAccounts
                .map((row) => `${row.exchangeAccountId} (${row.reason})`)
                .join(", ")}
            </p>
          ) : null}
        </>
      ) : null}
    </WaiaSurface>
  );
}
