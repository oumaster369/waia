import { ACCOUNT_OBSERVATION_STALE_AFTER_MS, type FuturesBalanceSummary } from "./cabinet-view";

export type OverviewFuturesRow = Readonly<{
  organizationId: string;
  credentialId: string;
  exchangeAccountId: string;
  htxUid: string | null;
  observation: "loading" | "waiting" | "ready" | "unavailable";
  futures: FuturesBalanceSummary | null;
}>;

export type OverviewFuturesExclusion =
  | "DIRECTORY_STALE"
  | "IDENTITY_UNAVAILABLE"
  | "DUPLICATE_IDENTITY"
  | "OBSERVATION_UNAVAILABLE"
  | "FUTURES_UNAVAILABLE"
  | "TIME_INVALID"
  | "STALE"
  | "AMOUNT_UNSUPPORTED";

export type OverviewFuturesSummary = Readonly<{
  state: "complete" | "partial" | "unavailable" | "empty";
  currency: "USD";
  equityUsd: string | null;
  availableMarginUsd: string | null;
  profitUnrealUsd: string | null;
  included: number;
  total: number;
  oldestReadCompletedAtMs: number | null;
  excluded: readonly Readonly<{
    exchangeAccountId: string;
    reason: OverviewFuturesExclusion;
  }>[];
}>;

type ExactAmount = Readonly<{ coefficient: bigint; scale: number }>;

// Display-only bounded decimal arithmetic. V5 permits scientific notation and
// more than Risk's eight decimal places; no amount passes through Number or Risk.
function exactAmount(value: string | null): ExactAmount | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(value);
  if (!match) return null;
  const exponent = match[4] === undefined ? 0 : Number(match[4]);
  if (Math.abs(exponent) > 128) return null;
  const fraction = match[3] ?? "";
  const rawScale = fraction.length - exponent;
  let coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  if (rawScale < 0) coefficient *= 10n ** BigInt(-rawScale);
  return { coefficient, scale: Math.max(0, rawScale) };
}

function add(left: ExactAmount, right: ExactAmount): ExactAmount {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient:
      left.coefficient * 10n ** BigInt(scale - left.scale) +
      right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

function decimal(value: ExactAmount): string {
  if (value.coefficient === 0n) return "0";
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient)
    .toString()
    .padStart(value.scale + 1, "0");
  const body =
    value.scale === 0
      ? digits
      : `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`
          .replace(/0+$/, "")
          .replace(/\.$/, "");
  return `${negative ? "-" : ""}${body}`;
}

function counts(values: readonly (string | null)[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) if (value) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

/** Only already-authorized, same-binding observations may be passed here.
 * This projection does not establish ownership or feed canonical account value,
 * billing, Risk, day PnL or a combined spot/futures capital figure. */
export function summarizeOverviewFutures(
  rows: readonly OverviewFuturesRow[],
  nowMs: number,
  directoryCurrent = true,
): OverviewFuturesSummary {
  const credentials = counts(rows.map((row) => row.credentialId));
  const accounts = counts(rows.map((row) => row.exchangeAccountId));
  const uids = counts(rows.map((row) => row.htxUid));
  const excluded: { exchangeAccountId: string; reason: OverviewFuturesExclusion }[] = [];
  let included = 0;
  let oldestReadCompletedAtMs: number | null = null;
  let equity: ExactAmount = { coefficient: 0n, scale: 0 };
  let available: ExactAmount = { coefficient: 0n, scale: 0 };
  let unrealized: ExactAmount = { coefficient: 0n, scale: 0 };
  for (const row of rows) {
    let reason: OverviewFuturesExclusion | null = null;
    const balance = row.futures;
    if (!directoryCurrent) reason = "DIRECTORY_STALE";
    else if (!Number.isSafeInteger(nowMs) || nowMs < 0) reason = "TIME_INVALID";
    else if (
      !row.organizationId ||
      !row.credentialId ||
      !row.exchangeAccountId ||
      row.htxUid === null ||
      !/^[1-9]\d{0,31}$/.test(row.htxUid)
    )
      reason = "IDENTITY_UNAVAILABLE";
    else if (
      credentials.get(row.credentialId)! > 1 ||
      accounts.get(row.exchangeAccountId)! > 1 ||
      uids.get(row.htxUid)! > 1
    )
      reason = "DUPLICATE_IDENTITY";
    else if (row.observation !== "ready") reason = "OBSERVATION_UNAVAILABLE";
    else if (
      !balance ||
      !balance.hasFuturesProjection ||
      balance.hasLegacyDerivatives ||
      balance.equityUsd === null ||
      balance.availableMarginUsd === null ||
      balance.profitUnrealUsd === null
    )
      reason = "FUTURES_UNAVAILABLE";
    else if (
      balance.readCompletedAtMs === null ||
      !Number.isSafeInteger(balance.readCompletedAtMs) ||
      balance.readCompletedAtMs < 0 ||
      balance.readCompletedAtMs > nowMs
    )
      reason = "TIME_INVALID";
    else if (
      balance.stale ||
      nowMs - balance.readCompletedAtMs >= ACCOUNT_OBSERVATION_STALE_AFTER_MS
    )
      reason = "STALE";
    const amounts =
      reason === null && balance
        ? ([
            exactAmount(balance.equityUsd),
            exactAmount(balance.availableMarginUsd),
            exactAmount(balance.profitUnrealUsd),
          ] as const)
        : null;
    if (reason === null && (!amounts || amounts.some((value) => value === null)))
      reason = "AMOUNT_UNSUPPORTED";
    if (reason !== null || !amounts) {
      excluded.push({
        exchangeAccountId: row.exchangeAccountId,
        reason: reason ?? "AMOUNT_UNSUPPORTED",
      });
      continue;
    }
    equity = add(equity, amounts[0]!);
    available = add(available, amounts[1]!);
    unrealized = add(unrealized, amounts[2]!);
    included += 1;
    oldestReadCompletedAtMs =
      oldestReadCompletedAtMs === null
        ? balance!.readCompletedAtMs
        : Math.min(oldestReadCompletedAtMs, balance!.readCompletedAtMs!);
  }
  return {
    state:
      rows.length === 0
        ? "empty"
        : included === 0
          ? "unavailable"
          : included === rows.length
            ? "complete"
            : "partial",
    currency: "USD",
    equityUsd: included === 0 ? null : decimal(equity),
    availableMarginUsd: included === 0 ? null : decimal(available),
    profitUnrealUsd: included === 0 ? null : decimal(unrealized),
    included,
    total: rows.length,
    oldestReadCompletedAtMs,
    excluded,
  };
}
