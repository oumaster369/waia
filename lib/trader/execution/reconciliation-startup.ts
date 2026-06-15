import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { processReconciliationEscalation } from "@/lib/trader/execution/reconciliation-escalation";
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
  const reconciliation = await deps.reconciliationService.reconcile(context, {
    kind: "open",
    executionMode,
  });

  const escalation = await processReconciliationEscalation(
    context,
    reconciliation,
    deps.triggerPort,
  );

  return {
    organizationId: context.organizationId,
    executionMode,
    runStartedAt: reconciliation.runStartedAt,
    reconciliation,
    escalation,
  };
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
  return createStartupReconciliationRunnerFromDeps({
    reconciliationService: overrides.reconciliationService ?? createSqliteReconciliationService(db),
    triggerPort: overrides.triggerPort ?? createSqliteAutomaticTriggerDispatcher(db),
  });
}

export function createPostgresStartupReconciliationRunner(
  db: WaiaPostgresDb,
  overrides: Partial<StartupReconciliationDeps> = {},
): StartupReconciliationRunner {
  return createStartupReconciliationRunnerFromDeps({
    reconciliationService:
      overrides.reconciliationService ?? createPostgresReconciliationService(db),
    triggerPort: overrides.triggerPort ?? createPostgresAutomaticTriggerDispatcher(db),
  });
}

export function createPostgresStartupReconciliationRunnerFromExecutor(
  ex: PgStartupReconciliationExecutor,
  overrides: Partial<StartupReconciliationDeps> = {},
): StartupReconciliationRunner {
  return createStartupReconciliationRunnerFromDeps({
    reconciliationService:
      overrides.reconciliationService ?? createPostgresReconciliationServiceFromExecutor(ex),
    triggerPort: overrides.triggerPort ?? createPostgresAutomaticTriggerDispatcher(ex),
  });
}
