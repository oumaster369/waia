"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ObservationComponent } from "@/lib/trader/account-observation/types";
import {
  ageLabel,
  cabinetLiveLabel,
  cabinetSpotSource,
  formatBalanceLine,
  formatOrderLine,
  formatTradeLine,
  isObservedZeroAmount,
  majorSpotTotals,
  nonZeroBalances,
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

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <WaiaSurface variant="raised" className="p-4">
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
            ? emptyComplete
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

function transportCopy(transport: AccountObservationView["transport"]): string | null {
  if (transport === "STREAMING") return "Automatic stream connected.";
  if (transport === "POLLING") return "Automatic polling fallback; stream retry scheduled.";
  if (transport === "RECONNECTING") return "Reconnecting automatically.";
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
  const live =
    Boolean(observation) &&
    view.status !== "ERROR" &&
    view.status !== "DISCONNECTED" &&
    view.status !== "REVOKED";
  const spot = observation ? cabinetSpotSource(observation) : null;
  const active = observation ? nonZeroBalances(spot) : [];
  const majors = majorSpotTotals(spot);
  const dustCount = spot ? spot.filter((row) => isObservedZeroAmount(row.total)).length : 0;
  const openCount = observation?.openOrders.values?.length ?? null;
  const tradeCount =
    observation?.trades.reduce((sum, item) => sum + (item.component.values?.length ?? 0), 0) ??
    null;

  return (
    <section
      aria-label="Account observation"
      className="border-border space-y-4 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Account observation</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Live HTX spot evidence. Holdings are not strategy positions. PnL is not calculated here.
          </p>
        </div>
        <p
          role="status"
          className="border-border flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
        >
          <LiveDot live={live} />
          <span className="font-medium">{cabinetLiveLabel(view)}</span>
          <span className="text-muted-foreground">{view.status}</span>
          {view.stale && view.status !== "STALE" ? " · STALE" : ""}
        </p>
      </div>
      {view.transport && (
        <p className="text-waia-fg-muted text-sm">{transportCopy(view.transport)}</p>
      )}
      {!observation ? (
        <p>
          {view.status === "REVOKED"
            ? "Access revoked; account data cleared."
            : "No observation available."}
        </p>
      ) : (
        <>
          <p className="text-sm">
            HTX account {observation.binding.exchangeAccountId} · updated{" "}
            {ageLabel(observation.collectionCompletedAtMs, nowMs)}
          </p>
          {view.status !== "CURRENT" && (
            <p>
              Last received observation — do not treat it as a current complete account snapshot.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric
              label="USDT"
              value={majors.USDT ?? "—"}
              hint={majors.USDT === null ? "Not in this snapshot" : "Spot total"}
            />
            <Metric
              label="BTC"
              value={majors.BTC ?? "—"}
              hint={majors.BTC === null ? "Not in this snapshot" : "Spot total"}
            />
            <Metric
              label="ETH"
              value={majors.ETH ?? "—"}
              hint={majors.ETH === null ? "Not in this snapshot" : "Spot total"}
            />
            <Metric
              label="Open orders"
              value={openCount === null ? "—" : String(openCount)}
              hint={
                observation.openOrders.status === "COMPLETE" ? "Complete book" : "Bounded window"
              }
            />
            <Metric
              label="Spot assets"
              value={String(active.length)}
              hint={dustCount > 0 ? `${dustCount} zero-dust rows hidden` : "Non-zero totals"}
            />
          </div>
          <section className="border-border space-y-2 rounded-lg border p-3">
            <h3 className="font-medium">Holdings (balance-derived, not positions)</h3>
            {spot === null ? (
              <p>Unavailable — not an observed zero.</p>
            ) : spot.length === 0 ? (
              <p>
                {observation.balances.status === "COMPLETE"
                  ? "Observed zero rows."
                  : "No rows received; collection incomplete."}
              </p>
            ) : active.length === 0 ? (
              <p>
                No non-zero spot balances. HTX listed {dustCount} zero-dust rows; they are hidden so
                they are not mistaken for a portfolio.
              </p>
            ) : (
              <ul>
                {active.slice(0, MAX_VISIBLE_ROWS).map((row, i) => (
                  <li key={`${row.asset}-${i}`}>
                    {row.asset}: {row.total}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Rows
            title="Balances"
            component={
              observation.balances.values === null
                ? observation.balances
                : {
                    ...observation.balances,
                    values: nonZeroBalances(observation.balances.values),
                  }
            }
            emptyComplete={
              observation.balances.values &&
              observation.balances.values.length > 0 &&
              nonZeroBalances(observation.balances.values).length === 0
                ? "No non-zero balances in this complete list."
                : "Observed zero rows."
            }
          >
            {(row, i) => <li key={`${row.asset}-${i}`}>{formatBalanceLine(row)}</li>}
          </Rows>
          {observation.balances.values && dustCount > 0 && (
            <p className="text-muted-foreground text-xs">
              HTX zero-dust catalog · {dustCount} rows hidden from the live book.
            </p>
          )}
          <Rows
            title="Open orders"
            component={observation.openOrders}
            emptyComplete="Observed zero rows."
          >
            {(row, i) => <li key={`${row.orderId}-${i}`}>{formatOrderLine(row)}</li>}
          </Rows>
          {observation.trades.length === 0 && (
            <p>No trade symbols included; no all-market completeness claim.</p>
          )}
          {observation.trades.map(({ symbol, component }) => (
            <Rows
              key={symbol}
              title={`Trades · ${symbol}`}
              component={component}
              emptyComplete="Observed zero rows."
            >
              {(row, i) => <li key={`${row.tradeId}-${i}`}>{formatTradeLine(row)}</li>}
            </Rows>
          ))}
          {tradeCount === 0 && observation.trades.length > 0 ? (
            <p className="text-muted-foreground text-sm">
              No fills in the observed window. Empty is a real observation, not a missing stream.
            </p>
          ) : null}
          <dl className="text-muted-foreground grid gap-1 text-xs">
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
        </>
      )}
    </section>
  );
}
