import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import { RU } from "@/components/trader/admin-console/i18n/ru";

export type OverviewView = {
  state: "unavailable" | "ready";
  reason: string | null;
  coverageLabel: string | null;
  currency: string;
  equity: string | null;
  free: string | null;
  holdings: string | null;
  reserved: string | null;
  pnl: string | null;
  excluded: { id: string; reason: string }[];
  lastKnownEstimate: string | null;
};

function amountOf(fact: unknown): string | null {
  if (!fact || typeof fact !== "object" || !("value" in fact)) return null;
  const value = fact.value;
  if (!value || typeof value !== "object" || !("amount" in value)) return null;
  return typeof value.amount === "string" ? value.amount : null;
}

export function overviewFromEnvelope(body: unknown): OverviewView {
  const data =
    body && typeof body === "object" && "data" in body
      ? (body as { data?: unknown; coverage?: { excluded?: { id: string; reason: string }[] } })
          .data
      : null;
  const coverage =
    body && typeof body === "object" && "coverage" in body
      ? (body as { coverage?: { excluded?: { id: string; reason: string }[] } }).coverage
      : null;
  if (!data || typeof data !== "object") {
    return empty("POSTGRES_REQUIRED");
  }
  if ("state" in data && data.state === "unavailable") {
    const reasons = "reasons" in data && Array.isArray(data.reasons) ? data.reasons : [];
    return empty(typeof reasons[0] === "string" ? reasons[0] : "POSTGRES_REQUIRED");
  }
  const finance = "finance" in data ? data.finance : null;
  const record = finance && typeof finance === "object" ? finance : {};
  return {
    state: "ready",
    reason: null,
    coverageLabel:
      "coverageLabel" in data && typeof data.coverageLabel === "string" ? data.coverageLabel : null,
    currency: "USDT",
    equity: amountOf(record && "equity" in record ? record.equity : null),
    free: amountOf(record && "free" in record ? record.free : null),
    holdings: amountOf(record && "holdings" in record ? record.holdings : null),
    reserved: amountOf(record && "reserved" in record ? record.reserved : null),
    pnl: amountOf(record && "pnl" in record ? record.pnl : null),
    excluded: coverage?.excluded ?? [],
    lastKnownEstimate:
      "lastKnownEstimate" in data && typeof data.lastKnownEstimate === "string"
        ? data.lastKnownEstimate
        : null,
  };
}

function empty(reason: string): OverviewView {
  return {
    state: "unavailable",
    reason,
    coverageLabel: null,
    currency: "USDT",
    equity: null,
    free: null,
    holdings: null,
    reserved: null,
    pnl: null,
    excluded: [],
    lastKnownEstimate: null,
  };
}

function figure(label: string, amount: string | null, currency: string) {
  return (
    <p>
      <span>{label}</span>{" "}
      <span data-testid={`overview-${label}`}>
        {amount === null ? "—" : formatAdminMoney(amount, currency)}
      </span>
    </p>
  );
}

export function OverviewPanel({ view }: { view: OverviewView }) {
  if (view.state === "unavailable") {
    return <DataState state="unavailable" reason={view.reason} />;
  }
  return (
    <section aria-label={RU.sections.overview}>
      {figure("Оценка", view.equity, view.currency)}
      {figure("Свободно", view.free, view.currency)}
      {figure("В активах", view.holdings, view.currency)}
      {figure("Занято", view.reserved, view.currency)}
      {figure("Результат", view.pnl, view.currency)}
      {view.coverageLabel ? <p>{view.coverageLabel}</p> : null}
      {view.excluded.length > 0 ? (
        <ul>
          {view.excluded.map((row) => (
            <li key={row.id}>{`${row.id}: ${row.reason}`}</li>
          ))}
        </ul>
      ) : null}
      {view.lastKnownEstimate ? (
        <p data-testid="overview-last-known">{`Последняя известная оценка ${formatAdminMoney(view.lastKnownEstimate, view.currency)}`}</p>
      ) : null}
    </section>
  );
}
