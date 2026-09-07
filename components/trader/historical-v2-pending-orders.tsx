import { WaiaSurface } from "@/components/waia/waia-surface";
import type { HistoricalObservableAccountV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-v2";

export function HistoricalV2PendingOrders({ accounts, replayCompleted }: {
  accounts: readonly Pick<HistoricalObservableAccountV2, "accountId" | "cycleSequence" | "pendingModeledOrders">[];
  replayCompleted: boolean;
}) {
  return <div className="space-y-3" data-testid="historical-pending-orders">
    {accounts.map(account => <WaiaSurface key={account.accountId} variant="raised" className="space-y-2 p-4">
      <h3 className="font-medium">Pending modeled orders · {account.accountId}</h3>
      <p className="text-muted-foreground text-xs">State at committed cycle {account.cycleSequence}. These are simulated orders, not live exchange orders.</p>
      {!Array.isArray(account.pendingModeledOrders)
        ? <p role="status">Pending-order evidence unavailable. Settlement cannot be confirmed.</p>
        : <>
          {replayCompleted && account.pendingModeledOrders.length > 0
            ? <p role="status" className="text-amber-300">Replay extent completed with unsettled modeled orders. No later bar or automatic settlement is implied.</p> : null}
          {account.pendingModeledOrders.length === 0
            ? <p className="text-muted-foreground text-sm">No pending modeled orders at this checkpoint.</p>
            : <ul className="space-y-2 text-sm">{account.pendingModeledOrders.map(order =>
              <li key={order.orderId} className="rounded border p-3">
                <p>{order.symbol} · {order.side.toUpperCase()} · {order.state}</p>
                <p>Quantity {order.quantity} · Filled {order.filledQuantity} · Remaining {order.remainingQuantity}</p>
                <p className="break-all font-mono text-xs">Order {order.orderId}</p>
                {order.cancellationPending ? <p>Cancellation pending — not yet cancelled.</p> : null}
              </li>)}</ul>}
        </>}
    </WaiaSurface>)}
  </div>;
}
