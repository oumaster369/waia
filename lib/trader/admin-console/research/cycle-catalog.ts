export const CYCLE_GROUPS = [
  { id: "data", title: "Data", stages: [1, 2, 3, 4, 21] },
  { id: "understanding", title: "Understanding", stages: [5, 6, 10] },
  { id: "forecast", title: "Forecast", stages: [11, 12] },
  { id: "decision", title: "Decision and risk", stages: [0, 13, 14, 18] },
  { id: "execution", title: "Execution and fact", stages: [15, 16, 17, 19, 20] },
  { id: "learning", title: "Learning", stages: [7, 8, 9, 22] },
] as const;
export const CYCLE_STAGE_TITLES = [
  "Rules and authority",
  "Sources",
  "Observation at decision time",
  "Measurements",
  "Information sufficiency",
  "Market understanding",
  "Causal reconstruction",
  "Correctness checks",
  "Patterns",
  "Knowledge lifecycle",
  "Competing hypotheses",
  "Forecast admission",
  "Forecast",
  "Decision",
  "Risk",
  "Execution",
  "Confirmed fact",
  "Guardian",
  "Runtime Authority",
  "Closed trades and billing",
  "Recurring runtime",
  "Information contract",
  "Admission and activation",
] as const;

export type CycleStageStatus =
  | "completed"
  | "running"
  | "waiting"
  | "skipped"
  | "insufficient"
  | "unavailable"
  | "error";

export function cycleStageIds(): number[] {
  return CYCLE_GROUPS.flatMap((group) => [...group.stages]).sort((left, right) => left - right);
}

export function presentCycleStage(stageId: number): {
  stageId: number;
  status: CycleStageStatus;
  reason: "NOT_PERSISTED_FOR_CYCLE";
} {
  return { stageId, status: "unavailable", reason: "NOT_PERSISTED_FOR_CYCLE" };
}
