import type { AdminMode } from "@/lib/trader/admin-console/contracts";

export function orderMode(row: {
  historicalRunId: string | null;
  executionMode: string;
}): AdminMode {
  if (row.historicalRunId) return "history";
  if (row.executionMode === "live" || row.executionMode === "paper") return row.executionMode;
  return "undetermined";
}
