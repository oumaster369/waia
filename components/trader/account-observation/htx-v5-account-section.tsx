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
import { htxV5PositionOrderDisplay, type StopEvidenceReason } from "@/lib/trader/account-observation/htx-v5-position-order-display";
import { HtxV5BillsSection } from "./htx-v5-bills-section";

const MAX_VISIBLE_ROWS = 100;
const MAX_VISIBLE_POSITION_ORDERS = 10;

const STOP_EVIDENCE_REASON: Record<StopEvidenceReason, string> = {
  READ_FAILED: "Positions or conditional orders could not be read successfully.",
  INVALID_READ_TIME: "The positions or orders read time failed validation.",
  STALE_DATA: "The positions or orders are stale.",
  POSITION_UNBOUND: "The position is not bound to this account snapshot.",
  POSITION_AMBIGUOUS: "The snapshot contains multiple rows for the same position; matching is ambiguous.",
  SOURCE_INCOMPLETE: "The received sample is incomplete; stop orders may be missing.",
  NO_MATCHING_SL: "No matching SL order was received; this does not prove its absence. A TP target does not replace a stop.",
  DUPLICATE_ORDER_IDENTITY: "An order identity is duplicated in the received data; quantities are not compared.",
  MULTIPLE_SL_CANDIDATES: "Multiple matching stop orders were received; their quantities are not added together.",
  UNSUPPORTED_QUANTITY: "The received quantity cannot be compared exactly within the supported limits.",
  UNQUALIFIED_CLOSING_SEMANTICS: "These data do not confirm how much of the position would be closed.",
};

const QUANTITY_RELATION = { LESS: "less than the quantity of the", EQUAL: "equal to the quantity of the", GREATER: "greater than the quantity of the" } as const;


function hasPositiveContractVolume(volume: string): boolean {
  const significand = volume.split(/[eE]/, 1)[0] ?? "";
  return /[1-9]/.test(significand);
}

const ERROR_COPY: Record<ObservationReadError, string> = {
  TIMEOUT: "The account read timed out.",
  RATE_LIMITED: "The exchange temporarily rate-limited the account read.",
  PERMISSION_DENIED: "Access to this account's data is unavailable.",
  READ_FAILED: "The account could not be read.",
  INVALID_RESPONSE: "The exchange response failed validation.",
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
  if (status === "NOT_CONFIGURED") return "not configured";
  if (status === "ERROR") return "error";
  if (stale) return status === "PARTIAL" ? "stale · partial data" : "stale";
  if (status === "PARTIAL") return "partial data";
  return "current";
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
        <span className="text-muted-foreground text-xs">Read at: {time(completedAt)}</span>
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
    <p className="text-muted-foreground text-xs">Some records may be missing from this sample.</p>
  ) : null;
}

function BalanceDetail({ row }: { row: HtxV5BalanceDetail }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">Collateral in {row.currency}</h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Equity (native currency units)" value={row.equity} />
        <Value label="Available (native currency units)" value={row.available} />
        <Value label="Withdrawable (native currency units)" value={row.withdrawAvailable} />
        <Value label="Unrealized PnL (native currency units)" value={row.profitUnreal} />
        <Value label="Initial margin (native currency units)" value={row.initialMargin} />
        <Value label="Maintenance margin (native currency units)" value={row.maintenanceMargin} />
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
        title="HTX Futures account balance"
        status={statusLabel(observation.status, stale)}
        completedAt={observation.readCompletedAtMs}
      />
      {stale ? (
        <p className="text-sm">Last received balance shown; data may be stale.</p>
      ) : null}
      <ReadError error={observation.error} />
      {observation.status === "COMPLETE" && observation.value ? (
        <>
          <p className="text-muted-foreground text-xs">
            Account totals are reported by HTX in USD. Native currency collateral is shown below and is not
            added to these values.
          </p>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Value label="Account equity (USD)" value={observation.value.account.equityUsd} />
            <Value
              label="Available margin (USD)"
              value={observation.value.account.availableMarginUsd}
            />
            <Value
              label="Unrealized PnL (USD)"
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
            <h4 className="text-sm font-medium">Collateral by currency</h4>
            {observation.value.details.length ? (
              observation.value.details.map((row, index) => (
                <BalanceDetail key={row.currency + "-" + index} row={row} />
              ))
            ) : (
              <p>No currency collateral rows were received.</p>
            )}
          </div>
        </>
      ) : (
        <p>Balance unavailable — this does not mean zero.</p>
      )}
    </section>
  );
}

