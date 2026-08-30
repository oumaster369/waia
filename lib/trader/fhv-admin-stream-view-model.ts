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
  const netPnl = parseFiniteDecimal(status.tradingSimulation.netPnl);
  return [
    {
      id: status.campaign.runId,
      label: `${status.campaign.currentSymbol ?? "Campaign"} simulated account`,
      cash: status.tradingSimulation.cash,
      equity: status.tradingSimulation.equity,
      pnl: status.tradingSimulation.netPnl,
      pnl24h: null,
      direction24h: netPnl === null ? "unavailable" : netPnl > 0 ? "up" : netPnl < 0 ? "down" : "flat",
      openPositions: status.tradingSimulation.openPositionsCount,
    },
  ];
}

export function sumKnownAccountEquity(rows: readonly FhvAdminAccountRow[]): number | null {
  const values = rows.map((row) => parseFiniteDecimal(row.equity));
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

