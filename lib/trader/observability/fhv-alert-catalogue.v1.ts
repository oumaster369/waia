import type { FhvAlertPolicyV1 } from "@/lib/trader/observability/fhv-alert-policy-v1";

export type FhvAlertCatalogueEntry = Readonly<{
  id: string;
  condition: string;
  severity: "WARNING" | "CRITICAL";
  detector: "Observer" | "Campaign";
  dedupeSec: number | null;
}>;

export const FHV_ALERT_CATALOGUE_V1: readonly FhvAlertCatalogueEntry[] = [
  {
    id: "FHV-ALERT-001",
    condition: "heartbeatAge > critical",
    severity: "CRITICAL",
    detector: "Observer",
    dedupeSec: 300,
  },
  {
    id: "FHV-ALERT-002",
    condition: "progress stalled > critical",
    severity: "CRITICAL",
    detector: "Observer",
    dedupeSec: 900,
  },
  {
    id: "FHV-ALERT-003",
    condition: "process crash",
    severity: "CRITICAL",
    detector: "Observer",
    dedupeSec: 60,
  },
  {
    id: "FHV-ALERT-004",
    condition: "process restart",
    severity: "WARNING",
    detector: "Observer",
    dedupeSec: 300,
  },
  {
    id: "FHV-ALERT-005",
    condition: "checkpoint overdue",
    severity: "WARNING",
    detector: "Observer",
    dedupeSec: 600,
  },
  {
    id: "FHV-ALERT-006",
    condition: "disk soft threshold",
    severity: "WARNING",
    detector: "Observer",
    dedupeSec: 1800,
  },
  {
    id: "FHV-ALERT-007",
    condition: "disk hard threshold",
    severity: "CRITICAL",
    detector: "Observer",
    dedupeSec: 300,
  },
  {
    id: "FHV-ALERT-008",
    condition: "artifact growth anomaly",
    severity: "WARNING",
    detector: "Observer",
    dedupeSec: 1800,
  },
  {
    id: "FHV-ALERT-009",
    condition: "postgres unavailable",
    severity: "CRITICAL",
    detector: "Observer",
    dedupeSec: 300,
  },
  {
    id: "FHV-ALERT-010",
    condition: "dataset digest mismatch",
    severity: "CRITICAL",
    detector: "Campaign",
    dedupeSec: null,
  },
  {
    id: "FHV-ALERT-011",
    condition: "data gap",
    severity: "CRITICAL",
    detector: "Campaign",
    dedupeSec: null,
  },
  {
    id: "FHV-ALERT-012",
    condition: "no-lookahead violation",
    severity: "CRITICAL",
    detector: "Campaign",
    dedupeSec: null,
  },
  {
    id: "FHV-ALERT-013",
    condition: "duplicate order",
    severity: "CRITICAL",
    detector: "Campaign",
    dedupeSec: null,
  },
  {
    id: "FHV-ALERT-014",
    condition: "reconciliation mismatch",
    severity: "CRITICAL",
    detector: "Campaign",
    dedupeSec: null,
  },
  {
    id: "FHV-ALERT-015",
    condition: "accounting frontier mismatch",
    severity: "CRITICAL",
    detector: "Campaign",
    dedupeSec: null,
  },
  {
    id: "FHV-ALERT-016",
    condition: "drawdown threshold",
    severity: "WARNING",
    detector: "Campaign",
    dedupeSec: 900,
  },
  {
    id: "FHV-ALERT-017",
    condition: "evidence write failure",
    severity: "CRITICAL",
    detector: "Campaign",
    dedupeSec: null,
  },
  {
    id: "FHV-ALERT-018",
    condition: "artifact sealing failure",
    severity: "CRITICAL",
    detector: "Campaign",
    dedupeSec: null,
  },
  {
    id: "FHV-ALERT-019",
    condition: "persistent zero-decision",
    severity: "WARNING",
    detector: "Observer",
    dedupeSec: 3600,
  },
  {
    id: "FHV-ALERT-020",
    condition: "persistent veto-only",
    severity: "WARNING",
    detector: "Observer",
    dedupeSec: 3600,
  },
  {
    id: "FHV-ALERT-021",
    condition: "unexpected live path",
    severity: "CRITICAL",
    detector: "Campaign",
    dedupeSec: null,
  },
  {
    id: "FHV-ALERT-022",
    condition: "unauthorized promotion",
    severity: "CRITICAL",
    detector: "Campaign",
    dedupeSec: null,
  },
] as const;

export type FhvAlertEvaluationInput = Readonly<{
  policy: FhvAlertPolicyV1;
  heartbeatAgeSec: number;
  stallSec: number;
  checkpointAgeSec: number | null;
  diskSoftBreached: boolean;
  diskHardBreached: boolean;
  postgresDownSec: number;
  processRestartCount: number;
}>;

export function evaluateFhvObserverAlerts(input: FhvAlertEvaluationInput): readonly string[] {
  const fired: string[] = [];
  if (input.heartbeatAgeSec >= input.policy.heartbeatCriticalAgeSec) fired.push("FHV-ALERT-001");
  if (input.stallSec >= input.policy.progressStallCriticalSec) fired.push("FHV-ALERT-002");
  if (input.diskSoftBreached) fired.push("FHV-ALERT-006");
  if (input.diskHardBreached) fired.push("FHV-ALERT-007");
  if (input.postgresDownSec > input.policy.postgresFailureGraceSec) fired.push("FHV-ALERT-009");
  if (
    input.checkpointAgeSec !== null &&
    input.checkpointAgeSec > input.policy.checkpointMaxAgeSec
  ) {
    fired.push("FHV-ALERT-005");
  }
  if (input.processRestartCount > 0) fired.push("FHV-ALERT-004");
  return fired;
}

export function dedupeFhvAlerts(
  alertIds: readonly string[],
  lastFiredAtById: Map<string, number>,
  nowMs: number,
): readonly string[] {
  const out: string[] = [];
  for (const id of alertIds) {
    const entry = FHV_ALERT_CATALOGUE_V1.find((e) => e.id === id);
    const dedupeMs = (entry?.dedupeSec ?? 0) * 1000;
    const last = lastFiredAtById.get(id) ?? 0;
    if (nowMs - last >= dedupeMs) {
      out.push(id);
      lastFiredAtById.set(id, nowMs);
    }
  }
  return out;
}