function Position({
  row,
  projection,
  stale,
  nowMs,
}: {
  row: HtxV5Position;
  projection: HtxV5AccountObservation;
  stale: boolean;
  nowMs: number;
}) {
  const orders = htxV5PositionOrderDisplay({
    position: row,
    projection,
    stale,
    nowMs,
  });
  return (
      <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        {row.contractCode} · {row.positionSide === "long" ? "long" : row.positionSide === "short" ? "short" : `${row.direction === "buy" ? "long" : "short"} (one-way mode)`} ·{" "}
        {row.marginMode === "cross" ? "cross margin" : "isolated margin"}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Position quantity (contracts)" value={row.volume} />
        <Value label="Available quantity (contracts)" value={row.available} />
        <Value label="Average entry price" value={row.openAveragePrice} />
        <Value label="Mark price" value={row.markPrice} />
        <Value label="Last price" value={row.lastPrice} />
        <Value label="Liquidation price" value={row.liquidationPrice} />
        <Value label="Unrealized PnL reported by HTX" value={row.profitUnreal} />
        <Value label="Margin currency" value={row.marginCurrency} />
      </dl>
      <div className="border-border space-y-1 rounded-md border p-3 text-sm">
        <h5 className="font-medium">Received stop orders and targets</h5>
        {orders.status === "UNAVAILABLE" ? (
          <p>Matching order data unavailable. Protection is not confirmed.</p>
        ) : orders.status === "STALE" ? (
          <p>Matching order data is stale. Protection is not confirmed.</p>
        ) : orders.stops.length === 0 && orders.targets.length === 0 ? (
          <p>No matching active stop orders or targets were received. Protection is not confirmed.</p>
        ) : (
          <>
            <ul className="space-y-1">
              {orders.stops.slice(0, MAX_VISIBLE_POSITION_ORDERS).map((order, index) => (
                <li key={`stop-${order.algoId}-${index}`}>
                  Stop: price {order.slTriggerPrice}; quantity {order.volume} contracts
                </li>
              ))}
              {orders.targets.slice(0, MAX_VISIBLE_POSITION_ORDERS).map((order, index) => (
                <li key={`target-${order.algoId}-${index}`}>
                  Target: price {order.tpTriggerPrice}; quantity {order.volume} contracts
                </li>
              ))}
            </ul>
            {orders.stops.length > MAX_VISIBLE_POSITION_ORDERS ? (
              <p>
                Showing the first {MAX_VISIBLE_POSITION_ORDERS} of {orders.stops.length} received
                stop orders.
              </p>
            ) : null}
            {orders.targets.length > MAX_VISIBLE_POSITION_ORDERS ? (
              <p>
                Showing the first {MAX_VISIBLE_POSITION_ORDERS} of {orders.targets.length} received
                targets.
              </p>
            ) : null}
            <p>Position coverage is unknown; protection is not confirmed.</p>
          </>
        )}
        <ul aria-label="Why protection is unconfirmed" className="text-muted-foreground space-y-1 text-xs">
          {orders.reasons.map(reason => <li key={reason}>{STOP_EVIDENCE_REASON[reason]}</li>)}
        </ul>
        {orders.receivedQuantityComparison ? (
          <p>
            Received quantity of one SL order ({orders.receivedQuantityComparison.stopVolume} contracts){" "}
            {QUANTITY_RELATION[orders.receivedQuantityComparison.relation]} position{" "}
            ({orders.receivedQuantityComparison.positionVolume} contracts). This compares received numbers; it does not confirm protection.
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Positions read at: {time(projection.positions.readCompletedAtMs)}.
          Conditional orders read at: {time(projection.algoOrders.readCompletedAtMs)}.
          These reads are not a simultaneous snapshot.
        </p>
        <p className="text-muted-foreground text-xs">
          These are received conditional orders only; position coverage is unknown.
        </p>
      </div>
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
        <p className="text-sm">Last received data shown; it may be stale.</p>
      ) : null}
      <ReadError error={observation.error} />
      {visibleValues === null ? (
        <p>Data unavailable — this is not a confirmed empty result.</p>
      ) : visibleValues.length === 0 ? (
        <p>{observation.status === "COMPLETE" ? empty : "No rows were received in this read."}</p>
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
        <Value label="Order quantity (contracts)" value={row.volume} />
        <Value label="Position side" value={row.positionSide} />
        <Value label="Received target price" value={row.tpTriggerPrice} />
        <Value label="Received stop price" value={row.slTriggerPrice} />
      </dl>
    </WaiaSurface>
  );
}

const ALGO_TYPE: Record<HtxV5AlgoOrder["type"], string> = {
  tp: "Take-profit order",
  sl: "Stop order",
  tpsl: "Combined stop and target order",
  trigger: "Trigger order",
  trailing_stop: "Trailing stop",
};

function AlgoOrder({ row }: { row: HtxV5AlgoOrder }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        {row.contractCode} · {ALGO_TYPE[row.type]}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Order quantity (contracts)" value={row.volume} />
        <Value label="Position side" value={row.positionSide} />
        <Value label="Received target price" value={row.tpTriggerPrice} />
        <Value label="Received stop price" value={row.slTriggerPrice} />
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
          Last conditional orders read shown; data may be stale.
        </p>
      ) : null}
      <ReadError error={observation.error} />
      {visibleValues === null ? (
        <p>Conditional order data unavailable. Protection is not confirmed.</p>
      ) : visibleValues.length === 0 ? (
        <p>No conditional order rows received. Protection is not confirmed.</p>
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
          This snapshot does not confirm protection of the open position.
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Conditional orders are shown separately from positions; protection completeness is not assessed.
        </p>
      )}
    </section>
  );
}

