import type { ReactNode } from "react";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";
import type {
  HtxV5AccountObservation,
  HtxV5AlgoOrdersObservation,
  HtxV5FillsObservation,
  HtxV5RowsObservation,
  HtxV5ValueObservation,
  ObservationReadError,
} from "@/lib/trader/account-observation/types";
import type {
  HtxV5AlgoOrder,
  HtxV5BalanceDetail,
  HtxV5Fill,
  HtxV5OpenOrder,
  HtxV5Position,
} from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";

const MAX_VISIBLE_ROWS = 100;

function hasPositiveContractVolume(volume: string): boolean {
  const significand = volume.split(/[eE]/, 1)[0] ?? "";
  return /[1-9]/.test(significand);
}

const ERROR_COPY: Record<ObservationReadError, string> = {
  TIMEOUT: "The account read timed out.",
  RATE_LIMITED: "The exchange temporarily limited account reads.",
  PERMISSION_DENIED: "This account data is not available for display.",
  READ_FAILED: "The account could not be read.",
  INVALID_RESPONSE: "The exchange response could not be verified.",
  IDENTITY_MISMATCH: "The returned account identity could not be verified.",
};

const time = (value: number | null) =>
  value !== null && Number.isFinite(value) && Math.abs(value) <= 8.64e15
    ? new Date(value).toISOString()
    : "Unavailable";

function Value({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value ?? "Unavailable"}</dd>
    </div>
  );
}

function isStale(
  status: string,
  completedAt: number | null,
  inheritedStale: boolean,
  nowMs: number,
) {
  return (
    status !== "NOT_CONFIGURED" &&
    (inheritedStale ||
      (completedAt !== null &&
        completedAt <= nowMs &&
        nowMs - completedAt >= ACCOUNT_OBSERVATION_STALE_AFTER_MS))
  );
}

function statusLabel(status: string, stale: boolean) {
  if (status === "NOT_CONFIGURED") return "NOT CONFIGURED";
  if (status === "ERROR") return "ERROR";
  if (stale) return status === "PARTIAL" ? "STALE · PARTIAL" : "STALE";
  if (status === "PARTIAL") return "PARTIAL";
  return "CURRENT";
}

function Header({
  title,
  status,
  completedAt,
}: {
  title: string;
  status: string;
  completedAt?: number | null;
}) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="font-medium">{title}</h3>
      <span className="text-waia-fg-muted text-xs">{status}</span>
      {completedAt !== undefined ? (
        <span className="text-muted-foreground text-xs">Last read {time(completedAt)}</span>
      ) : null}
    </header>
  );
}

function ReadError({ error }: { error: ObservationReadError | null }) {
  return error ? (
    <p role="alert" className="text-sm">
      {ERROR_COPY[error]}
    </p>
  ) : null;
}

function Coverage({ pageScope }: { pageScope: { completeness: "UNKNOWN" } | null }) {
  return pageScope ? (
    <p className="text-muted-foreground text-xs">Some results may be missing from this read.</p>
  ) : null;
}

function BalanceDetail({ row }: { row: HtxV5BalanceDetail }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">{row.currency} collateral</h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Equity (currency units)" value={row.equity} />
        <Value label="Available (currency units)" value={row.available} />
        <Value label="Withdrawable (currency units)" value={row.withdrawAvailable} />
        <Value label="Unrealized result (currency units)" value={row.profitUnreal} />
        <Value label="Initial margin (currency units)" value={row.initialMargin} />
        <Value label="Maintenance margin (currency units)" value={row.maintenanceMargin} />
      </dl>
    </WaiaSurface>
  );
}

