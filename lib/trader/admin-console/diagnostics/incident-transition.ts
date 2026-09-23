export const INCIDENT_STATUSES = [
  "new",
  "investigating",
  "fix_prepared",
  "deployed_verifying",
  "resolved",
  "regressed",
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

const FORWARD: Record<IncidentStatus, IncidentStatus | null> = {
  new: "investigating",
  investigating: "fix_prepared",
  fix_prepared: "deployed_verifying",
  deployed_verifying: "resolved",
  resolved: null,
  regressed: "investigating",
};

export function nextIncidentStatus(
  current: IncidentStatus,
  requested: IncidentStatus,
): { ok: true; status: IncidentStatus } | { ok: false; reason: "ILLEGAL_TRANSITION" } {
  if (current === "resolved" && requested === "regressed") {
    return { ok: true, status: "regressed" };
  }
  if (FORWARD[current] !== requested) return { ok: false, reason: "ILLEGAL_TRANSITION" };
  return { ok: true, status: requested };
}
