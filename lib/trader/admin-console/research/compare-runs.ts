export type ResearchCompareRun = {
  id: string;
  dataset: string | null;
  period: string | null;
  costs: string | null;
  version: string | null;
  model: string | null;
  netPnl: string | null;
  forecastQuality: string | null;
};

const CONDITION_FIELDS = ["dataset", "period", "costs", "version", "model"] as const;

export function compareResearchRuns(runs: readonly ResearchCompareRun[]):
  | { ok: false; reason: "RUN_COUNT" }
  | {
      ok: true;
      differences: string[];
      sameConditions: boolean;
      unknownConditions: string[];
      profitability: { id: string; netPnl: string | null }[];
      forecastQuality: { id: string; forecastQuality: string | null }[];
    } {
  if (runs.length < 2 || runs.length > 4) return { ok: false, reason: "RUN_COUNT" };
  const differences = CONDITION_FIELDS.filter((field) => {
    const values = new Set(runs.map((run) => run[field]));
    return values.size > 1;
  });
  const unknownConditions = CONDITION_FIELDS.filter((field) =>
    runs.some((run) => run[field] === null),
  );
  return {
    ok: true,
    unknownConditions: [...unknownConditions],
    differences: [...differences],
    sameConditions: differences.length === 0 && unknownConditions.length === 0,
    profitability: runs.map((run) => ({ id: run.id, netPnl: run.netPnl })),
    forecastQuality: runs.map((run) => ({ id: run.id, forecastQuality: run.forecastQuality })),
  };
}
