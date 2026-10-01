import { WaiaSurface } from "@/components/waia/waia-surface";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES } from "@/lib/trader/account-observation/derivatives/types";
import type {
  HtxDerivativesAccountFamily,
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

function Family({ observation, stale, nowMs }: { observation: DerivativesAccountFamilyObservation; stale: boolean; nowMs: number }) {
  const { family, accounts } = observation;
  const readCompletedAtMs = observation.readCompletedAtMs;
  const familyStale = stale || (readCompletedAtMs !== null && Number.isSafeInteger(readCompletedAtMs) &&
    readCompletedAtMs <= nowMs && nowMs - readCompletedAtMs >= ACCOUNT_OBSERVATION_STALE_AFTER_MS);
  const status = observation.status === "NOT_CONFIGURED" || observation.status === "ERROR"
    ? observation.status
    : familyStale ? observation.status === "PARTIAL" ? "STALE · PARTIAL" : "STALE"
      : observation.status === "PARTIAL" ? "PARTIAL" : "CURRENT";
  return (
    <section aria-label={FAMILY_LABEL[family]} className="border-border space-y-3 rounded-lg border p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{FAMILY_LABEL[family]}</h3>
        <span data-testid={`derivatives-status-${family}`} className="text-xs text-waia-fg-muted">
          {status}
        </span>
      </header>
      {family === "usdt_cross_shared" ? (
        <p className="text-muted-foreground text-xs">
          Shared USDT pool for perpetual and delivery contracts. Account totals are shown once; contract details are not added again.
        </p>
      ) : null}
      {status.startsWith("STALE") ? <p className="text-sm">Showing the last received account read; it may be out of date.</p> : null}
      {observation.status === "PARTIAL" ? <p className="text-sm">Some account values are unavailable in this read.</p> : null}
      {observation.status === "ERROR" ? <p role="alert" className="text-sm">{ERROR_LABEL[observation.error ?? "READ_FAILED"]}</p> : null}
      {observation.status === "NOT_CONFIGURED" ? <p className="text-sm">This account family is not configured for collection.</p> : null}
      {accounts?.length === 0 ? (
        <p className="text-sm">No accounts were returned for this family.</p>
      ) : null}
      {accounts?.map((account, index) => (
        <WaiaSurface key={`${family}-${account.accountCode}-${index}`} variant="raised" className="space-y-3 p-3">
          <p className="text-sm font-medium">
            {account.accountCode} · {account.collateralAsset ?? "Collateral unavailable"}
          </p>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Value label="Margin balance" value={account.marginBalance} />
            {family === "usdt_cross_shared"
              ? <Value label="Available to transfer" value={account.withdrawAvailable ?? null} />
              : <Value label="Available margin" value={account.marginAvailable} />}
            <Value label="Frozen margin" value={account.marginFrozen} />
            <Value label="Unrealized PnL" value={account.unrealizedPnl} />
          </dl>
        </WaiaSurface>
      ))}
      <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
        <div><dt>Read started</dt><dd>{timestamp(observation.readStartedAtMs)}</dd></div>
        <div><dt>Read completed</dt><dd>{timestamp(observation.readCompletedAtMs)}</dd></div>
        <div><dt>Response generated</dt><dd>{timestamp(observation.responseGeneratedAtMs)}</dd></div>
      </dl>
    </section>
  );
}

/** Presentation only: caller supplies an authorized, already projected observation. */
export function DerivativesAccountSection({ projection, stale = false, nowMs }: {
  projection: DerivativesAccountObservation | null;
  stale?: boolean;
  nowMs: number;
}) {
  const families = projection?.families ?? HTX_DERIVATIVES_ACCOUNT_FAMILIES.map(family => ({
    family, status: "NOT_CONFIGURED" as const, accounts: null, readStartedAtMs: null,
    readCompletedAtMs: null, responseGeneratedAtMs: null, error: null,
  }));
  return (
    <section aria-label="Futures account display" className="border-border space-y-4 rounded-xl border p-4">
      <div>
        <h2 className="text-lg font-semibold">Futures accounts</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Read-only account visibility. PnL is reported by HTX; values stay separate by account family and collateral asset, with no combined total.
        </p>
      </div>
      <div className="space-y-3">{families.map((observation) => <Family key={observation.family} observation={observation} stale={stale} nowMs={nowMs} />)}</div>
    </section>
  );
}
