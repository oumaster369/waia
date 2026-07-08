import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { deleteMockExecutionArtifactsForOrgPostgres } from "@/lib/trader/execution/repository-postgres";
import {
  runResearchValidationBacktest,
  type RunResearchValidationBacktestInput,
} from "@/lib/trader/research/research-backtest-runner";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
} from "@/lib/trader/research/strategy-candidate.types";

type PgDeleteExecutor = Pick<WaiaPostgresDb, "delete">;

/**
 * Clears org mock execution artifacts then runs a research validation backtest window.
 *
 * Ensures each validation / walk-forward / blind window sees an isolated mock ledger
 * when backed by Postgres (RI-P7 / DEE-368), and — when the deterministic replay hook
 * is set (M9+ / DEE-397 / ADR-0021) — an isolated in-memory order-rate limiter, so
 * rate-limiting decisions cannot leak between windows.
 */
export async function runIsolatedResearchBacktest(
  ex: PgDeleteExecutor,
  input: RunResearchValidationBacktestInput,
): Promise<ResearchValidationMetrics> {
  await deleteMockExecutionArtifactsForOrgPostgres(ex, input.context);
  input.deps.researchReplayDeterminism?.resetWindowState();
  if (input.metricsSchemaVersion === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION) {
    return runResearchValidationBacktest({
      ...input,
      metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
    });
  }
  return runResearchValidationBacktest({
    ...input,
    metricsSchemaVersion:
      input.metricsSchemaVersion ?? RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
  });
}
