import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { processReconciliationEscalation } from "@/lib/trader/execution/reconciliation-escalation";
import { emitReconciliationStartupComplete } from "@/lib/trader/execution/reconciliation-telemetry";
import {
  createPostgresReconciliationService,
  createPostgresReconciliationServiceFromExecutor,
  createSqliteReconciliationService,
} from "@/lib/trader/execution/reconciliation-service";
import type {
  StartupReconciliationDeps,
  StartupReconciliationResult,
  StartupReconciliationRunner,
  StartupExecutionMode,
} from "@/lib/trader/execution/reconciliation-startup.types";
import {
  createPostgresAutomaticTriggerDispatcher,
  createSqliteAutomaticTriggerDispatcher,
} from "@/lib/trader/risk/kill-switch/automatic-trigger";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

/**
 * Runs open-scan reconciliation then kill-switch escalation in strict order.
 * Repeated calls are safe via S4 convergence idempotency and S5 `already_active`.
 * Partial escalation failure may leave some switches tripped (fail-closed).
 */
export async function runStartupReconciliation(
  context: OrgContext,
  executionMode: StartupExecutionMode,
  deps: StartupReconciliationDeps,
): Promise<StartupReconciliationResult> {
  const nowMs = deps.nowMs ?? Date.now;
  const drillStartedMs = nowMs();

  const reconciliation = await deps.reconciliationService.reconcile(context, {
    kind: "open",
    executionMode,
  });

  const escalation = await processReconciliationEscalation(
    context,
    reconciliation,
    deps.triggerPort,
  );

  const result: StartupReconciliationResult = {
    organizationId: context.organizationId,
    executionMode,
    runStartedAt: reconciliation.runStartedAt,
    reconciliation,
    escalation,
  };

  emitReconciliationStartupComplete(
    {
      organizationId: context.organizationId,
      executionMode,
      counts: reconciliation.counts,
      durationMs: Math.max(0, nowMs() - drillStartedMs),
      escalationsAttempted: escalation.escalationsAttempted,
    },
    deps.reconciliationTelemetrySink,
  );

  return result;
}

export function createStartupReconciliationRunnerFromDeps(
  deps: StartupReconciliationDeps,
): StartupReconciliationRunner {
  return {
    runStartupReconciliation: (context, executionMode) =>
      runStartupReconciliation(context, executionMode, deps),
  };
}

type PgStartupReconciliationExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export function createSqliteStartupReconciliationRunner(
  db: WaiaDb,
  overrides: Partial<StartupReconciliationDeps> = {},
): StartupReconciliationRunner {
  const sink = overrides.reconciliationTelemetrySink;
  return createStartupReconciliationRunnerFromDeps({
    reconciliationService:
      overrides.reconciliationService ??
      createSqliteReconciliationService(db, { reconciliationTelemetrySink: sink }),
    triggerPort: overrides.triggerPort ?? createSqliteAutomaticTriggerDispatcher(db),
    reconciliationTelemetrySink: sink,
    nowMs: overrides.nowMs,
  });
}

export function createPostgresStartupReconciliationRunner(
  db: WaiaPostgresDb,
  overrides: Partial<StartupReconciliationDeps> = {},
): StartupReconciliationRunner {
  const sink = overrides.reconciliationTelemetrySink;
  return createStartupReconciliationRunnerFromDeps({
    reconciliationService:
      overrides.reconciliationService ??
      createPostgresReconciliationService(db, { reconciliationTelemetrySink: sink }),
    triggerPort: overrides.triggerPort ?? createPostgresAutomaticTriggerDispatcher(db),
    reconciliationTelemetrySink: sink,
    nowMs: overrides.nowMs,
  });
}

export function createPostgresStartupReconciliationRunnerFromExecutor(
  ex: PgStartupReconciliationExecutor,
  overrides: Partial<StartupReconciliationDeps> = {},
): StartupReconciliationRunner {
  const sink = overrides.reconciliationTelemetrySink;
  return createStartupReconciliationRunnerFromDeps({
    reconciliationService:
      overrides.reconciliationService ??
      createPostgresReconciliationServiceFromExecutor(ex, { reconciliationTelemetrySink: sink }),
    triggerPort: overrides.triggerPort ?? createPostgresAutomaticTriggerDispatcher(ex),
    reconciliationTelemetrySink: sink,
    nowMs: overrides.nowMs,
  });
}
