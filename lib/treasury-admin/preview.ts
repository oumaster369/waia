import type { BreathAdminPreviewDto } from "@/lib/treasury-admin/types";

/** Pass-through mapping. Do not recompute financial totals. */
export function publicPreviewFields(preview: BreathAdminPreviewDto): {
  status: BreathAdminPreviewDto["status"];
  lastUpdatedAt: string | null;
  stageLabel: string | null;
  work: string | null;
  methodologyNote: string | null;
  idealAnnualBudget: BreathAdminPreviewDto["idealAnnualBudget"];
  resources: BreathAdminPreviewDto["resources"];
  currentFreeFunds: string | null;
  budget: BreathAdminPreviewDto["budget"];
  runway: BreathAdminPreviewDto["runway"];
  recentActivity: BreathAdminPreviewDto["recentActivity"];
} {
  return {
    status: preview.status,
    lastUpdatedAt: preview.lastUpdatedAt,
    stageLabel: preview.stageLabel,
    work: preview.work,
    methodologyNote: preview.methodologyNote,
    idealAnnualBudget: preview.idealAnnualBudget,
    resources: preview.resources,
    currentFreeFunds: preview.currentFreeFunds,
    budget: preview.budget,
    runway: preview.runway,
    recentActivity: preview.recentActivity,
  };
}

export function operatorPreviewDiagnostics(preview: BreathAdminPreviewDto): {
  pendingReasons: string[];
  componentStatus: BreathAdminPreviewDto["componentStatus"];
  reconciliationGate: BreathAdminPreviewDto["reconciliationGate"];
  runwayStatus: BreathAdminPreviewDto["runwayStatus"];
} {
  return {
    pendingReasons: preview.pendingReasons,
    componentStatus: preview.componentStatus,
    reconciliationGate: preview.reconciliationGate,
    runwayStatus: preview.runwayStatus,
  };
}
