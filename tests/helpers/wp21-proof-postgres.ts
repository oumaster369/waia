/**
 * Shared Postgres helpers for HTR-WP21 proof-closure integration tests.
 */

import postgres from "postgres";

import { getPostgresDrizzle } from "@/db/postgres-client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createPostgresOrderRepository,
  createPostgresReconciliationService,
} from "@/lib/trader/execution";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { createForecastDecisionBundleRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { createIntelligenceCycleBundleRepositoryPostgres } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import { createWp21RuntimeDepsPostgres } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import {
  insertMarketBarsPostgres,
  listMarketBarsPostgres,
} from "@/lib/trader/market-data/market-bars-repository-postgres";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { runResearchPipelinePostgres } from "@/lib/trader/research/research-orchestrator";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createPostgresKillSwitchRepository,
  createPostgresRiskEngineService,
  createPostgresRiskLimitsService,
} from "@/lib/trader/risk";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import {
  buildResearchIntegrationBars,
  RESEARCH_INTEGRATION_BAR_COUNT,
} from "@/tests/helpers/build-research-integration-bars";
import { digestResearchValidationCapitalPath } from "@/lib/trader/intelligence/epistemic/wp21-proof-harness";
import { verifyWp21ProofPostgresConnectionIdentity } from "@/lib/trader/intelligence/epistemic/wp21-proof-preflight";
import { cleanupWp14AllRows } from "@/tests/integration/wp14-forecast-decision-test-helpers";

export const WP21_PROOF_PG_USER = "00000000-0000-4000-8021-0000000000b3";
export const WP21_PROOF_PG_OOS_BARS = 20;

export const WP21_PROOF_TABLES = [
  "trader_forecast_outcome_record",
  "trader_hypothesis_outcome_record",
  "trader_calibration_observation_record",
  "trader_calibration_snapshot_record",
  "trader_abstention_outcome_record",
  "trader_knowledge_confidence_update_record",
] as const;

export async function assertWp21MandatoryPostgresProofEnvironment(): Promise<void> {
  await verifyWp21ProofPostgresConnectionIdentity();
}

export function createWp21ProofPipelineIdFactory(): () => string {
  return () => crypto.randomUUID();
}

export async function buildWp21ProofPostgresDeps(
  db: ReturnType<typeof getPostgresDrizzle>,
  orgId: string,
): Promise<PaperCycleDeps> {
  const context = requireOrgContext(orgId);
  const writeAudit = (input: Parameters<typeof writeTraderAuditLogPostgres>[1]) =>
    writeTraderAuditLogPostgres(db, input);
  const nowMs = () => Date.parse("2026-01-01T00:00:00.000Z");
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
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs,
    newDecisionId: () => crypto.randomUUID(),
  });

  return {
    execution: createOrderExecutionServiceFromDeps({
      riskEngine,
      orderRepository,
      killSwitchResolver,
      connectorForMode: () => connector,
      writeAudit,
      nowMs,
    }),
    reconciliation: createPostgresReconciliationService(db, {
      connectorForMode: () => connector,
      nowMs,
      writeAudit,
    }),
  };
}

export async function seedWp21ProofUser(
  url: string,
  userId: string,
  displayName: string,
): Promise<string> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
      userId,
    ]);
    await sql.unsafe(
      `INSERT INTO users (id, identity_label, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [userId, displayName, `${userId}@waia.invalid`],
    );
  } finally {
    await sql.end({ timeout: 5 });
  }

  const db = getPostgresDrizzle();
  return ensureUserCoreSeedPostgres(db, { userId, displayName });
}

export async function cleanupWp21ProofOrgRows(
  sql: postgres.Sql,
  orgId: string,
  databaseUrl: string,
): Promise<void> {
  for (const table of WP21_PROOF_TABLES) {
    await sql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
    await sql.unsafe(`DELETE FROM ${table} WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
  }
  await cleanupWp14AllRows(databaseUrl, orgId);
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
}

export async function countOrgRows(
  sql: postgres.Sql,
  table: string,
  orgId: string,
): Promise<number> {
  const rows = await sql.unsafe<{ count: number }[]>(
    `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
    [orgId],
  );
  return rows[0]?.count ?? 0;
}

export async function runWp21ProofProductionPipeline(input: {
  db: ReturnType<typeof getPostgresDrizzle>;
  orgId: string;
  datasetName: string;
  wp21Enabled: boolean;
  metricsSchemaVersion?: typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION | "1.0.0";
  strategyVersion?: string;
  newId: () => string;
}) {
  const context = requireOrgContext(input.orgId);
  const deps = await buildWp21ProofPostgresDeps(input.db, input.orgId);
  const strategyVersion =
    input.strategyVersion ?? `0.1.${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const barRecords = await listMarketBarsPostgres(input.db, context, {
    symbol: "BTC/USDT",
    interval: "1m",
  });
  const barSetDigest = computeBarSetDigest(barRecords);

  const wp21Deps = input.wp21Enabled ? createWp21RuntimeDepsPostgres(input.db) : undefined;
  const validationArtifactSink = {};

  const result = await runResearchPipelinePostgres(input.db, {
    context,
    deps,
    createOrderRepository: () => createPostgresOrderRepository(input.db),
    newId: input.newId,
    datasetName: input.datasetName,
    symbol: "BTC/USDT",
    interval: "1m",
    strategyId: "mean_reversion_v0",
    strategyVersion,
    oosBarCount: WP21_PROOF_PG_OOS_BARS,
    requireMultiRegimeCoverage: false,
    pipelineBacktest: {
      metricsSchemaVersion:
        input.metricsSchemaVersion === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION
          ? RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION
          : "1.0.0",
      validationArtifactSink,
    },
    ...(input.wp21Enabled && wp21Deps
      ? {
          historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
          intelligenceRecordsSink: createIntelligenceCycleBundleRepositoryPostgres(input.db),
          forecastDecisionSink: createForecastDecisionBundleRepositoryPostgres(input.db),
          outcomeResolutionSink: wp21Deps.outcomeResolutionSink,
          calibrationSink: wp21Deps.calibrationSink,
          confidenceUpdateSink: wp21Deps.confidenceUpdateSink,
          wp21RuntimeDeps: wp21Deps,
          outcomeResolutionReadPort: wp21Deps.outcomeResolutionReadPort,
          wp21PostgresExecutor: input.db,
          wp21Provenance: {
            codeSha: "wp21-proof-closure",
            datasetContentDigest: barSetDigest,
          },
        }
      : {}),
  });

  const capitalDigest =
    result.validationCycleResults && result.validationMetrics
      ? digestResearchValidationCapitalPath({
          metricsSchemaVersion:
            input.metricsSchemaVersion === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION
              ? RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION
              : "1.0.0",
          metrics: result.validationMetrics,
          cycleResults: result.validationCycleResults,
          portfolioContext: result.validationPortfolioContext,
        })
      : null;

  return { result, capitalDigest, validationArtifactSink };
}

export async function seedWp21ProofPostgresOrg(input: {
  db: ReturnType<typeof getPostgresDrizzle>;
  databaseUrl: string;
}): Promise<string> {
  const orgId = await seedWp21ProofUser(
    input.databaseUrl,
    WP21_PROOF_PG_USER,
    "WP21 Proof Postgres",
  );
  const context = requireOrgContext(orgId);
  const bars = buildResearchIntegrationBars(RESEARCH_INTEGRATION_BAR_COUNT);
  await insertMarketBarsPostgres(
    input.db,
    context,
    bars.map((bar) => ({ bar })),
  );
  return orgId;
}
