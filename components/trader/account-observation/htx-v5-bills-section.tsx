import type { HtxV5BillsObservation } from "@/lib/trader/account-observation/types";
import type { HtxV5BillCategory } from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";

const CATEGORY_COPY: Readonly<Record<HtxV5BillCategory, string>> = {
  CLOSE_LONG: "long position close",
  CLOSE_SHORT: "short position close",
  OPEN_FEE_TAKER: "opening fee (taker)",
  OPEN_FEE_MAKER: "opening fee (maker)",
  CLOSE_FEE_TAKER: "closing fee (taker)",
  CLOSE_FEE_MAKER: "closing fee (maker)",
  DELIVERY_CLOSE_LONG: "long position settlement",
  DELIVERY_CLOSE_SHORT: "short position settlement",
  DELIVERY_FEE: "settlement fee",
  LIQUIDATION_CLOSE_LONG: "liquidation close (long)",
  LIQUIDATION_CLOSE_SHORT: "liquidation close (short)",
  SPOT_TO_CONTRACT_TRANSFER: "Spot to contract account transfer",
  CONTRACT_TO_SPOT_TRANSFER: "contract account to Spot transfer",
  UNREALIZED_SETTLEMENT_LONG: "PnL settlement (long)",
  UNREALIZED_SETTLEMENT_SHORT: "PnL settlement (short)",
  CLAWBACK: "exchange adjustment",
  SYSTEM: "system record",
  ACTIVITY_REWARD: "activity reward",
  REBATE: "fee rebate",
  FUNDING_INCOME: "funding income",
  FUNDING_EXPENDITURE: "funding expense",
  TRANSFER_TO_SUB: "transfer to subaccount",
  TRANSFER_FROM_SUB: "transfer from subaccount",
  TRANSFER_TO_MASTER: "transfer to main account",
  TRANSFER_FROM_MASTER: "transfer from main account",
  TRANSFER_FROM_MARGIN_ACCOUNT: "transfer from margin account",
  TRANSFER_TO_MARGIN_ACCOUNT: "transfer to margin account",
  SYSTEM_ADVANCE_TRANSFER_OUT: "system transfer out",
  SYSTEM_ADVANCE_TRANSFER_IN: "system transfer in",
  ADL_CLOSE_LONG: "automatic position deleveraging (long)",
  ADL_CLOSE_SHORT: "automatic position deleveraging (short)",
  LIQUIDATION_FEE: "liquidation fee",
  UNKNOWN: "unknown category",
};

const ERROR_COPY: Readonly<Record<string, string>> = {
  TIMEOUT: "The financial records read timed out.",
  RATE_LIMITED: "The exchange temporarily rate-limited financial records.",
  PERMISSION_DENIED: "The key has no verified permission for this read.",
  READ_FAILED: "Financial records could not be read.",
  INVALID_RESPONSE: "The financial records response failed validation.",
  IDENTITY_MISMATCH: "The account binding for this read could not be verified.",
};

function utcTime(value: number): string {
  return Number.isFinite(value) && Math.abs(value) <= 8.64e15
    ? `${new Date(value).toISOString().replace("T", " ").replace("Z", " UTC")}`
    : "Unavailable";
}

function stale(observation: HtxV5BillsObservation, inheritedStale: boolean, nowMs: number) {
  const completedAt = observation.readCompletedAtMs;
  return (
    inheritedStale ||
    (completedAt !== null &&
      completedAt <= nowMs &&
      nowMs - completedAt >= ACCOUNT_OBSERVATION_STALE_AFTER_MS)
  );
}