function Balance({
  observation,
  inheritedStale,
  nowMs,
}: {
  observation: HtxV5ValueObservation<NonNullable<HtxV5AccountObservation["balance"]["value"]>>;
  inheritedStale: boolean;
  nowMs: number;
}) {
  const stale = isStale(observation.status, observation.readCompletedAtMs, inheritedStale, nowMs);
  return (
    <section
      aria-label="HTX futures balance"
      className="border-border space-y-3 rounded-lg border p-3"
    >
      <Header
        title="HTX futures balance"
        status={statusLabel(observation.status, stale)}
        completedAt={observation.readCompletedAtMs}
      />
      {stale ? (
        <p className="text-sm">Showing the last received balance read; it may be out of date.</p>
      ) : null}
      <ReadError error={observation.error} />
      {observation.status === "COMPLETE" && observation.value ? (
        <>
          <p className="text-muted-foreground text-xs">
            Account aggregates are reported by HTX in USD. Currency collateral below is separate and
            is not added to these totals.
          </p>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Value label="Total equity (USD)" value={observation.value.account.equityUsd} />
            <Value
              label="Available margin (USD)"
              value={observation.value.account.availableMarginUsd}
            />
            <Value
              label="Unrealized result (USD)"
              value={observation.value.account.profitUnrealUsd}
            />
            <Value
              label="Initial margin (USD)"
              value={observation.value.account.initialMarginUsd}
            />
            <Value
              label="Maintenance margin (USD)"
              value={observation.value.account.maintenanceMarginUsd}
            />
            <Value
              label="Maintenance margin rate"
              value={observation.value.account.maintenanceMarginRate}
            />
          </dl>
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Currency collateral details</h4>
            {observation.value.details.length ? (
              observation.value.details.map((row, index) => (
                <BalanceDetail key={row.currency + "-" + index} row={row} />
              ))
            ) : (
              <p>No currency collateral rows were returned.</p>
            )}
          </div>
        </>
      ) : (
        <p>Balance values unavailable — not an observed zero.</p>
      )}
    </section>
  );
}

function Position({ row }: { row: HtxV5Position }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        {row.contractCode} · {row.positionSide} · {row.marginMode}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Position volume (contracts)" value={row.volume} />
        <Value label="Available volume (contracts)" value={row.available} />
        <Value label="Open average price" value={row.openAveragePrice} />
        <Value label="Mark price" value={row.markPrice} />
        <Value label="Last price" value={row.lastPrice} />
        <Value label="Liquidation price" value={row.liquidationPrice} />
        <Value label="Unrealized result (HTX reported)" value={row.profitUnreal} />
        <Value label="Margin currency" value={row.marginCurrency} />
      </dl>
    </WaiaSurface>
  );
}

function Rows<T>({
  title,
  observation,
  inheritedStale,
  nowMs,
  empty,
  children,
}: {
  title: string;
  observation: HtxV5RowsObservation<T>;
  inheritedStale: boolean;
  nowMs: number;
  empty: string;
  children: (row: T, index: number) => ReactNode;
}) {
  const stale = isStale(observation.status, observation.readCompletedAtMs, inheritedStale, nowMs);
  const visibleValues = observation.values?.slice(0, MAX_VISIBLE_ROWS) ?? null;
  return (
    <section aria-label={title} className="border-border space-y-3 rounded-lg border p-3">
      <Header
        title={title}
        status={statusLabel(observation.status, stale)}
        completedAt={observation.readCompletedAtMs}
      />
      {stale ? (
        <p className="text-sm">Showing the last received read; it may be out of date.</p>
      ) : null}
      <ReadError error={observation.error} />
      {visibleValues === null ? (
        <p>Unavailable — not an observed empty result.</p>
      ) : visibleValues.length === 0 ? (
        <p>{observation.status === "COMPLETE" ? empty : "No rows were returned in this read."}</p>
      ) : (
        <div className="space-y-2">
          {visibleValues.map(children)}
          {observation.values && observation.values.length > MAX_VISIBLE_ROWS ? (
            <p>
              Showing the first {MAX_VISIBLE_ROWS} of {observation.values.length} received rows.
            </p>
          ) : null}
        </div>
      )}
      <Coverage pageScope={observation.pageScope} />
    </section>
  );
}

function OpenOrder({ row }: { row: HtxV5OpenOrder }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        {row.contractCode} · {row.side} · {row.state}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Order volume (contracts)" value={row.volume} />
        <Value label="Position side" value={row.positionSide} />
        <Value label="Take-profit trigger received" value={row.tpTriggerPrice} />
        <Value label="Stop-loss trigger received" value={row.slTriggerPrice} />
      </dl>
    </WaiaSurface>
  );
}

