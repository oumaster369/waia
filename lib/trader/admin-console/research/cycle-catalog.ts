export const CYCLE_GROUPS = [
  { id: "data", title: "Данные", stages: [1, 2, 3, 4, 21] },
  { id: "understanding", title: "Понимание", stages: [5, 6, 10] },
  { id: "forecast", title: "Прогноз", stages: [11, 12] },
  { id: "decision", title: "Решение и риск", stages: [0, 13, 14, 18] },
  { id: "execution", title: "Исполнение и факт", stages: [15, 16, 17, 19, 20] },
  { id: "learning", title: "Обучение", stages: [7, 8, 9, 22] },
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
