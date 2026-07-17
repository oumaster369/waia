/**
 * HTR-WP22 / shared Macro-J Postgres fixture prelude.
 */

import postgres from "postgres";
import { eq } from "drizzle-orm";

import { bindHistoricalExecutionModelToSession } from "@/lib/trader/backtest/historical-execution-profile";
import type { HistoricalExecutionProfileV1 } from "@/lib/trader/backtest/historical-execution-profile";
import { getPostgresDrizzle } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createPostgresOrderRepository,
  createPostgresReconciliationService,
} from "@/lib/trader/execution";
import type { HistoricalExecutionRuntime } from "@/lib/trader/execution/execution-service.types";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { createManualReplayClock } from "@/lib/trader/research/deterministic-replay-clock";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import type { ResearchPortfolioConfig } from "@/lib/trader/research/research-portfolio-config";
import { buildResearchV2PortfolioContext } from "@/lib/trader/research/research-portfolio-config";
import type { ResearchPipelineBacktestOptions } from "@/lib/trader/research/research-pipeline-config.types";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import {
  createDeterministicReplayIdFactory,
  RESEARCH_REPLAY_CLOCK_START_MS,
  RESEARCH_REPLAY_ID_NAMESPACE,
} from "@/lib/trader/research/deterministic-replay-id-factory";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createPostgresKillSwitchRepository,
  createPostgresRiskEngineService,
  createPostgresRiskLimitsService,
} from "@/lib/trader/risk";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export const HTR_PG_USER_A = "00000000-0000-4000-8022-0000000000a1";
export const HTR_PG_USER_B = "00000000-0000-4000-8022-0000000000b2";

export function buildHtrGap044PipelineBacktestOptions(): Pick<
  ResearchPipelineBacktestOptions,
  "metricsSchemaVersion" | "portfolioConfig" | "validationArtifactSink"
> {
  return {
    metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
    portfolioConfig: {} satisfies ResearchPortfolioConfig,
    validationArtifactSink: {},
  };
}

/** Resolved v2 portfolio context for direct backtest-runner calls in GAP-044 diagnostics. */
export function buildHtrGap044PortfolioCycleContext() {
  const costModel = createCostModelV1("10", "5");
  return buildResearchV2PortfolioContext(costModel);
}

export async function deleteHtrPostgresAuditLogsForOrg(url: string, orgId: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_block_delete`);
    await sql.unsafe(
      `DELETE FROM audit_logs WHERE organization_id = $1 OR entity_id IN (
        SELECT id::text FROM trader_strategy_promotion_records WHERE organization_id = $1
      )`,
      [orgId],
    );
    await sql.unsafe(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_block_delete`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export type HtrPostgresResearchSession = {
  deps: PaperCycleDeps;
  historicalExecutionProfile: HistoricalExecutionProfileV1;
};

/**
 * Postgres research pipeline deps aligned with the in-memory M9 replay substrate:
 * deterministic clock, isolated rate store, and WP17 historical execution binding.
 */
export async function buildHtrPostgresResearchSession(
  db: ReturnType<typeof getPostgresDrizzle>,
  orgId: string,
  options?: { replayNamespaceSeed?: number },
): Promise<HtrPostgresResearchSession> {
  const context = requireOrgContext(orgId);
  const writeAudit = (input: Parameters<typeof writeTraderAuditLogPostgres>[1]) =>
    writeTraderAuditLogPostgres(db, input);
  const replayClock = createManualReplayClock(RESEARCH_REPLAY_CLOCK_START_MS);
  const nowMs = () => replayClock.nowMs();
  const namespaceSeed = options?.replayNamespaceSeed ?? RESEARCH_REPLAY_ID_NAMESPACE.session;
  const sessionNewId = createDeterministicReplayIdFactory(namespaceSeed);
  const newDecisionId = createDeterministicReplayIdFactory(RESEARCH_REPLAY_ID_NAMESPACE.decision);
  const rateStore = createInMemoryOrderRateStore();
  const connector = new MockExchangeConnector({ nowMs });
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

  const limits = createPostgresRiskLimitsService(db);
  await limits.upsertLimitsForOrg(context, {
    ...DEFAULT_ORG_RISK_LIMITS,
    maxOrdersPerWindow: 500,
  });

  const killSwitchResolver = createKillSwitchResolver({
    repository: createPostgresKillSwitchRepository(db),
    nowMs,
  });
  const orderRepository = createPostgresOrderRepository(db);
  const riskEngine = createPostgresRiskEngineService(db, {
    limitsService: limits,
    killSwitchResolver,
    rateStore,
    writeAudit,
    nowMs,
    newDecisionId,
  });

  const historicalExecutionProfile = bindHistoricalExecutionModelToSession();
  const decisionBarIndex = { value: 0 };
  const historicalExecution: HistoricalExecutionRuntime = {
    enabled: true,
    model: historicalExecutionProfile.model,
    exchange: historicalExecutionProfile.exchange,
    getDecisionBarIndex: () => decisionBarIndex.value,
    getReplayNowMs: () => replayClock.nowMs(),
  };

  return {
    historicalExecutionProfile,
    deps: {
      execution: createOrderExecutionServiceFromDeps({
        riskEngine,
        orderRepository,
        killSwitchResolver,
        connectorForMode: () => connector,
        writeAudit,
        nowMs,
        historicalExecution,
      }),
      reconciliation: createPostgresReconciliationService(db, {
        connectorForMode: () => connector,
        nowMs,
        writeAudit,
      }),
      researchReplayDeterminism: {
        clock: replayClock,
        resetWindowState: () => rateStore.clear(),
        newId: sessionNewId,
        setDecisionBarIndex: (index: number) => {
          decisionBarIndex.value = index;
        },
        historicalExecutionSession: true,
      },
    },
  };
}

export function createHtrPostgresUuidFactory(seed: number): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8022-${(seed + counter).toString(16).padStart(12, "0")}`;
  };
}

export async function ensureAuthUsersSeed(url: string, userIds: readonly string[]): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    for (const userId of userIds) {
      await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
        userId,
      ]);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function seedHtrPostgresUser(
  url: string,
  userId: string,
  displayName: string,
): Promise<string> {
  await ensureAuthUsersSeed(url, [userId]);

  const db = getPostgresDrizzle();
  const existing = await db
    .select({ id: pgSchema.users.id })
    .from(pgSchema.users)
    .where(eq(pgSchema.users.id, userId))
    .limit(1);

  if (!existing[0]) {
    await db.insert(pgSchema.users).values({
      id: userId,
      identityLabel: displayName,
      email: `${userId}@waia.invalid`,
      passwordHash: null,
    });
  }

  return ensureUserCoreSeedPostgres(db, { userId, displayName });
}

export async function cleanupHtrPostgresOrg(url: string, userId: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  const orgId = personalOrganizationIdFromUserId(userId);
  try {
    await deleteHtrPostgresAuditLogsForOrg(url, orgId);
    await sql.unsafe(`DELETE FROM trader_knowledge_edges WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_market_events WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_blind_validation_results WHERE organization_id = $1`, [
      orgId,
    ]);
    await sql.unsafe(`DELETE FROM trader_walk_forward_windows WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_strategy_candidates WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_backtest_results WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_backtest_runs WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM research_dataset WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_fills WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_order_events WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_orders WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_strategy_promotion_records WHERE organization_id = $1`, [
      orgId,
    ]);
    await sql.unsafe(`DELETE FROM trader_market_bars WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [userId]);
    await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [userId]);
    await sql.unsafe(`DELETE FROM users WHERE id = $1`, [userId]);
    await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [userId]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
