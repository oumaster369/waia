const DATASETS = new Set([
  "closed_trades",
  "fills",
  "orders",
  "invoices",
  "payments",
  "diagnostics",
]);
const DIMENSIONS = new Set([
  "organization",
  "account",
  "strategy",
  "version",
  "mode",
  "symbol",
  "day",
  "week",
  "month",
  "status",
  "source",
  "service",
]);
const MEASURES = new Set([
  "count",
  "sum_realized_pnl",
  "sum_fee",
  "sum_amount",
  "avg",
  "min",
  "max",
]);

export type AggregateRequest = {
  dataset: string;
  dimension: string;
  measure: string;
  limit: number;
};

export function parseAggregate(
  input: AggregateRequest,
):
  | { ok: true; request: AggregateRequest }
  | { ok: false; reason: "UNKNOWN_DATASET" | "UNKNOWN_DIMENSION" | "UNKNOWN_MEASURE" | "LIMIT" } {
  if (!DATASETS.has(input.dataset)) return { ok: false, reason: "UNKNOWN_DATASET" };
  if (!DIMENSIONS.has(input.dimension)) return { ok: false, reason: "UNKNOWN_DIMENSION" };
  if (!MEASURES.has(input.measure)) return { ok: false, reason: "UNKNOWN_MEASURE" };
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    return { ok: false, reason: "LIMIT" };
  }
  return {
    ok: true,
    request: {
      dataset: input.dataset,
      dimension: input.dimension,
      measure: input.measure,
      limit: input.limit,
    },
  };
}
