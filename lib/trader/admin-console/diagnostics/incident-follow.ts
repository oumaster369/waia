import type { IncidentStatus } from "@/lib/trader/admin-console/diagnostics/incident-transition";

export function incidentAfterDiagnostic(
  existing: { status: string; occurrences: number; stateVersion: number } | null,
): {
  status: IncidentStatus;
  occurrences: number;
  stateVersion: number;
  history: { from: string | null; to: IncidentStatus } | null;
} {
  if (!existing) {
    return { status: "new", occurrences: 1, stateVersion: 1, history: { from: null, to: "new" } };
  }
  if (existing.status === "resolved") {
    return {
      status: "regressed",
      occurrences: existing.occurrences + 1,
      stateVersion: existing.stateVersion + 1,
      history: { from: "resolved", to: "regressed" },
    };
  }
  return {
    status: existing.status as IncidentStatus,
    occurrences: existing.occurrences + 1,
    stateVersion: existing.stateVersion + 1,
    history: null,
  };
}
