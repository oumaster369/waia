import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import {
  ConsolePanel,
  EvidenceTime,
} from "@/components/trader/admin-console/primitives/console-ui";
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
  observedAt?: string | null;
  reasons?: Record<string, string[]>;
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
  const facts = record as Record<
    string,
    { value?: { currency?: string }; reasons?: string[]; times?: { observedAt?: string } }
  >;
  return {
    state: "ready",
    reason: null,
    coverageLabel:
      "coverageLabel" in data && typeof data.coverageLabel === "string" ? data.coverageLabel : null,
    currency: Object.values(facts).find((fact) => fact.value?.currency)?.value?.currency ?? "USDT",
    observedAt: facts.equity?.times?.observedAt ?? null,
    reasons: Object.fromEntries(
      Object.entries(facts).map(([key, fact]) => [key, fact.reasons ?? []]),
    ),
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

function figure(
  label: string,
  amount: string | null,
  currency: string,
  reason?: string,
  subtitle?: string,
) {
  return (
    <div className="border-waia-divider bg-waia-field-mid min-w-0 rounded-xl border p-5">
      <p className="text-waia-fg-muted text-xs">{label}</p>
      <p
        data-testid={`overview-${label}`}
        className="mt-4 text-xl font-semibold tracking-tight break-words tabular-nums"
      >
        {amount === null ? (
          "—"
        ) : (
          <>
            {formatAdminMoney(amount, "").trim()}
            <span className="text-waia-fg-muted mt-1 block text-xs font-normal tracking-normal">
              {currency}
            </span>
          </>
        )}
      </p>
      {amount === null ? (
        <div className="mt-3">
          <DataState state="unavailable" reason={reason ?? "PNL_PERIOD_EVIDENCE_MISSING"} />
        </div>
      ) : null}
      {subtitle ? (
        <p className="text-waia-fg-muted mt-3 text-[10px] leading-5">{subtitle}</p>
      ) : null}
    </div>
  );
}
export function OverviewPanel({ view }: { view: OverviewView }) {
  if (view.state === "unavailable") return <DataState state="unavailable" reason={view.reason} />;
  return (
    <section aria-label={RU.sections.overview} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {figure("Общий капитал", view.equity, view.currency, view.reasons?.equity?.[0])}
        {figure("Свободно", view.free, view.currency, view.reasons?.free?.[0])}
        {figure("В позициях", view.holdings, view.currency, view.reasons?.holdings?.[0])}
        {figure("Резерв в ордерах", view.reserved, view.currency, view.reasons?.reserved?.[0])}
        {figure(
          "Результат Трейдера",
          view.pnl,
          view.currency,
          view.reasons?.pnl?.[0],
          "До комиссии сервиса 30%",
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
        <p className="text-waia-fg-muted">{view.coverageLabel}</p>
        <EvidenceTime at={view.observedAt} />
      </div>
      {view.lastKnownEstimate !== null ? (
        <p
          data-testid="overview-last-known"
          className="border-waia-warning/25 bg-waia-warning/5 text-waia-warning rounded-lg border px-4 py-3 text-xs leading-6"
        >
          Последняя известная оценка устаревших счетов:{" "}
          {formatAdminMoney(view.lastKnownEstimate, view.currency)}. В актуальную сумму не включена.
        </p>
      ) : null}
      {view.excluded.length > 0 ? (
        <ConsolePanel
          title="Ограничения охвата"
          note="Причина исключения каждого счёта из текущей оценки"
        >
          <ul className="divide-waia-divider divide-y">
            {view.excluded.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 px-5 py-3">
                <span className="text-sm">{row.id}</span>
                <DataState state="unavailable" reason={row.reason} />
              </li>
            ))}
          </ul>
        </ConsolePanel>
      ) : null}
    </section>
  );
}
