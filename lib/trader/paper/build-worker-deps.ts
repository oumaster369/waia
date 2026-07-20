import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createPerRequestPostgresRuntime } from "@/db/postgres-client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createPostgresOrderExecutionService,
  createPostgresOrderRepository,
  createPostgresReconciliationService,
  createPostgresStartupReconciliationRunner,
} from "@/lib/trader/execution";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import type {
  PaperLoopCycleDeps,
  PaperLoopWorkerConfig,
} from "@/lib/trader/paper/paper-loop-worker.types";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createPostgresRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import type { TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { bridgeTraderCronEnvToProcess, mergeCronEnv } from "@/lib/trader/cron/worker-cron-env";

function parseEnabled(raw: unknown): boolean {
  if (typeof raw !== "string") {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function loadPaperLoopConfig(env: Record<string, unknown>): PaperLoopWorkerConfig {
  const organizationId =
    typeof env.PAPER_LOOP_ORGANIZATION_ID === "string" ? env.PAPER_LOOP_ORGANIZATION_ID.trim() : "";
  const accountKey =
    typeof env.PAPER_LOOP_ACCOUNT_KEY === "string" ? env.PAPER_LOOP_ACCOUNT_KEY.trim() : "";
  const defaultQuantity =
    typeof env.PAPER_LOOP_DEFAULT_QUANTITY === "string" &&
    env.PAPER_LOOP_DEFAULT_QUANTITY.trim() !== ""
      ? env.PAPER_LOOP_DEFAULT_QUANTITY.trim()
      : "0.01";
  const cycleIdPrefix =
    typeof env.PAPER_LOOP_CYCLE_ID_PREFIX === "string" &&
    env.PAPER_LOOP_CYCLE_ID_PREFIX.trim() !== ""
      ? env.PAPER_LOOP_CYCLE_ID_PREFIX.trim()
      : "paper-loop-worker";
  const startingBalanceUsdt =
    typeof env.PAPER_LOOP_STARTING_BALANCE_USDT === "string" &&
    env.PAPER_LOOP_STARTING_BALANCE_USDT.trim() !== ""
      ? env.PAPER_LOOP_STARTING_BALANCE_USDT.trim()
      : DEFAULT_PORTFOLIO_RUN_CONFIG.startingBalanceUsdt;
  const defaultStopDistancePct =
    typeof env.PAPER_LOOP_DEFAULT_STOP_DISTANCE_PCT === "string" &&
    env.PAPER_LOOP_DEFAULT_STOP_DISTANCE_PCT.trim() !== ""
      ? env.PAPER_LOOP_DEFAULT_STOP_DISTANCE_PCT.trim()
      : DEFAULT_PORTFOLIO_RUN_CONFIG.defaultStopDistancePct;

  return {
    enabled:
      parseEnabled(env.PAPER_LOOP_ENABLED) && organizationId.length > 0 && accountKey.length > 0,
    organizationId,
    accountKey,
    defaultQuantity,
    startingBalanceUsdt,
    defaultStopDistancePct,
    cycleIdPrefix,
    htxRestHost:
      typeof env.HTX_REST_HOST === "string" && env.HTX_REST_HOST.trim() !== ""
        ? env.HTX_REST_HOST.trim()
        : undefined,
  };
}

function createStdoutPaperLoopLogger(): PaperLoopCycleDeps["logger"] {
  return {
    log(payload) {
      console.info(JSON.stringify(payload));
    },
  };
}

/** Build paper-loop dependencies for Cron / scheduled handlers (Pipeline P5 / NEW-8). */
export async function buildPaperLoopDepsFromEnv(
  explicitEnv?: Record<string, unknown>,
): Promise<{ deps: PaperLoopCycleDeps; dispose: () => Promise<void> }> {
  const env = mergeCronEnv(explicitEnv);
  bridgeTraderCronEnvToProcess(env);
  const config = loadPaperLoopConfig(env);
  const postgresUrl =
    typeof env.DATABASE_URL_POSTGRES === "string" ? env.DATABASE_URL_POSTGRES.trim() : "";
  if (postgresUrl) {
    process.env.DATABASE_URL_POSTGRES = postgresUrl;
  }
  const runtime = createPerRequestPostgresRuntime();
  const db = runtime.db;
  const orderRepository = createPostgresOrderRepository(db);
  const writeAudit = (input: TraderAuditInput) => writeTraderAuditLogPostgres(db, input);
  const connector = new MockExchangeConnector();
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

  const limits = createPostgresRiskLimitsService(db);
  if (config.organizationId) {
    await limits.upsertLimitsForOrg(requireOrgContext(config.organizationId), {
      ...DEFAULT_ORG_RISK_LIMITS,
    });
  }

  const execution = createPostgresOrderExecutionService(db, {
    connectorForMode: () => connector,
    writeAudit,
  });
  const reconciliation = createPostgresReconciliationService(db, {
    connectorForMode: () => connector,
    writeAudit,
  });
  const startupReconciliation = createPostgresStartupReconciliationRunner(db, {
    reconciliationService: reconciliation,
  });

  const poll = new HtxBarPollSource({
    cycleIdPrefix: config.cycleIdPrefix,
    restHost: config.htxRestHost,
  });

  const deps: PaperLoopCycleDeps = {
    config,
    paperCycleDeps: {
      execution,
      reconciliation,
    },
    orderRepository,
    poll,
    startupReconciliation,
    logger: createStdoutPaperLoopLogger(),
  };

  return {
    deps,
    dispose: async () => {
      if (runtime._sql) {
        await runtime._sql.end({ timeout: 5 });
      }
    },
  };
}

export { runPaperLoopCycle } from "@/lib/trader/paper/run-paper-loop-cycle";
