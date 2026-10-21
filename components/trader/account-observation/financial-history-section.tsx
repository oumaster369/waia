"use client";

import { useState } from "react";

import type { ObservationBinding } from "@/lib/trader/account-observation/types";
import type {
  FinancialHistoryRequest,
  FinancialHistoryRecord,
} from "@/lib/trader/account-observation/financial-history";
import {
  htxV5BillGroups,
  type HtxV5BillCategory,
} from "@/lib/trader/account-observation/derivatives/htx-v5-bill-groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { financialHistoryPeriodFromDates } from "./financial-history-period";
import { useFinancialHistory, HISTORY_MAX_ROWS } from "./use-financial-history";

function utc(value: number) {
  return value <= 8.64e15
    ? new Date(value).toISOString().replace("T", " ").replace("Z", " UTC")
    : "Unavailable";
}
const currentCopy = {
  NOT_CONFIGURED:
    "Collection is currently not configured. Previously persisted records remain available.",
  PARTIAL: "Current collection is partial; completeness is unknown.",
  ERROR:
    "The latest collection reported an error. Persisted records below are historical evidence.",
  UNAVAILABLE:
    "Current collection is unavailable. Persisted records below are historical evidence.",
};

function LoadedRecordTotals({
  records,
  capped,
  hasMore,
}: {
  records: readonly FinancialHistoryRecord[];
  capped: boolean;
  hasMore: boolean;
}) {
  let groups: ReturnType<typeof htxV5BillGroups> | null = null;
  try {
    // The history schema verifies the category/type pair; its inferred category is a string.
    groups = htxV5BillGroups(
      records.map(({ bill }) => ({
        ...bill,
        category: bill.category as HtxV5BillCategory,
      })),
    );
  } catch {
    // Raw evidence remains available when an amount cannot be summed exactly.
  }
  return (
    <section aria-label="Loaded record totals" className="space-y-2">
      <h3 className="text-sm font-medium">Loaded records by currency and type</h3>
      <p className="text-waia-fg-muted text-xs">
        Loaded records: {records.length}. These sums cover only the records loaded below, not the
        full account or period. Currencies are kept separate; completeness is unknown.
        {capped
          ? " The display limit has been reached."
          : hasMore
            ? " Load more to include further saved records."
            : ""}
      </p>
      {records.length === 0 ? (
        <p className="text-sm">
          Totals unavailable: no records loaded. This is not an observed zero.
        </p>
      ) : groups === null ? (
        <p className="text-sm">
          Exact totals are unavailable. The original amounts remain listed below.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Loaded amounts by currency and record type</caption>
            <thead className="text-waia-fg-muted text-xs">
              <tr>
                <th scope="col" className="py-2 pr-3">
                  Currency
                </th>
                <th scope="col" className="py-2 pr-3">
                  Type / category
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  Records
                </th>
                <th scope="col" className="py-2 text-right">
                  Loaded amount
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={`${group.currency}:${group.type}`} className="border-border border-t">
                  <td className="py-2 pr-3 font-mono">{group.currency}</td>
                  <td className="py-2 pr-3">
                    {group.type} · {group.category.toLowerCase().replaceAll("_", " ")}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{group.recordCount}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {group.observedAmountSum}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type HistoryProps = {
  binding: ObservationBinding;
  uid: string;
  endpoint: "/api/trader/account-observation" | "/api/trader/admin/account-observation";
  fetcher: typeof fetch;
  onRevoked: () => void;
};

/** Keyed by the parent so another identity cannot render this component's previous state. */
export function FinancialHistorySection(props: HistoryProps) {
  const [startDate, setStartDate] = useState("");
  const [throughDate, setThroughDate] = useState("");
  const [filters, setFilters] = useState<FinancialHistoryRequest["filters"]>({
    windowStartMs: null,
    windowEndMs: null,
  });
  const [error, setError] = useState<string | null>(null);
  const controls = (
    <form
      aria-label="Financial history period"
      noValidate
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!event.currentTarget.checkValidity()) {
          setError("Complete or clear invalid UTC dates before applying the period.");
          event.currentTarget.reportValidity();
          return;
        }
        try {
          setFilters(financialHistoryPeriodFromDates(startDate, throughDate));
          setError(null);
        } catch {
          setError("Enter valid UTC dates with the start on or before the through date.");
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span>Start date (UTC)</span>
          <Input
            type="date"
            min="1970-01-01"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>Through date (UTC)</span>
          <Input
            type="date"
            min="1970-01-01"
            value={throughDate}
            onChange={(event) => setThroughDate(event.target.value)}
          />
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply period
        </Button>
      </div>
      <p className="text-waia-fg-muted text-xs">
        Both dates are included. Leave a date blank for no bound on that side.
      </p>
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
  return (
    <section
      aria-label="Persisted financial history"
      className="border-border space-y-4 rounded-lg border p-4"
    >
      <header>
        <h2 className="font-medium">Persisted financial history</h2>
        <p className="text-waia-fg-muted text-xs">Received records only · completeness unknown</p>
      </header>
      {controls}
      <FinancialHistoryView
        key={`${filters.windowStartMs}:${filters.windowEndMs}`}
        {...props}
        filters={filters}
      />
    </section>
  );
}

/** A period change remounts this view before another period can display old rows. */
function FinancialHistoryView(
  props: HistoryProps & {
    filters: FinancialHistoryRequest["filters"];
  },
) {
  const history = useFinancialHistory(props);
  const busy = history.status === "LOADING" || history.loadingMore;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={history.refresh}
          disabled={busy || history.status === "REVOKED"}
        >
          Refresh history
        </Button>
      </div>
      <p className="text-sm">
        Requested period (UTC):{" "}
        {props.filters.windowStartMs === null ? "No start bound" : utc(props.filters.windowStartMs)}
        {" to "}
        {props.filters.windowEndMs === null ? "No end bound" : utc(props.filters.windowEndMs)}
        {" · start included, end excluded."}
      </p>
      <p className="text-waia-fg-muted text-sm">
        Saved records from bounded collection windows, separate from the latest snapshot above.
        Amounts retain their reported sign and currency. No currency conversion or profit
        calculation is performed.
      </p>
      <section aria-label="Profit calculation availability" className="space-y-2 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt>Net P&amp;L</dt>
            <dd>Unavailable</dd>
          </div>
          <div>
            <dt>Daily P&amp;L</dt>
            <dd>Unavailable</dd>
          </div>
        </dl>
        <p className="text-waia-fg-muted text-xs">
          Complete accounting for these results is not available. Received bill amounts and
          venue-reported unrealized P&amp;L do not establish net or daily profit.
        </p>
      </section>
      <div aria-live="polite" aria-atomic="true">
        {history.status === "LOADING" ? <p>Loading persisted financial history…</p> : null}
        {history.loadingMore ? <p>Loading more persisted records…</p> : null}
        {history.status === "UNAVAILABLE" ? (
          <p>
            Persisted history is unavailable. A current account identity and an available history
            reader are required. Try Refresh history.
          </p>
        ) : null}
        {history.status === "REVOKED" ? <p>Access revoked; financial history cleared.</p> : null}
      </div>
      {history.status === "ERROR" ? (
        <p role="alert">
          Financial history could not be verified. Displayed history was cleared. Try Refresh
          history.
        </p>
      ) : null}
      {history.data ? (
        <>
          <p className="text-sm">{currentCopy[history.data.currentFinancialStatus]}</p>
          <p className="text-waia-fg-muted text-xs">
            History retrieved: {history.receivedAt === null ? "Loading" : utc(history.receivedAt)}.
            Collection dates below describe the original evidence; retrieval does not make it newly
            collected.
          </p>
          <LoadedRecordTotals
            records={history.data.records}
            capped={history.capped}
            hasMore={!!history.data.nextCursor}
          />
          {history.data.records.length === 0 ? (
            <p>
              No persisted records were returned in this snapshot. This does not mean zero fees,
              payments or profit.
            </p>
          ) : (
            <ul aria-label="Persisted financial records" className="space-y-3">
              {history.data.records.map(({ bill, provenance: p }) => (
                <li key={bill.id} className="border-border space-y-2 border-t pt-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <time
                      dateTime={
                        bill.createdTimeMs <= 8.64e15
                          ? new Date(bill.createdTimeMs).toISOString()
                          : undefined
                      }
                      className="text-xs tabular-nums"
                    >
                      {utc(bill.createdTimeMs)}
                    </time>
                    <span className="font-mono text-sm [overflow-wrap:anywhere]">
                      {bill.amount} {bill.currency}
                    </span>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-waia-fg-muted text-xs">Provider category / type</dt>
                      <dd className="break-words">
                        {bill.category.toLowerCase().replaceAll("_", " ")} · {bill.type}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-waia-fg-muted text-xs">Contract</dt>
                      <dd className="break-all">{bill.contractCode || "Not specified"}</dd>
                    </div>
                    <div>
                      <dt className="text-waia-fg-muted text-xs">Provider record</dt>
                      <dd className="font-mono break-all">{bill.id}</dd>
                    </div>
                    <div>
                      <dt className="text-waia-fg-muted text-xs">Collected (UTC)</dt>
                      <dd className="text-xs tabular-nums">{utc(p.collectionCompletedAtMs)}</dd>
                    </div>
                  </dl>
                  <details className="text-xs">
                    <summary className="cursor-pointer">Collection provenance</summary>
                    <p className="mt-2 break-words">
                      Window: [{utc(p.windowStartMs)}, {utc(p.windowEndMs)}) — start included, end
                      excluded.
                    </p>
                    <p className="break-all">
                      Credential revision: {p.binding.credentialRevision}; configuration revision:{" "}
                      {p.binding.configurationRevision}.
                    </p>
                    <p className="break-all">Source observation: {p.observationId}</p>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Received collection coverage</h3>
            <p className="text-waia-fg-muted text-xs">
              Each window is a bounded collection attempt. Overlapping windows and an empty page do
              not establish complete history.
            </p>
            {history.data.coverage.length === 0 ? (
              <p className="text-sm">No coverage evidence was returned in this snapshot.</p>
            ) : (
              <ul aria-label="Collection coverage" className="space-y-2 text-xs">
                {history.data.coverage.map((row) => (
                  <li
                    key={row.provenance.observationId}
                    className="border-border space-y-1 border-t pt-2"
                  >
                    <p>
                      {row.status === "PARTIAL"
                        ? "Partial collection"
                        : row.status === "ERROR"
                          ? "Collection error"
                          : "Collection unavailable"}{" "}
                      · completeness unknown
                    </p>
                    <p className="break-words">
                      Window: [{utc(row.provenance.windowStartMs)},{" "}
                      {utc(row.provenance.windowEndMs)})
                    </p>
                    <p>
                      Collected: {utc(row.provenance.collectionCompletedAtMs)} · received:{" "}
                      {row.observedRowCount === null
                        ? "Unavailable"
                        : `${row.observedRowCount} records in one page`}
                    </p>
                    {row.error ? (
                      <p>Reported reason: {row.error.toLowerCase().replaceAll("_", " ")}</p>
                    ) : null}
                    {row.unavailableReason ? (
                      <p>
                        Reported reason: {row.unavailableReason.toLowerCase().replaceAll("_", " ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {history.capped && history.data.nextCursor ? (
            <p className="text-sm">
              Display limit reached (up to {HISTORY_MAX_ROWS} records and coverage entries). Refresh
              starts a new snapshot.
            </p>
          ) : null}
          {!history.data.nextCursor ? (
            <p className="text-waia-fg-muted text-xs">
              End of this persisted snapshot. Completeness of exchange history remains unknown.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={history.loadMore}
            disabled={busy || !history.data.nextCursor || history.capped}
          >
            Load more history
          </Button>
        </>
      ) : null}
    </div>
  );
}