function Fill({ row }: { row: HtxV5Fill }) {
  return (
    <WaiaSurface variant="raised" className="space-y-2 p-3">
      <h4 className="font-medium">
        Fill · {row.contractCode} · {row.side}
      </h4>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Fill quantity (contracts)" value={row.tradeVolume} />
        <Value label="Fill price" value={row.tradePrice} />
        <Value label="Turnover reported by HTX" value={row.tradeTurnover} />
        <Value label="Fee" value={row.tradeFee} />
        <Value label="Fee currency" value={row.feeCurrency} />
        <Value label="PnL reported by HTX" value={row.profit} />
      </dl>
      <p className="text-muted-foreground text-xs">HTX fill time: {time(row.createdTimeMs)}</p>
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
        title="HTX Futures order fills"
        status={statusLabel(observation.status, stale)}
        completedAt={
          observation.status === "NOT_CONFIGURED" ? undefined : observation.readCompletedAtMs
        }
      />
      {stale ? (
        <p className="text-sm">Last fills read shown; data may be stale.</p>
      ) : null}
      {observation.status === "NOT_CONFIGURED" || observation.coverage === "NOT_CONFIGURED" ? (
        <p>Fill history unavailable; the fill count is unknown.</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Read contracts: {observation.contracts.join(", ") || "unavailable"}
          </p>
          <p className="text-muted-foreground text-sm">
            History window: {time(observation.windowStartMs)} – {time(observation.windowEndMs)}
          </p>
          <ReadError error={observation.error} />
          {visibleValues === null ? (
            <p>Fill data unavailable — this is not confirmed absence of fills.</p>
          ) : visibleValues.length === 0 ? (
            <p>
              {observation.status === "COMPLETE"
                ? "No fills were received for the specified contracts and displayed window."
                : "No fill rows were received in this read."}
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
            This window does not confirm complete daily activity or a daily result.
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
        <h3 className="text-base font-semibold">HTX Futures account snapshot</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Last received HTX account data. Position and order quantities are in contracts.
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
          <p className="text-sm">Last received positions shown; data may be stale.</p>
        ) : null}
        <ReadError error={projection.positions.error} />
        {visiblePositions === null ? (
          <p>Position data unavailable — this is not a confirmed zero quantity.</p>
        ) : visiblePositions.length === 0 ? (
          <p>
            {projection.positions.status === "COMPLETE"
              ? "No open positions were received."
              : "No position rows were received in this read."}
          </p>
        ) : (
          <div className="space-y-2">
          {visiblePositions.map((row, index) => (
            <Position
              key={row.contractCode + "-" + row.positionSide + "-" + index}
              row={row}
              projection={projection}
              stale={inheritedStale}
              nowMs={nowMs}
            />
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
      <HtxV5BillsSection
        observation={projection.schemaVersion === "htx-v5-observation/v2" ? projection.bills : null}
        inheritedStale={inheritedStale}
        nowMs={nowMs}
      />
    </section>
  );
}
