"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ObservationComponent } from "@/lib/trader/account-observation/types";
import {
  ACCOUNT_OBSERVATION_FIRST_TICK_COPY,
  ageLabel,
  cabinetLiveLabel,
  formatOrderLine,
  formatTradeLine,
  nonUsdtInventory,
  secondsUntilNextPoll,
  usdtSpot,
} from "@/lib/trader/account-observation/cabinet-view";
import { WaiaSurface } from "@/components/waia/waia-surface";
import type { AccountObservationView } from "./use-account-observation";

const MAX_VISIBLE_ROWS = 100;
const time = (value: number | null) =>
  value !== null && Number.isFinite(value) && Math.abs(value) <= 8.64e15
    ? new Date(value).toISOString()
    : "Unknown";

function LiveDot({ live }: { live: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 rounded-full ${
        live ? "bg-emerald-400 motion-safe:animate-pulse" : "bg-waia-fg-muted"
      }`}
    />
  );
}

function Metric({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <WaiaSurface variant="raised" className="p-4" data-testid={testId}>
      <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </WaiaSurface>
  );
}

function Rows<T>({
  title,
  component,
  emptyComplete,
  children,
}: {
  title: string;
  component: ObservationComponent<T>;
  emptyComplete: string;
  children: (row: T, index: number) => ReactNode;
}) {
  return (
    <section aria-label={title} className="border-border space-y-2 rounded-lg border p-3">
      <h3 className="font-medium">{title}</h3>
      {component.error && <p>Read error: {component.error}</p>}
      {component.values === null ? (
        <p>Unavailable — not an observed zero.</p>
      ) : component.values.length === 0 ? (
        <p>{emptyComplete}</p>
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

function transportCopy(view: AccountObservationView): string | null {
  if (!view.observation) return null;
  if (view.transport === "STREAMING") return "Automatic stream connected.";
  if (view.transport === "POLLING") return "Automatic polling fallback; stream retry scheduled.";
  if (view.transport === "RECONNECTING") return "Reconnecting automatically.";
  return null;
}

/** One renderer for Admin and tenant; it cannot authorize reads or control trading. */
export function AccountObservationPanel({ view }: { view: AccountObservationView }) {
  const observation = view.status === "REVOKED" ? null : view.observation;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!observation) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [observation]);
  const live = Boolean(observation) && !view.stale && view.status !== "REVOKED";
  const usdt = observation ? usdtSpot(observation.balances.values) : null;
  const inventory = observation ? nonUsdtInventory(observation.balances.values) : [];
  const nextIn = observation ? secondsUntilNextPoll(observation.collectionCompletedAtMs, nowMs) : 0;

  return (
    <section
      aria-label="Account observation"
      className="border-border space-y-4 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Live account</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Read-only HTX spot. This cabinet does not place orders or calculate PnL.
          </p>
        </div>
        <p
          role="status"
          className="border-border flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
        >
          <LiveDot live={live} />
          <span className="font-medium">{cabinetLiveLabel(view)}</span>
          {observation ? (
            <span className="text-muted-foreground">{view.status}</span>
          ) : (
            <span className="sr-only">{view.status}</span>
          )}
          {view.stale && view.status !== "STALE" ? " · STALE" : ""}
        </p>
      </div>
      {transportCopy(view) ? (
        <p className="text-waia-fg-muted text-sm">{transportCopy(view)}</p>
      ) : null}
      {!observation ? (
        <p>
          {view.status === "REVOKED"
            ? "Access revoked; account data cleared."
            : view.status === "DISCONNECTED"
              ? "No observation available."
              : ACCOUNT_OBSERVATION_FIRST_TICK_COPY}
        </p>
      ) : (
        <>
          <p className="text-sm">
            HTX {observation.binding.exchangeAccountId} · last update{" "}
            {ageLabel(observation.collectionCompletedAtMs, nowMs)} ·{" "}
            {nextIn > 0 ? `next update in ${nextIn}s` : "awaiting the next collector tick"}
          </p>
          <p className="text-muted-foreground text-xs">
            Last received observation — do not treat it as a current complete account snapshot.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Metric
              label="USDT free"
              value={usdt ? usdt.free : "—"}
              hint={usdt ? "Available to open orders" : "Not in this snapshot"}
              testId="cabinet-usdt-free"
            />
            <Metric
              label="USDT in open orders"
              value={usdt ? usdt.locked : "—"}
              hint={usdt ? "Locked on HTX" : "Not in this snapshot"}
              testId="cabinet-usdt-locked"
            />
            <Metric
              label="Open orders"
              value={
                observation.openOrders.values === null
                  ? "—"
                  : String(observation.openOrders.values.length)
              }
              hint="Working orders, not marked positions"
              testId="cabinet-open-orders"
            />
          </div>
          {observation.balances.error ? <p>Read error: {observation.balances.error}</p> : null}
          {observation.balances.values === null ? <p>Unavailable — not an observed zero.</p> : null}
          {observation.holdings === null ? <p>Unavailable — not an observed zero.</p> : null}
          {inventory.length > 0 ? (
            <section className="border-border space-y-2 rounded-lg border p-3">
              <h3 className="font-medium">Spot inventory (not PnL)</h3>
              <ul>
                {inventory.slice(0, MAX_VISIBLE_ROWS).map((row, i) => (
                  <li key={`${row.asset}-${i}`}>
                    {row.asset}: free {row.free}, locked {row.locked}, total {row.total}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <Rows
            title="Open orders"
            component={observation.openOrders}
            emptyComplete="No working orders."
          >
            {(row, i) => <li key={`${row.orderId}-${i}`}>{formatOrderLine(row)}</li>}
          </Rows>
          {observation.trades.length === 0 && (
            <p>No trade symbols included; no all-market completeness claim.</p>
          )}
          {observation.trades.map(({ symbol, component }) => (
            <Rows
              key={symbol}
              title="Trades"
              component={component}
              emptyComplete="No fills in this window."
            >
              {(row, i) => (
                <li key={`${row.tradeId}-${i}`}>{formatTradeLine({ ...row, symbol })}</li>
              )}
            </Rows>
          ))}
          <p className="text-muted-foreground text-sm">
            Monthly statement is not published in this cabinet yet. Nothing is inferred.
          </p>
          <dl className="text-muted-foreground grid gap-1 text-xs">
            <dt>Observation ID</dt>
            <dd>{observation.observationId}</dd>
            <dt>HTX account</dt>
            <dd>{observation.binding.exchangeAccountId}</dd>
            <dt>Collection completed</dt>
            <dd>{time(observation.collectionCompletedAtMs)}</dd>
            <dt>Completeness</dt>
            <dd>{observation.status}</dd>
          </dl>
        </>
      )}
    </section>
  );
}
