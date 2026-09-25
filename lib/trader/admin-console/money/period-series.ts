import { addDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import {
  operationalRealizedPnl,
  type OperationalLeg,
} from "@/lib/trader/admin-console/money/operational-pnl";
import type { EquityEvidencePoint } from "@/lib/trader/admin-console/money/period-result";

export type PeriodSeriesPoint = {
  at: string;
  bucket: string;
  equity: string;
  pnl: string | null;
  drawdown: string | null;
  reasons: string[];
};
/** Linear scan over saved evidence. Deposits in equity never become trading profit. */
export function periodSeries(input: {
  points: readonly EquityEvidencePoint[];
  legs: readonly OperationalLeg[];
  start: string;
  end: string;
  reasons: readonly string[];
}): PeriodSeriesPoint[] {
  const points = [...input.points]
    .filter((p) => p.state === "ok" && p.at <= input.end)
    .sort((a, b) => a.at.localeCompare(b.at));
  const prior = points.filter((p) => p.at <= input.start).at(-1);
  const first =
    prior && Date.parse(input.start) - Date.parse(prior.at) <= 300000
      ? prior
      : points.find((p) => p.at >= input.start);
  if (!first) return [];
  const legs = [...input.legs]
    .filter((l) => l.executedAt >= input.start && l.executedAt < input.end)
    .sort((a, b) => a.executedAt.localeCompare(b.executedAt));
  let legIndex = 0,
    realized = "0",
    peak = "0";
  const reasons = [...input.reasons];
  if (first.at !== input.start) reasons.push(`UNREALIZED_BOUNDARY_AT:${first.at}`);
  let valid = input.reasons.length === 0;
  return points
    .filter((p) => p.at >= input.start)
    .map((point) => {
      const from = legIndex;
      while (legs[legIndex] && legs[legIndex]!.executedAt < point.at) legIndex++;
      const delta = operationalRealizedPnl(legs.slice(from, legIndex), input.start, point.at);
      if (delta.realized === null) {
        valid = false;
        reasons.push(...delta.reasons);
      } else realized = addDecimal(realized, delta.realized);
      const pnl = valid
        ? addDecimal(realized, subtractDecimal(point.unrealized, first.unrealized))
        : null;
      if (pnl !== null && compareDecimal(pnl, peak) > 0) peak = pnl;
      return {
        at: point.at,
        bucket: point.bucket ?? point.at,
        equity: point.equity,
        pnl,
        drawdown: pnl === null ? null : subtractDecimal(pnl, peak),
        reasons: [...new Set(reasons)],
      };
    });
}

export type OverviewSeriesPoint = {
  at: string;
  equity: string | null;
  pnl: string | null;
  drawdown: string | null;
  included: number;
  total: number;
};
/** No carry-forward across absent accounts; drawdown requires unchanged complete coverage. */
export function aggregatePeriodSeries(
  accounts: readonly { series: PeriodSeriesPoint[] }[],
  grain: "minute" | "hour" | "day",
): OverviewSeriesPoint[] {
  const interval = grain === "minute" ? 60000 : grain === "hour" ? 3600000 : 86400000;
  const buckets = new Map<number, Map<number, PeriodSeriesPoint>>();
  accounts.forEach((account, index) =>
    account.series.forEach((point) => {
      const bucket = Math.floor(Date.parse(point.bucket) / interval) * interval;
      const values = buckets.get(bucket) ?? new Map<number, PeriodSeriesPoint>();
      const previous = values.get(index);
      if (!previous || point.at > previous.at) values.set(index, point);
      buckets.set(bucket, values);
    }),
  );
  let peak = "0";
  let completeHistory = true;
  return [...buckets]
    .sort(([a], [b]) => a - b)
    .map(([bucket, accountPoints]) => {
      const values = [...accountPoints.values()];
      const complete = values.length === accounts.length && values.every((p) => p.pnl !== null);
      if (!complete) completeHistory = false;
      const pnl = complete ? values.reduce((sum, p) => addDecimal(sum, p.pnl!), "0") : null;
      if (pnl !== null && compareDecimal(pnl, peak) > 0) peak = pnl;
      return {
        at: new Date(bucket).toISOString(),
        equity: values.reduce((sum, p) => addDecimal(sum, p.equity), "0"),
        pnl,
        drawdown: pnl === null || !completeHistory ? null : subtractDecimal(pnl, peak),
        included: values.length,
        total: accounts.length,
      };
    });
}
