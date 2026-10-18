import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import { ConsolePanel } from "@/components/trader/admin-console/primitives/console-ui";
import type {
  OverviewFuturesExclusion,
  summarizeOverviewFutures,
} from "@/lib/trader/account-observation/overview-futures-summary";

type Summary = ReturnType<typeof summarizeOverviewFutures>;

const EXCLUSION_COPY: Record<OverviewFuturesExclusion, string> = {
  DIRECTORY_STALE: "Could not refresh account list",
  IDENTITY_UNAVAILABLE: "Could not verify account ownership",
  DUPLICATE_IDENTITY: "Account matches another record",
  OBSERVATION_UNAVAILABLE: "Current account data unavailable",
  FUTURES_UNAVAILABLE: "Futures balance unavailable",
  TIME_INVALID: "Last read time unknown",
  STALE: "Data is stale",
  AMOUNT_UNSUPPORTED: "Could not read the amount precisely",
};

function card(label: string, amount: string | null, summary: Summary) {
  const partial = summary.state === "partial";
  return (
    <div className="border-waia-divider bg-waia-field-mid min-w-0 rounded-xl border p-5">
      <p className="text-waia-fg-muted text-xs">{label}</p>
      <p className="mt-4 text-xl font-semibold tracking-tight break-words tabular-nums">
        {amount === null ? "—" : formatAdminMoney(amount, "").trim()}
        {amount !== null ? (
          <span className="text-waia-fg-muted mt-1 block text-xs font-normal tracking-normal">
            USD
          </span>
        ) : null}
      </p>
      {partial && amount !== null ? (
        <p className="text-waia-warning mt-3 text-xs">Known portion</p>
      ) : null}
    </div>
  );
}

export function OverviewFuturesSummaryView({
  summary,
  unavailableReason,
}: {
  summary: Summary | null;
  unavailableReason?: string;
}) {
  const values = summary ?? {
    state: "unavailable" as const,
    currency: "USD" as const,
    equityUsd: null,
    availableMarginUsd: null,
    profitUnrealUsd: null,
    included: 0,
    total: 0,
    oldestReadCompletedAtMs: null,
    excluded: [],
  };
  const description =
    unavailableReason ??
    (values.state === "partial"
      ? "The known portion from fresh snapshots is shown; this is not the selected period result."
      : values.state === "complete"
        ? "Current snapshot for connected HTX accounts; unrealized results do not refer to the selected period."
        : values.state === "empty"
          ? "No connected HTX accounts in this scope yet."
          : "No complete current account snapshot in the selected scope.");
  const observedAt =
    values.oldestReadCompletedAtMs === null
      ? null
      : new Date(values.oldestReadCompletedAtMs).toLocaleString("en-GB");

  return (
    <ConsolePanel title="Futures" note="Current HTX observations · USD">
      <div className="space-y-4 p-4">
        <p className="text-waia-fg-muted text-sm">{description}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {card("Futures equity", values.equityUsd, values)}
          {card("Available futures margin", values.availableMarginUsd, values)}
          {card("Unrealized futures result", values.profitUnrealUsd, values)}
        </div>
        {summary ? (
          <div className="text-waia-fg-muted flex flex-wrap justify-between gap-2 px-1 text-xs">
            <p>
              Snapshots included: {values.included} of {values.total}
            </p>
            {observedAt ? <p>Earliest read: {observedAt}</p> : null}
          </div>
        ) : null}
        {values.excluded.length > 0 ? (
          <ul className="text-waia-fg-muted space-y-1 text-xs" aria-label="Excluded accounts">
            {values.excluded.map((item) => (
              <li key={`${item.exchangeAccountId}:${item.reason}`}>
                Account {item.exchangeAccountId}: {EXCLUSION_COPY[item.reason]}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ConsolePanel>
  );
}
