import type { HistoricalObservableCycleV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-v2";

const numeric = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Display-only derivation. Never feeds decisions, accounting or risk authority. */
export function historicalChartRows(history: readonly Pick<HistoricalObservableCycleV2, "cycleSequence" | "replayBarClosedAtUtc" | "equity" | "netPnl">[]) {
  let peak: number | null = null;
  return [...history].sort((a, b) => a.cycleSequence - b.cycleSequence).map(cycle => {
    const equity = numeric(cycle.equity);
    if (equity !== null && equity > 0) peak = Math.max(peak ?? equity, equity);
    return { sequence: cycle.cycleSequence, at: cycle.replayBarClosedAtUtc,
      equity, pnl: numeric(cycle.netPnl),
      drawdown: equity !== null && peak !== null ? Math.max(0, (peak - equity) / peak * 100) : null };
  });
}

function HistoryChart({ title, rows, field, unit }: {
  title: string; rows: ReturnType<typeof historicalChartRows>;
  field: "equity" | "pnl" | "drawdown"; unit: string;
}) {
  const values = rows.map(row => row[field]).filter((v): v is number => v !== null);
  const min = values.length ? values.reduce((a, b) => Math.min(a, b)) : 0;
  const max = values.length ? values.reduce((a, b) => Math.max(a, b)) : 0;
  const first = rows[0]?.sequence ?? 0;
  const span = (rows.at(-1)?.sequence ?? first) - first;
  const path = rows.map((row, index) => {
    const value = row[field];
    if (value === null) return "";
    const previous = rows[index - 1];
    const command = previous && previous[field] !== null && previous.sequence + 1 === row.sequence ? "L" : "M";
    return `${command}${span ? 10 + (row.sequence - first) / span * 280 : 150},${max === min ? 60 : 110 - (value - min) / (max - min) * 100}`;
  }).join(" ");
  return <figure className="rounded border border-waia-rim p-3">
    <figcaption className="text-sm font-medium">{title}</figcaption>
    {values.length > 1 ? <svg role="img" aria-label={`${title} committed history`} viewBox="0 0 300 120" className="h-32 w-full text-waia-accent-cool">
      <title>{title}: {values.length} committed observations, {min} to {max} {unit}</title>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {rows.map(row => row[field] === null ? null : <circle key={row.sequence}
        cx={span ? 10 + (row.sequence-first)/span*280 : 150}
        cy={max === min ? 60 : 110-(row[field]!-min)/(max-min)*100}
        r="2" fill="currentColor"><title>Cycle {row.sequence}: {row[field]} {unit}</title></circle>)}
    </svg> : <p className="py-8 text-xs text-waia-fg-muted">{values.length ? "One committed observation; awaiting the next cycle." : "No committed chart data."}</p>}
    <p className="text-xs tabular-nums text-waia-fg-muted">{values.length ? `${min.toFixed(2)}…${max.toFixed(2)} ${unit}` : "—"}</p>
  </figure>;
}

export function HistoricalV2AccountCharts({ history }: { history: readonly HistoricalObservableCycleV2[] }) {
  const rows = historicalChartRows(history);
  return <div className="space-y-2">
    <div className="grid gap-3 md:grid-cols-3">
      <HistoryChart title="Equity" rows={rows} field="equity" unit="USDT" />
      <HistoryChart title="Net P&L" rows={rows} field="pnl" unit="USDT" />
      <HistoryChart title="Observed-history drawdown" rows={rows} field="drawdown" unit="%" />
    </div>
    <p className="text-xs text-waia-fg-muted">Committed replay history: {rows[0]?.at ?? "—"} → {rows.at(-1)?.at ?? "—"}. Drawdown is derived from the highest positive equity observed in this history, not a Risk/Guardian verdict. Missing values are not interpolated.</p>
  </div>;
}
