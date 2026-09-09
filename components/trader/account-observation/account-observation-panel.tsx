"use client";

import type { ReactNode } from "react";
import type { ObservationComponent } from "@/lib/trader/account-observation/types";
import type { AccountObservationView } from "./use-account-observation";

const MAX_VISIBLE_ROWS = 100;
const time = (value: number | null) =>
  value !== null && Number.isFinite(value) && Math.abs(value) <= 8.64e15
    ? new Date(value).toISOString()
    : "Unknown";

function Rows<T>({
  title,
  component,
  children,
}: {
  title: string;
  component: ObservationComponent<T>;
  children: (row: T, index: number) => ReactNode;
}) {
  return (
    <section aria-label={title} className="border-border space-y-2 rounded-lg border p-3">
      <h3 className="font-medium">
        {title} · {component.status}
      </h3>
      <p className="text-waia-fg-muted text-xs">
        Source as of: {time(component.sourceAsOfMs)} · Read window:{" "}
        {time(component.readStartedAtMs)} – {time(component.readCompletedAtMs)}
      </p>
      {component.error && <p>Read error: {component.error}</p>}
      {component.values === null ? (
        <p>Unavailable — not an observed zero.</p>
      ) : component.values.length === 0 ? (
        <p>
          {component.status === "COMPLETE"
            ? "Observed zero rows."
            : "No rows received; collection incomplete."}
        </p>
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            {component.values.slice(0, MAX_VISIBLE_ROWS).map(children)}
          </ul>
          {component.values.length > MAX_VISIBLE_ROWS && (
            <p>
              Showing {MAX_VISIBLE_ROWS} of {component.values.length} received rows.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** One renderer for Admin and tenant; it cannot authorize reads or control trading. */
export function AccountObservationPanel({ view }: { view: AccountObservationView }) {
  const observation = view.status === "REVOKED" ? null : view.observation;
  return (
    <section
      aria-label="Account observation"
      className="border-border space-y-4 rounded-xl border p-4"
    >
      <h2 className="text-lg font-semibold">Account observation</h2>
      <p role="status">
        {view.status}
        {view.stale && view.status !== "STALE" ? " · STALE" : ""}
      </p>
      <p className="text-waia-fg-muted text-sm">
        Read-only evidence. Holdings are not strategy positions. PnL, cost basis and equity are not
        calculated here.
      </p>
      {!observation ? (
        <p>
          {view.status === "REVOKED"
            ? "Access revoked; account data cleared."
            : "No observation available."}
        </p>
      ) : (
        <>
          {view.status !== "CURRENT" && (
            <p>
              Last received observation — do not treat it as a current complete account snapshot.
            </p>
          )}
          <dl className="text-sm">
            <dt>Observation ID</dt>
            <dd>{observation.observationId}</dd>
            <dt>Organization</dt>
            <dd>{observation.binding.organizationId}</dd>
            <dt>Exchange account</dt>
            <dd>{observation.binding.exchangeAccountId}</dd>
            <dt>Collection completed</dt>
            <dd>{time(observation.collectionCompletedAtMs)}</dd>
            <dt>Completeness</dt>
            <dd>{observation.status}</dd>
          </dl>
          <p className="text-waia-fg-muted text-xs">
            Components have separate read windows; this is not an atomic exchange snapshot.
          </p>
          <Rows title="Balances" component={observation.balances}>
            {(row, i) => (
              <li key={`${row.asset}-${i}`}>
                {row.asset}: free {row.free}, locked {row.locked}, total {row.total}
              </li>
            )}
          </Rows>
          <section aria-label="Holdings">
            <h3>Holdings (balance-derived, not positions)</h3>
            {observation.holdings === null ? (
              <p>Unavailable — not an observed zero.</p>
            ) : observation.holdings.length === 0 ? (
              <p>No holdings in this observation.</p>
            ) : (
              <>
                <ul>
                  {observation.holdings.slice(0, MAX_VISIBLE_ROWS).map((row, i) => (
                    <li key={`${row.asset}-${i}`}>
                      {row.asset}: {row.total}
                    </li>
                  ))}
                </ul>
                {observation.holdings.length > MAX_VISIBLE_ROWS && (
                  <p>
                    Showing {MAX_VISIBLE_ROWS} of {observation.holdings.length} received rows.
                  </p>
                )}
              </>
            )}
          </section>
          <Rows title="Open orders" component={observation.openOrders}>
            {(row, i) => (
              <li key={`${row.orderId}-${i}`}>
                {row.symbol} {row.side} {row.type} · {row.status} · quantity {row.quantity}, filled{" "}
                {row.filledQuantity}, price {row.price ?? "Not provided"} · order {row.orderId}
              </li>
            )}
          </Rows>
          {observation.trades.length === 0 && (
            <p>No trade symbols included; no all-market completeness claim.</p>
          )}
          {observation.trades.map(({ symbol, component }) => (
            <Rows key={symbol} title={`Trades · ${symbol}`} component={component}>
              {(row, i) => (
                <li key={`${row.tradeId}-${i}`}>
                  {row.side} {row.quantity} @ {row.price} · fee {row.fee} {row.feeAsset} ·{" "}
                  {row.executedAt} · trade {row.tradeId}
                </li>
              )}
            </Rows>
          ))}
        </>
      )}
    </section>
  );
}
