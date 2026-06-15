import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  triggerSignalToSwitchPlan,
  type KillSwitchTriggerPort,
  type KillSwitchTriggerSignal,
} from "@/lib/trader/risk/kill-switch/automatic-trigger";
import type { KillSwitchType } from "@/lib/trader/risk/kill-switch/types";
import type {
  EscalationActivationOutcome,
  ReconciliationEscalationReport,
} from "@/lib/trader/execution/reconciliation-escalation.types";
import type {
  OrderReconciliationOutcome,
  ReconciliationClassification,
  ReconciliationReport,
} from "@/lib/trader/execution/reconciliation.types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

const BENIGN_CLASSIFICATIONS: ReadonlySet<ReconciliationClassification> = new Set([
  "IN_SYNC",
  "VENUE_ACKED",
  "FILL_PROGRESS",
  "VENUE_TERMINALIZED",
  "SKIPPED_CONFLICT",
]);

function organizationTarget(organizationId: string): KillSwitchTriggerSignal["target"] {
  return { scopeType: "organization", organizationId };
}

function dedupeKeyForSignal(signal: KillSwitchTriggerSignal): string {
  const plan = triggerSignalToSwitchPlan(signal);
  const scopeRef =
    signal.target.scopeType === "organization" ? signal.target.organizationId : "platform";
  return `${plan.switchType}:${scopeRef}`;
}

/**
 * Maps a single reconciliation outcome to zero or one kill-switch trigger signal.
 * Pure — no connector reads or status string interpretation (DEE-251 / AT-E8 S5).
 */
export function mapOutcomeToTriggerSignals(
  outcome: OrderReconciliationOutcome,
  organizationId: string,
): KillSwitchTriggerSignal[] {
  if (BENIGN_CLASSIFICATIONS.has(outcome.classification)) {
    return [];
  }

  const target = organizationTarget(organizationId);
  const detail = outcome.clientOrderId;

  switch (outcome.classification) {
    case "NOT_FOUND_AT_VENUE":
      return [{ category: "mismatch", target, detail }];
    case "UNKNOWN_POSITION":
      return [{ category: "anomaly", anomalyType: "UNKNOWN_POSITION", target, detail }];
    case "AMBIGUOUS_STALE":
      return [{ category: "anomaly", anomalyType: "STALE_STATE", target, detail }];
    case "TERMINAL_DRIFT":
      if (outcome.escalationKind === "phantom_open") {
        return [{ category: "anomaly", anomalyType: "UNKNOWN_POSITION", target, detail }];
      }
      return [{ category: "mismatch", target, detail }];
    default:
      return [];
  }
}

export function dedupeTriggerSignals(
  signals: KillSwitchTriggerSignal[],
): KillSwitchTriggerSignal[] {
  const seen = new Set<string>();
  const deduped: KillSwitchTriggerSignal[] = [];

  for (const signal of signals) {
    const key = dedupeKeyForSignal(signal);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(signal);
  }

  return deduped;
}

function collectSourceClassifications(
  outcomes: OrderReconciliationOutcome[],
  organizationId: string,
): Map<KillSwitchType, ReconciliationClassification[]> {
  const bySwitch = new Map<KillSwitchType, ReconciliationClassification[]>();

  for (const outcome of outcomes) {
    const signals = mapOutcomeToTriggerSignals(outcome, organizationId);
    for (const signal of signals) {
      const plan = triggerSignalToSwitchPlan(signal);
      const existing = bySwitch.get(plan.switchType) ?? [];
      if (!existing.includes(outcome.classification)) {
        existing.push(outcome.classification);
        bySwitch.set(plan.switchType, existing);
      }
    }
  }

  return bySwitch;
}

export async function processReconciliationEscalation(
  context: OrgContext,
  report: ReconciliationReport,
  triggerPort: KillSwitchTriggerPort,
): Promise<ReconciliationEscalationReport> {
  const scoped = requireOrgContext(context.organizationId);
  if (scoped.organizationId !== report.organizationId) {
    throw new Error(
      `Reconciliation escalation org mismatch: ${scoped.organizationId} vs ${report.organizationId}`,
    );
  }

  const allSignals = report.outcomes.flatMap((outcome) =>
    mapOutcomeToTriggerSignals(outcome, report.organizationId),
  );
  const signals = dedupeTriggerSignals(allSignals);
  const sourceBySwitch = collectSourceClassifications(report.outcomes, report.organizationId);

  const outcomes: EscalationActivationOutcome[] = [];

  for (const signal of signals) {
    const plan = triggerSignalToSwitchPlan(signal);
    const result = await triggerPort.activate(signal);
    outcomes.push({
      ...result,
      switchType: plan.switchType,
      sourceClassifications: sourceBySwitch.get(plan.switchType) ?? [],
    });
  }

  return {
    organizationId: report.organizationId,
    escalationsAttempted: signals.length,
    outcomes,
  };
}