const ALGO_TYPE: Record<HtxV5AlgoOrder["type"], string> = {
  tp: "Take-profit order",
  sl: "Stop-loss order",
  tpsl: "Combined take-profit/stop-loss order",
  trigger: "Generic trigger order",
  trailing_stop: "Trailing-stop order",
};

function AlgoOrder({ row }: { row: HtxV5AlgoOrder }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        {row.contractCode} · {ALGO_TYPE[row.type]}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Order volume (contracts)" value={row.volume} />
        <Value label="Position side" value={row.positionSide} />
        <Value label="Take-profit trigger received" value={row.tpTriggerPrice} />
        <Value label="Stop-loss trigger received" value={row.slTriggerPrice} />
        <Value
          label="Reduce only"
          value={row.reduceOnly === null ? null : row.reduceOnly ? "Yes" : "No"}
        />
      </dl>
    </WaiaSurface>
  );
}

function AlgoOrders({
  observation,
  inheritedStale,
  nowMs,
  hasOpenPositions,
}: {
  observation: HtxV5AlgoOrdersObservation;
  inheritedStale: boolean;
  nowMs: number;
  hasOpenPositions: boolean;
}) {
  const stale = isStale(observation.status, observation.readCompletedAtMs, inheritedStale, nowMs);
  const visibleValues = observation.values?.slice(0, MAX_VISIBLE_ROWS) ?? null;
  return (
    <section
      aria-label="HTX conditional orders"
      className="border-border space-y-3 rounded-lg border p-3"
    >
      <Header
        title="HTX conditional orders"
        status={statusLabel(observation.status, stale)}
        completedAt={observation.readCompletedAtMs}
      />
      {stale ? (
        <p className="text-sm">
          Showing the last received conditional-order read; it may be out of date.
        </p>
      ) : null}
      <ReadError error={observation.error} />
      {visibleValues === null ? (
        <p>Conditional-order data unavailable — exchange protection is unconfirmed.</p>
      ) : visibleValues.length === 0 ? (
        <p>No conditional-order rows were returned; exchange protection is unconfirmed.</p>
      ) : (
        <div className="space-y-2">
          {visibleValues.map((row, index) => (
            <AlgoOrder key={row.algoId + "-" + index} row={row} />
          ))}
          {observation.values && observation.values.length > MAX_VISIBLE_ROWS ? (
            <p>
              Showing the first {MAX_VISIBLE_ROWS} of {observation.values.length} received rows.
            </p>
          ) : null}
        </div>
      )}
      <Coverage pageScope={observation.pageScope} />
      {hasOpenPositions ? (
        <p role="alert" className="text-sm">
          Open-position protection has not been confirmed from this snapshot.
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Conditional orders are listed separately from positions; protection coverage is not
          assessed.
        </p>
      )}
    </section>
  );
}

function Fill({ row }: { row: HtxV5Fill }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        Executed fill · {row.contractCode} · {row.side}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Fill volume (contracts)" value={row.tradeVolume} />
        <Value label="Fill price" value={row.tradePrice} />
        <Value label="Turnover (HTX reported)" value={row.tradeTurnover} />
        <Value label="Fee" value={row.tradeFee} />
        <Value label="Fee currency" value={row.feeCurrency} />
        <Value label="Profit (HTX reported)" value={row.profit} />
      </dl>
      <p className="text-muted-foreground text-xs">HTX fill time {time(row.createdTimeMs)}</p>
    </WaiaSurface>
  );
}

