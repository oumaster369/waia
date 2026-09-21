import type { AccountObservation } from "./types";

type SpotBalance = Readonly<{
  asset: string;
  free: string;
  locked: string;
  total: string;
}>;

export type CabinetLiveInput = Readonly<{
  status: string;
  observation: AccountObservation | null;
  stale: boolean;
  transport?: "STREAMING" | "POLLING" | "RECONNECTING";
}>;

/** Two sequential HTX reads are ~80–90s each; UI older-than-this is stale. Must exceed one multi-account sweep. */
export const ACCOUNT_OBSERVATION_STALE_AFTER_MS = 600_000;
export const ACCOUNT_OBSERVATION_POLL_INTERVAL_MS = 180_000;
export const ACCOUNT_OBSERVATION_FIRST_TICK_COPY =
  "HTX is connected. Waiting for the first live snapshot — usually about a minute.";

const ZERO_AMOUNT = /^(?:0+(?:\.0+)?)$/;
const MAJOR_ASSETS = ["USDT", "USDC", "BTC", "ETH", "HT"] as const;

export function isObservedZeroAmount(value: string): boolean {
  return ZERO_AMOUNT.test(value.trim());
}

export function nonZeroBalances(
  rows: readonly SpotBalance[] | null | undefined,
): readonly SpotBalance[] {
  if (!rows) return [];
  return rows.filter((row) => !isObservedZeroAmount(row.total));
}

export function majorSpotTotals(
  rows: readonly SpotBalance[] | null | undefined,
): Readonly<Record<(typeof MAJOR_ASSETS)[number], string | null>> {
  const found = Object.fromEntries(MAJOR_ASSETS.map((asset) => [asset, null])) as Record<
    (typeof MAJOR_ASSETS)[number],
    string | null
  >;
  if (!rows) return found;
  for (const row of rows) {
    if (
      (MAJOR_ASSETS as readonly string[]).includes(row.asset) &&
      found[row.asset as (typeof MAJOR_ASSETS)[number]] === null
    ) {
      found[row.asset as (typeof MAJOR_ASSETS)[number]] = row.total;
    }
  }
  return found;
}

export function formatBalanceLine(row: SpotBalance): string {
  return `${row.asset}: free ${row.free}, locked ${row.locked}, total ${row.total}`;
}

export function formatOrderLine(row: {
  symbol: string;
  side: string;
  type: string;
  status: string;
  quantity: string;
  filledQuantity: string;
  price?: string;
  orderId: string;
}): string {
  return `${row.symbol} ${row.side} ${row.type} · ${row.status} · quantity ${row.quantity}, filled ${row.filledQuantity}, price ${row.price ?? "Not provided"} · order ${row.orderId}`;
}

export function formatTradeLine(row: {
  symbol?: string;
  side: string;
  quantity: string;
  price: string;
  fee: string;
  feeAsset: string;
  executedAt: string;
  tradeId: string;
}): string {
  const fill = `${row.side} ${row.quantity} @ ${row.price} · fee ${row.fee} ${row.feeAsset} · ${row.executedAt} · trade ${row.tradeId}`;
  return row.symbol ? `${row.symbol} · ${fill}` : fill;
}

export function ageLabel(completedAtMs: number, nowMs: number): string {
  if (!Number.isFinite(completedAtMs) || completedAtMs > nowMs) return "time unknown";
  const seconds = Math.floor((nowMs - completedAtMs) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

/** Partner-facing headline. Machine status stays in role=status for tests. */
export function cabinetLiveLabel(view: CabinetLiveInput): string {
  if (view.status === "REVOKED") return "Revoked";
  if (view.status === "DISCONNECTED") return "Idle";
  if (!view.observation) return "Connecting";
  if (view.status === "STALE" || view.stale) return "Last tick";
  if (view.observation) return "Live";
  if (view.status === "LOADING") return "Connecting";
  if (view.status === "ERROR") return "Reconnecting";
  return "Live";
}

export function usdtSpot(rows: readonly SpotBalance[] | null | undefined): {
  free: string;
  locked: string;
  total: string;
} | null {
  if (!rows) return null;
  const row = rows.find((item) => item.asset === "USDT");
  return row ? { free: row.free, locked: row.locked, total: row.total } : null;
}

export function nonUsdtInventory(
  rows: readonly SpotBalance[] | null | undefined,
): readonly SpotBalance[] {
  return nonZeroBalances(rows).filter((row) => row.asset !== "USDT" && row.asset !== "USDC");
}

export function secondsUntilNextPoll(
  completedAtMs: number,
  nowMs: number,
  intervalMs = ACCOUNT_OBSERVATION_POLL_INTERVAL_MS,
): number {
  if (!Number.isFinite(completedAtMs) || !Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  if (completedAtMs > nowMs) return Math.ceil(intervalMs / 1000);
  return Math.max(0, Math.ceil((completedAtMs + intervalMs - nowMs) / 1000));
}

export function cabinetSpotSource(observation: AccountObservation): readonly SpotBalance[] | null {
  if (observation.holdings && observation.holdings.length > 0) return observation.holdings;
  return observation.balances.values;
}

export type CabinetObservationSummary = Readonly<{
  usdtFree: string | null;
  usdtLocked: string | null;
  openOrdersCount: number | null;
  lastTickMs: number | null;
  observationStatus: string | null;
}>;

export function summarizeCabinetObservation(
  observation: AccountObservation | null,
): CabinetObservationSummary {
  if (!observation) {
    return {
      usdtFree: null,
      usdtLocked: null,
      openOrdersCount: null,
      lastTickMs: null,
      observationStatus: null,
    };
  }
  const usdt = usdtSpot(observation.balances.values);
  return {
    usdtFree: usdt?.free ?? null,
    usdtLocked: usdt?.locked ?? null,
    openOrdersCount:
      observation.openOrders.values === null ? null : observation.openOrders.values.length,
    lastTickMs: observation.collectionCompletedAtMs,
    observationStatus: observation.status,
  };
}
