import type { AdminDataState } from "@/lib/trader/admin-console/contracts";
import {
  operationalRealizedPnl,
  type OperationalLeg,
} from "@/lib/trader/admin-console/money/operational-pnl";
import { addDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

export type EquityEvidencePoint = {
  at: string;
  bucket?: string;
  equity: string;
  unrealized: string;
  valuationKey: string;
  state: string;
};
export type PeriodResult = {
  state: AdminDataState;
  reasons: string[];
  total: string | null;
  realized: string | null;
  unrealizedChange: string | null;
  openFees: string | null;
  closeFees: string | null;
  tradingFees: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  start: string;
  end: string;
  method: string;
  currency: "USDT" | "USD";
};

/** Saved five-minute points are evidence, never an interpolation across gaps. */
export function periodResult(input: {
  legs: readonly OperationalLeg[];
  points: readonly EquityEvidencePoint[];
  currentEndpoint?: EquityEvidencePoint;
  start: string;
  end: string;
  reasons?: readonly string[];
}): PeriodResult {
  const realized = operationalRealizedPnl(input.legs, input.start, input.end);
  const reasons = [...realized.reasons, ...(input.reasons ?? [])];
  const points = [...input.points]
    .filter((point) => point.state === "ok" && point.at <= input.end)
    .sort((a, b) => a.at.localeCompare(b.at));
  const prior = points.filter((point) => point.at <= input.start).at(-1);
  const first =
    prior && Date.parse(input.start) - Date.parse(prior.at) <= 300_000
      ? prior
      : points.find((point) => point.at >= input.start);
  const last =
    input.currentEndpoint?.state === "ok" && input.currentEndpoint.at <= input.end
      ? input.currentEndpoint
      : points.at(-1);
  const endMissing = !!last && last.at < input.end;
  let unrealizedChange: string | null = null;
  if (!first || !last || last.at < input.start) reasons.push("UNREALIZED_HISTORY_MISSING");
  else {
    unrealizedChange = subtractDecimal(last.unrealized, first.unrealized);
    if (first.at > input.start) reasons.push(`UNREALIZED_HISTORY_STARTS_AT:${first.at}`);
    if (first.at < input.start) reasons.push(`UNREALIZED_BOUNDARY_AT:${first.at}`);
    if (endMissing) reasons.push(`UNREALIZED_HISTORY_ENDS_AT:${last.at}`);
  }
  const total =
    realized.realized !== null && unrealizedChange !== null && !input.reasons?.length && !endMissing
      ? addDecimal(realized.realized, unrealizedChange)
      : null;
  return {
    state: total === null ? "unavailable" : reasons.length ? "partial" : "ok",
    reasons: [...new Set(reasons)],
    total,
    realized: input.reasons?.length ? null : realized.realized,
    unrealizedChange,
    openFees: realized.openFees,
    closeFees: realized.closeFees,
    tradingFees: realized.tradingFees,
    coverageStart: first?.at ?? null,
    coverageEnd: last?.at ?? null,
    start: input.start,
    end: input.end,
    method: "operational_legs_plus_unrealized_delta:usdt",
    currency: "USDT",
  };
}
