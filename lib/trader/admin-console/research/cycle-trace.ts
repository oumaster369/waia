import {
  cycleStageIds,
  type CycleStageStatus,
} from "@/lib/trader/admin-console/research/cycle-catalog";

export type CycleTraceLink = {
  hypothesisId: string | null;
  forecastId: string | null;
  decisionId: string | null;
  riskVerdictId: string | null;
  executionPlanId: string | null;
  orderId: string | null;
  fillId: string | null;
};

export type CycleTraceStage = {
  stageId: number;
  status: Extract<CycleStageStatus, "completed" | "unavailable">;
  reason: "NOT_PERSISTED_FOR_CYCLE" | null;
  sourceId: string | null;
};

function linkedSource(stageId: number, link: CycleTraceLink): string | null {
  if (stageId === 10) return link.hypothesisId;
  if (stageId === 11 || stageId === 12) return link.forecastId;
  if (stageId === 13) return link.decisionId;
  if (stageId === 14 && link.decisionId) return link.riskVerdictId;
  if (stageId === 15 && link.decisionId) return link.executionPlanId;
  if (stageId === 16 && link.executionPlanId) return link.orderId ?? link.fillId;
  return null;
}

export function assembleCycleTrace(link: CycleTraceLink): CycleTraceStage[] {
  return cycleStageIds().map((stageId) => {
    const sourceId = linkedSource(stageId, link);
    if (sourceId) {
      return { stageId, status: "completed", reason: null, sourceId };
    }
    return {
      stageId,
      status: "unavailable",
      reason: "NOT_PERSISTED_FOR_CYCLE",
      sourceId: null,
    };
  });
}