export function HtxV5BillsSection({
  observation,
  inheritedStale,
  nowMs,
}: {
  observation: HtxV5BillsObservation | null;
  inheritedStale: boolean;
  nowMs: number;
}) {
  return (
    <section aria-label="HTX financial records" className="border-border space-y-3 rounded-lg border p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">HTX financial records</h3>
        <span className="text-muted-foreground text-xs">
          {observation === null
            ? "not configured"
            : observation.status === "UNAVAILABLE"
              ? "unavailable"
              : observation.status === "ERROR"
                ? "error"
                : "partial data · completeness unknown"}
        </span>
      </header>
      {observation === null ? (
        <p className="text-sm">Financial records reading is not configured.</p>
      ) : (
        <>
          {observation.status === "UNAVAILABLE" ? (
            <p role="status" className="text-sm">
              {observation.unavailableReason === "SCOPE_EXPIRED"
                ? "The authorized financial records read window has expired. Balance updates continue."
                : "The authorized financial records read window has not started yet. Balance updates continue."}
            </p>
          ) : null}
          {observation.status === "ERROR" ? (
            <p role="alert" className="text-sm">
              {observation.error ? ERROR_COPY[observation.error] : "Financial records unavailable."}
            </p>
          ) : null}
          {observation.status === "PARTIAL" ? (
            <>
              {stale(observation, inheritedStale, nowMs) ? (
                <p role="status" className="text-sm">
                  Last received data shown; it is stale and its freshness is not confirmed.
                </p>
              ) : null}
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-xs">Requested window (UTC)</dt>
                  <dd className="font-mono text-xs tabular-nums">
                    [{utcTime(observation.windowStartMs)}, {utcTime(observation.windowEndMs)})
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Response received (UTC)</dt>
                  <dd className="font-mono text-xs tabular-nums">
                    {observation.responseReceivedAtMs === null
                      ? "Unavailable"
                      : utcTime(observation.responseReceivedAtMs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">History coverage</dt>
                  <dd>Partial; completeness unknown</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Received records / pages</dt>
                  <dd>
                    {observation.values === null ? "Unavailable" : observation.values.length} / {observation.pageScope === null ? "Unavailable" : observation.pageScope.pagesRead}
                  </dd>
                </div>
              </dl>
              <p className="text-muted-foreground text-xs">
                Only records received in one bounded request are shown. This is not complete history,
                a daily result or a calculation of fees, funding or profit. Amounts retain the
                sign reported by HTX without conversion. These records do not confirm complete history
                or account binding.
              </p>
              {observation.groups !== null && observation.groups.length > 0 ? (
                <div className="min-w-0">
                  <table className="block w-full border-collapse text-left text-sm md:table">
                    <caption className="sr-only">Received amounts by currency and record type</caption>
                    <thead className="hidden md:table-header-group">
                      <tr className="border-border border-b text-muted-foreground text-xs">
                        <th scope="col" className="py-2 pr-3 font-medium">Currency</th>
                        <th scope="col" className="py-2 pr-3 font-medium">Type / category</th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">Records</th>
                        <th scope="col" className="py-2 text-right font-medium">Received amount</th>
                      </tr>
                    </thead>
                    <tbody className="block md:table-row-group">
                      {observation.groups.map((group, index) => (
                        <tr key={`${group.currency}-${group.type}-${index}`} className="border-border grid gap-2 border-b py-3 last:border-0 md:table-row md:py-0">
                          <td className="min-w-0 break-all font-mono md:py-2 md:pr-3">{group.currency}</td>
                          <td className="min-w-0 break-words md:py-2 md:pr-3">
                            <span className="font-mono">{group.type}</span>
                            <span className="text-muted-foreground"> · {CATEGORY_COPY[group.category] ?? "unknown category"}</span>
                          </td>
                          <td className="tabular-nums md:py-2 md:pr-3 md:text-right"><span className="text-muted-foreground md:hidden">Records: </span>{group.recordCount}</td>
                          <td className="min-w-0 [overflow-wrap:anywhere] font-mono tabular-nums md:py-2 md:text-right">
                            {group.observedAmountSum} {group.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : observation.values?.length === 0 && observation.groups?.length === 0 ? (
                <p className="text-sm">
                  No records were received in this bounded request. This does not mean zero fees,
                  payments or profit.
                </p>
              ) : (
                <p className="text-sm">Received records summary unavailable.</p>
              )}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
