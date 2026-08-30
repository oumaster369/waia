import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";

export type FhvStreamConnectionState = "connecting" | "live" | "stale" | "reconnecting";

export type FhvAdminAccountRow = Readonly<{
  id: string;
  label: string;
  cash: string | null;
  equity: string | null;
  pnl: string | null;
  pnl24h: string | null;
  direction24h: "up" | "down" | "flat" | "unavailable";
  openPositions: number | null;
}>;

export type FhvAdminAccountEvent = Readonly<{
  schemaVersion: "fhv-realtime-event/v1";
  kind: "account.balance";
  organizationId: string;
  campaignRunId: string;
  source: "HISTORICAL_SIMULATION";
  payload: Readonly<Record<string, unknown>>;
}>;

export function parseFhvStatus(value: Record<string, unknown>): FhvOperatorStatusV1 | null {
  return value.schemaVersion === "fhv-operator-status/v1"
    ? (value as unknown as FhvOperatorStatusV1)
    : null;
}

export function parseFiniteDecimal(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function connectionState(input: {
  hasStatus: boolean;
  requestPending: boolean;
  consecutiveFailures: number;
  observedAt: string | null;
  nowMs: number;
}): FhvStreamConnectionState {
  if (!input.hasStatus && input.requestPending) return "connecting";
  if (input.consecutiveFailures > 0) return "reconnecting";
  if (!input.observedAt) return "connecting";
  const ageMs = input.nowMs - Date.parse(input.observedAt);
  return Number.isFinite(ageMs) && ageMs <= 15_000 ? "live" : "stale";
}

/**
 * FHV currently exposes one authoritative simulated account per campaign.  Keep the row explicit
 * rather than fabricating exchange/user accounts that are not present in the observer contract.
 */
export function buildAdminAccountRows(status: FhvOperatorStatusV1): readonly FhvAdminAccountRow[] {
  return [
    {
      id: `historical:${status.campaign.organizationId}`,
      label: `${status.campaign.currentSymbol ?? "Campaign"} simulated account`,
      cash: status.tradingSimulation.cash,
      equity: status.tradingSimulation.equity,
      pnl: status.tradingSimulation.netPnl,
      pnl24h: null,
      direction24h: "unavailable",
      openPositions: status.tradingSimulation.openPositionsCount,
    },
  ];
}

function decimalString(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  return parseFiniteDecimal(value) === null ? null : value;
}

/** Retains independently identified historical virtual accounts; never accepts live/exchange data. */
export function reduceAdminAccountEvent(
  rows: readonly FhvAdminAccountRow[],
  event: FhvAdminAccountEvent,
): readonly FhvAdminAccountRow[] {
  if (
    event.schemaVersion !== "fhv-realtime-event/v1" ||
    event.kind !== "account.balance" ||
    event.source !== "HISTORICAL_SIMULATION"
  ) return rows;
  const accountId = typeof event.payload.accountId === "string" ? event.payload.accountId.trim() : "";
  if (!accountId || event.payload.accountKind !== "HISTORICAL_VIRTUAL") return rows;
  const delta24h = decimalString(event.payload.delta24h);
  const deltaNumber = parseFiniteDecimal(delta24h);
  const next: FhvAdminAccountRow = {
    id: accountId,
    label: typeof event.payload.label === "string" && event.payload.label.trim()
      ? event.payload.label.trim()
      : `${accountId} simulated account`,
    cash: decimalString(event.payload.cash),
    equity: decimalString(event.payload.equity),
    pnl: decimalString(event.payload.netPnl),
    pnl24h: delta24h,
    direction24h: deltaNumber === null ? "unavailable" : deltaNumber > 0 ? "up" : deltaNumber < 0 ? "down" : "flat",
    openPositions: typeof event.payload.openPositionsCount === "number" && Number.isInteger(event.payload.openPositionsCount)
      ? event.payload.openPositionsCount
      : null,
  };
  return [...rows.filter((row) => row.id !== accountId), next];
}

export function sumKnownAccountMetric(
  rows: readonly FhvAdminAccountRow[],
  field: "cash" | "equity" | "pnl" | "pnl24h",
): number | null {
  const values = rows.map((row) => parseFiniteDecimal(row[field]));
  return values.length > 0 && values.every((value) => value !== null)
    ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
    : null;
}

export function sumKnownAccountEquity(rows: readonly FhvAdminAccountRow[]): number | null {
  return sumKnownAccountMetric(rows, "equity");
}