function Fills({
  observation,
  inheritedStale,
  nowMs,
}: {
  observation: HtxV5FillsObservation;
  inheritedStale: boolean;
  nowMs: number;
}) {
  const stale = isStale(observation.status, observation.readCompletedAtMs, inheritedStale, nowMs);
  const visibleValues = observation.values?.slice(0, MAX_VISIBLE_ROWS) ?? null;
  return (
    <section
      aria-label="HTX futures fills"
      className="border-border space-y-3 rounded-lg border p-3"
    >
      <Header
        title="HTX futures fills"
        status={statusLabel(observation.status, stale)}
        completedAt={
          observation.status === "NOT_CONFIGURED" ? undefined : observation.readCompletedAtMs
        }
      />
      {stale ? (
        <p className="text-sm">Showing the last received fill read; it may be out of date.</p>
      ) : null}
      {observation.status === "NOT_CONFIGURED" || observation.coverage === "NOT_CONFIGURED" ? (
        <p>Fill history is unavailable; no fill count is implied.</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Contracts covered: {observation.contracts.join(", ") || "Unavailable"}
          </p>
          <p className="text-muted-foreground text-sm">
            History period: {time(observation.windowStartMs)} – {time(observation.windowEndMs)}
          </p>
          <ReadError error={observation.error} />
          {visibleValues === null ? (
            <p>Fill rows unavailable — not an observed zero.</p>
          ) : visibleValues.length === 0 ? (
            <p>
              {observation.status === "COMPLETE"
                ? "No fills returned for the contracts and history period shown."
                : "No fill rows were returned in this read."}
            </p>
          ) : (
            <div className="space-y-2">
              {visibleValues.map((row, index) => (
                <Fill key={row.id + "-" + index} row={row} />
              ))}
              {observation.values && observation.values.length > MAX_VISIBLE_ROWS ? (
                <p>
                  Showing the first {MAX_VISIBLE_ROWS} of {observation.values.length} received
                  fills.
                </p>
              ) : null}
            </div>
          )}
          <Coverage
            pageScope={
              observation.pageScope ? { completeness: observation.pageScope.completeness } : null
            }
          />
          <p className="text-sm">
            This history period does not establish complete daily activity or daily PnL.
          </p>
        </>
      )}
    </section>
  );
}

export function HtxV5AccountSection({
  projection,
  stale: inheritedStale,
  nowMs,
}: {
  projection: HtxV5AccountObservation;
  stale: boolean;
  nowMs: number;
}) {
  const positionsStale = isStale(
    projection.positions.status,
    projection.positions.readCompletedAtMs,
    inheritedStale,
    nowMs,
  );
  const visiblePositions = projection.positions.values?.slice(0, MAX_VISIBLE_ROWS) ?? null;
  return (
    <section
      aria-label="HTX futures snapshot"
      className="border-border space-y-4 rounded-xl border p-4"
    >
      <div>
        <h3 className="text-base font-semibold">HTX futures snapshot</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Last received read-only HTX futures account data. Position and order volumes are
          contracts.
        </p>
      </div>
      <Balance observation={projection.balance} inheritedStale={inheritedStale} nowMs={nowMs} />
      <section aria-label="HTX positions" className="border-border space-y-3 rounded-lg border p-3">
        <Header
          title="HTX positions"
          status={statusLabel(projection.positions.status, positionsStale)}
          completedAt={projection.positions.readCompletedAtMs}
        />
        {positionsStale ? (
          <p className="text-sm">Showing the last received positions; they may be out of date.</p>
        ) : null}
        <ReadError error={projection.positions.error} />
        {visiblePositions === null ? (
          <p>Position data unavailable — not an observed zero.</p>
        ) : visiblePositions.length === 0 ? (
          <p>
            {projection.positions.status === "COMPLETE"
              ? "No open positions were returned."
              : "No position rows were returned in this read."}
          </p>
        ) : (
          <div className="space-y-2">
            {visiblePositions.map((row, index) => (
              <Position key={row.contractCode + "-" + row.positionSide + "-" + index} row={row} />
            ))}
            {projection.positions.values &&
            projection.positions.values.length > MAX_VISIBLE_ROWS ? (
              <p>
                Showing the first {MAX_VISIBLE_ROWS} of {projection.positions.values.length}{" "}
                received positions.
              </p>
            ) : null}
          </div>
        )}
      </section>
      <Rows
        title="HTX open orders"
        observation={projection.openOrders}
        inheritedStale={inheritedStale}
        nowMs={nowMs}
        empty="No open orders were returned."
      >
        {(row, index) => <OpenOrder key={row.orderId + "-" + index} row={row} />}
      </Rows>
      <AlgoOrders
        observation={projection.algoOrders}
        inheritedStale={inheritedStale}
        nowMs={nowMs}
        hasOpenPositions={Boolean(
          projection.positions.values?.some((row) => hasPositiveContractVolume(row.volume)),
        )}
      />
      <Fills observation={projection.fills} inheritedStale={inheritedStale} nowMs={nowMs} />
    </section>
  );
}
