import { WaiaSurface } from "@/components/waia/waia-surface";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES } from "@/lib/trader/account-observation/derivatives/types";
import type {
  HtxDerivativesAccountFamily,
  HtxDerivativesFillRow,
} from "@/lib/trader/account-observation/derivatives/types";
import type {
  DerivativesAccountFamilyObservation,
  DerivativesAccountObservation,
  ObservationReadError,
} from "@/lib/trader/account-observation/types";

const FAMILY_LABEL: Record<HtxDerivativesAccountFamily, string> = {
  usdt_isolated_perpetual: "USDT perpetual · isolated accounts",
  usdt_cross_shared: "USDT cross · shared derivatives pool",
  coin_perpetual: "Coin-margined perpetual accounts",
  coin_delivery_futures: "Coin-margined delivery futures accounts",
};

const ERROR_LABEL: Record<ObservationReadError, string> = {
  TIMEOUT: "The account read timed out.",
  READ_FAILED: "The account could not be read.",
  INVALID_RESPONSE: "The exchange response could not be verified.",
  PERMISSION_DENIED: "This account family is not available for display.",
  RATE_LIMITED: "The exchange temporarily limited account reads.",
  IDENTITY_MISMATCH: "The returned account identity could not be verified.",
};

const timestamp = (value: number | null) =>
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

function Position({
  row,
}: {
  row: import("@/lib/trader/account-observation/derivatives/types").HtxDerivativesPositionRow;
}) {
  return (
    <WaiaSurface variant="raised" className="space-y-3 p-3">
      <div>
        <h4 className="font-medium">
          {row.symbol} · {row.contractCode}
        </h4>
        <p className="text-muted-foreground text-xs">
          {row.direction === "buy" ? "Long" : "Short"} ·{" "}
          {row.contractType ?? "Contract type unavailable"}
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Position quantity" value={row.volume} />
        <Value label="Available quantity" value={row.available} />
        <Value label="Frozen quantity" value={row.frozen} />
        <Value label="Open cost" value={row.costOpen} />
        <Value label="Position cost" value={row.costHold} />
        <Value label="HTX unrealized PnL" value={row.unrealizedPnl} />
        <Value label="HTX profit rate" value={row.profitRate} />
        <Value label="Position margin" value={row.positionMargin} />
        <Value label="Margin asset" value={row.marginAsset} />
        <Value label="Leverage" value={row.leverage} />
        <Value label="Last price" value={row.lastPrice} />
        <Value label="Liquidation price" value={row.liquidationPrice} />
      </dl>
    </WaiaSurface>
  );
}

function Positions({
  observation,
  stale,
  nowMs,
}: {
  observation: DerivativesAccountFamilyObservation;
  stale: boolean;
  nowMs: number;
}) {
  const positions = observation.positions;
  if (!positions) {
    return (
      <section aria-label="Per-contract positions" className="space-y-2 border-t pt-3">
        <h4 className="font-medium">Open positions</h4>
        <p className="text-muted-foreground text-sm">Not collected in this observation.</p>
      </section>
    );
  }

  const positionStale =
    stale ||
    (positions.readCompletedAtMs <= nowMs &&
      nowMs - positions.readCompletedAtMs >= ACCOUNT_OBSERVATION_STALE_AFTER_MS);
  const status =
    positions.status === "ERROR"
      ? "ERROR"
      : positionStale
        ? positions.status === "PARTIAL"
          ? "STALE · PARTIAL"
          : "STALE"
        : positions.status === "PARTIAL"
          ? "PARTIAL"
          : "CURRENT";

  return (
    <section aria-label="Per-contract positions" className="space-y-3 border-t pt-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-medium">Open positions</h4>
        <span
          data-testid={`positions-status-${observation.family}`}
          className="text-waia-fg-muted text-xs"
        >
          {status}
        </span>
      </header>
      {positionStale ? (
        <p className="text-sm">Showing the last received position read; it may be out of date.</p>
      ) : null}
      {positions.status === "ERROR" ? (
        <p role="alert" className="text-sm">
          {ERROR_LABEL[positions.error ?? "READ_FAILED"]}
        </p>
      ) : null}
      {positions.status === "PARTIAL" ? (
        <p className="text-sm">Some position values are unavailable in this read.</p>
      ) : null}
      {positions.status === "COMPLETE" && positions.values?.length === 0 ? (
        <p className="text-sm">No open positions were returned for this family.</p>
      ) : null}
      {positions.status !== "ERROR" &&
        positions.values?.map((row, index) => (
          <Position key={`${row.symbol}-${row.contractCode}-${row.direction}-${index}`} row={row} />
        ))}
      <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <dt>Position read started</dt>
          <dd>{timestamp(positions.readStartedAtMs)}</dd>
        </div>
        <div>
          <dt>Position read completed</dt>
          <dd>{timestamp(positions.readCompletedAtMs)}</dd>
        </div>
        <div>
          <dt>Position response generated</dt>
          <dd>{timestamp(positions.responseGeneratedAtMs)}</dd>
        </div>
      </dl>
    </section>
  );
}

const OFFSET_LABEL = { open: "Open", close: "Close", both: "Both" } as const;

function Fill({ row }: { row: HtxDerivativesFillRow }) {
  return (
    <WaiaSurface variant="raised" className="space-y-3 p-3">
      <div>
        <h4 className="font-medium">
          Executed fill · {row.symbol} · {row.contractCode}
        </h4>
        <p className="text-muted-foreground text-xs">
          {row.direction === "buy" ? "Buy" : "Sell"} · {OFFSET_LABEL[row.offset]} · not an open
          position or a balance
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="Fill quantity" value={row.volume} />
        <Value label="Fill price" value={row.price} />
        <Value label="Fee" value={row.fee} />
        <Value label="Fee currency" value={row.feeAsset} />
        <Value label="Venue realized PnL" value={row.realizedPnl} />
        <Value label="Close PnL" value={row.offsetPnl} />
        <Value label="Fill id" value={row.id} />
        <Value label="Match id (not unique)" value={row.matchId} />
      </dl>
      <p className="text-muted-foreground text-xs">Venue fill time {timestamp(row.executedAtMs)}</p>
    </WaiaSurface>
  );
}

function Executions({
  observation,
  stale,
  nowMs,
}: {
  observation: DerivativesAccountFamilyObservation;
  stale: boolean;
  nowMs: number;
}) {
  const executions = observation.executions;
  if (!executions) {
    return (
      <section aria-label="Executed fills" className="space-y-2 border-t pt-3">
        <h4 className="font-medium">Recent executions</h4>
        <p className="text-muted-foreground text-sm">
          Executed fills were not collected in this observation.
        </p>
      </section>
    );
  }
  const executionStale =
    executions.status !== "NOT_CONFIGURED" &&
    (stale ||
      (executions.readCompletedAtMs <= nowMs &&
        nowMs - executions.readCompletedAtMs >= ACCOUNT_OBSERVATION_STALE_AFTER_MS));
  const status =
    executions.status === "NOT_CONFIGURED"
      ? "NOT CONFIGURED"
      : executions.status === "ERROR"
        ? "ERROR"
        : executionStale
          ? executions.status === "PARTIAL"
            ? "STALE · PARTIAL"
            : "STALE"
          : executions.status === "PARTIAL"
            ? "PARTIAL"
            : "CURRENT";
  return (
    <section aria-label="Executed fills" className="space-y-3 border-t pt-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-medium">Recent executions</h4>
        <span
          data-testid={`executions-status-${observation.family}`}
          className="text-waia-fg-muted text-xs"
        >
          {status}
        </span>
      </header>
      <p className="text-muted-foreground text-xs">
        Executed fills are historical trades. They are not open positions and are not added to
        account balances.
        {observation.family === "usdt_cross_shared"
          ? " These fills are not a second copy of the shared USDT pool."
          : ""}{" "}
        Seeing fills does not permit trading.
      </p>
      {executions.status === "NOT_CONFIGURED" ? (
        <p className="text-sm">
          No closed contract set is configured for fill history. Open positions do not prove fills
          for contracts that are already closed.
        </p>
      ) : null}
      {executions.status !== "NOT_CONFIGURED" ? (
        <p className="text-muted-foreground text-xs">
          History covers only the configured contracts in the lookback window, not every contract
          this account has traded.
          {executions.contracts.length ? ` Configured: ${executions.contracts.join(", ")}.` : ""}
        </p>
      ) : null}
      {executionStale ? (
        <p className="text-sm">Showing the last received fill read; it may be out of date.</p>
      ) : null}
      {executions.status === "ERROR" ? (
        <p role="alert" className="text-sm">
          {ERROR_LABEL[executions.error ?? "READ_FAILED"]}
        </p>
      ) : null}
      {executions.status === "PARTIAL" ? (
        <p className="text-sm">
          This fill history hit a read limit or is missing values. It is not a complete history.
        </p>
      ) : null}
      {executions.status === "COMPLETE" && executions.values?.length === 0 ? (
        <p className="text-sm">
          No executed fills were returned for the configured contracts in this window.
        </p>
      ) : null}
      {executions.status !== "ERROR" &&
        executions.status !== "NOT_CONFIGURED" &&
        executions.values?.map((row) => <Fill key={row.id} row={row} />)}
      <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <dt>Fill read started</dt>
          <dd>{timestamp(executions.readStartedAtMs)}</dd>
        </div>
        <div>
          <dt>Fill read completed</dt>
          <dd>{timestamp(executions.readCompletedAtMs)}</dd>
        </div>
        <div>
          <dt>Fill response generated</dt>
          <dd>{timestamp(executions.responseGeneratedAtMs)}</dd>
        </div>
        <div>
          <dt>Lookback start</dt>
          <dd>{timestamp(executions.windowStartMs)}</dd>
        </div>
        <div>
          <dt>Lookback end</dt>
          <dd>{timestamp(executions.windowEndMs)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Family({
  observation,
  stale,
  nowMs,
}: {
  observation: DerivativesAccountFamilyObservation;
  stale: boolean;
  nowMs: number;
}) {
  const { family, accounts } = observation;
  const readCompletedAtMs = observation.readCompletedAtMs;
  const familyStale =
    stale ||
    (readCompletedAtMs !== null &&
      Number.isSafeInteger(readCompletedAtMs) &&
      readCompletedAtMs <= nowMs &&
      nowMs - readCompletedAtMs >= ACCOUNT_OBSERVATION_STALE_AFTER_MS);
  const status =
    observation.status === "NOT_CONFIGURED" || observation.status === "ERROR"
      ? observation.status
      : familyStale
        ? observation.status === "PARTIAL"
          ? "STALE · PARTIAL"
          : "STALE"
        : observation.status === "PARTIAL"
          ? "PARTIAL"
          : "CURRENT";
  return (
    <section
      aria-label={FAMILY_LABEL[family]}
      className="border-border space-y-3 rounded-lg border p-3"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{FAMILY_LABEL[family]}</h3>
        <span data-testid={`derivatives-status-${family}`} className="text-waia-fg-muted text-xs">
          {status}
        </span>
      </header>
      {family === "usdt_cross_shared" ? (
        <p className="text-muted-foreground text-xs">
          Shared USDT pool for perpetual and delivery contracts. Account totals are shown once;
          contract details are not added again.
        </p>
      ) : null}
      {status.startsWith("STALE") ? (
        <p className="text-sm">Showing the last received account read; it may be out of date.</p>
      ) : null}
      {observation.status === "PARTIAL" ? (
        <p className="text-sm">Some account values are unavailable in this read.</p>
      ) : null}
      {observation.status === "ERROR" ? (
        <p role="alert" className="text-sm">
          {ERROR_LABEL[observation.error ?? "READ_FAILED"]}
        </p>
      ) : null}
      {observation.status === "NOT_CONFIGURED" ? (
        <p className="text-sm">This account family is not configured for collection.</p>
      ) : null}
      {accounts?.length === 0 ? (
        <p className="text-sm">No accounts were returned for this family.</p>
      ) : null}
      {accounts?.map((account, index) => (
        <WaiaSurface
          key={`${family}-${account.accountCode}-${index}`}
          variant="raised"
          className="space-y-3 p-3"
        >
          <p className="text-sm font-medium">
            {account.accountCode} · {account.collateralAsset ?? "Collateral unavailable"}
          </p>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Value label="Margin balance" value={account.marginBalance} />
            {family === "usdt_cross_shared" ? (
              <Value label="Available to transfer" value={account.withdrawAvailable ?? null} />
            ) : (
              <Value label="Available margin" value={account.marginAvailable} />
            )}
            <Value label="Frozen margin" value={account.marginFrozen} />
            <Value label="Unrealized PnL" value={account.unrealizedPnl} />
          </dl>
        </WaiaSurface>
      ))}
      <Positions observation={observation} stale={stale} nowMs={nowMs} />
      <Executions observation={observation} stale={stale} nowMs={nowMs} />
      <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <dt>Read started</dt>
          <dd>{timestamp(observation.readStartedAtMs)}</dd>
        </div>
        <div>
          <dt>Read completed</dt>
          <dd>{timestamp(observation.readCompletedAtMs)}</dd>
        </div>
        <div>
          <dt>Response generated</dt>
          <dd>{timestamp(observation.responseGeneratedAtMs)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Presentation only: caller supplies an authorized, already projected observation. */
export function DerivativesAccountSection({
  projection,
  stale = false,
  nowMs,
}: {
  projection: DerivativesAccountObservation | null;
  stale?: boolean;
  nowMs: number;
}) {
  const families =
    projection?.families ??
    HTX_DERIVATIVES_ACCOUNT_FAMILIES.map((family) => ({
      family,
      status: "NOT_CONFIGURED" as const,
      accounts: null,
      readStartedAtMs: null,
      readCompletedAtMs: null,
      responseGeneratedAtMs: null,
      error: null,
    }));
  return (
    <section
      aria-label="Futures account display"
      className="border-border space-y-4 rounded-xl border p-4"
    >
      <div>
        <h2 className="text-lg font-semibold">Futures accounts</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Read-only futures display. Balances, open positions, and executed fills stay separate. PnL
          is reported by HTX and is not combined across collateral. Seeing this display does not
          permit futures trading.
        </p>
      </div>
      <div className="space-y-3">
        {families.map((observation) => (
          <Family key={observation.family} observation={observation} stale={stale} nowMs={nowMs} />
        ))}
      </div>
    </section>
  );
}
