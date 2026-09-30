/**
 * DEE-540 blind-tail commit on the production postgres.js pool (max: 1).
 *
 * A query on the parent handle while commitDee540BlindHoldout holds the
 * connection never reaches the server, so statement_timeout cannot break it.
 * This test fails that hang with a client-side deadline.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { waiaPostgresJsDriverOptions } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createPostgresOrderRepository,
  createPostgresReconciliationService,
} from "@/lib/trader/execution";
import { createPostgresOrderRepositoryFromExecutor } from "@/lib/trader/execution/repository-adapters";
import { deleteMockExecutionArtifactsForOrgPostgres } from "@/lib/trader/execution/repository-postgres";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import { createForecastDecisionBundleRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { createWp21RuntimeDepsPostgres } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import { createIntelligenceCycleBundleRepositoryPostgres } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import type { Bar } from "@/lib/trader/intelligence/types";
import { insertMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { insertResearchDatasetPostgres } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import {
  buildM9BlindAuthorizationScope,
  computeM9BlindAuthorizationDigest,
  type M9CampaignAuthorizationScope,
} from "@/lib/trader/research/m9-operator-authorization";
import { computeM9DatasetSealPreviewPostgres } from "@/lib/trader/research/m9-dataset-seal-preview";
import { runResearchPipelinePostgres } from "@/lib/trader/research/research-orchestrator";
import type { ResearchValidationBacktestArtifactSink } from "@/lib/trader/research/research-backtest-runner";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createPostgresKillSwitchRepository,
  createPostgresRiskEngineService,
  createPostgresRiskLimitsService,
} from "@/lib/trader/risk";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { buildResearchIntegrationBars } from "@/tests/helpers/build-research-integration-bars";
import {
  commitDee540BlindHoldout,
  DEE540_BLIND_TERMINAL_SCHEMA,
  type Dee540BlindTailExecutor,
} from "@/lib/trader/research/dee-540-blind-tail-commit";
import {
  getStrategyCandidateByIdPostgres,
  insertBlindValidationResultPostgres,
  markStrategyCandidateBlindUsedPostgres,
  registerStrategyCandidatePostgres,
  updateStrategyCandidateStatusPostgres,
  getBlindValidationResultForCandidatePostgres,
} from "@/lib/trader/research/strategy-candidate-repository-postgres";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_ID = crypto.randomUUID();
const DEADLINE_MS = 8_000;
const PIPELINE_DEADLINE_MS = 180_000;

function buildBar(close: string, openMs: number): Bar {
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: new Date(openMs).toISOString(),
    barCloseTime: new Date(openMs + 60_000).toISOString(),
  };
}

function successMetrics(): ResearchValidationMetrics {
  return {
    schemaVersion: "1.0.0",
    tradeCount: 0,
    periodRealizedPnl: "0",
    periodTotalFees: "0",
    byRegime: [],
  };
}

function bindRepository(tx: Dee540BlindTailExecutor) {
  return {
    getBlindValidationResultForCandidate: (context: OrgContext, candidateId: string) =>
      getBlindValidationResultForCandidatePostgres(tx, context, candidateId),
    insertBlindValidationResult: (
      context: OrgContext,
      row: Parameters<typeof insertBlindValidationResultPostgres>[2],
    ) => insertBlindValidationResultPostgres(tx, context, row),
    markStrategyCandidateBlindUsed: (context: OrgContext, candidateId: string) =>
      markStrategyCandidateBlindUsedPostgres(tx, context, candidateId),
    updateStrategyCandidateStatus: (
      context: OrgContext,
      candidateId: string,
      status: Parameters<typeof updateStrategyCandidateStatusPostgres>[3],
    ) => updateStrategyCandidateStatusPostgres(tx, context, candidateId, status),
  };
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`dee540 blind-tail commit exceeded ${ms}ms on a max:1 pool`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe.skipIf(!integrationEnabled || !url)("DEE-540 blind tail on a max:1 pool", () => {
  let organizationId = "";

  async function openPool(): Promise<{
    client: postgres.Sql;
    db: WaiaPostgresDb;
  }> {
    const driver = waiaPostgresJsDriverOptions();
    expect(driver.max).toBe(1);
    const client = postgres(url!, driver);
    const db = drizzle(client, { schema: pgSchema });
    return { client, db };
  }

  async function cleanupOrg(client: postgres.Sql): Promise<void> {
    const orgId = organizationId || personalOrganizationIdFromUserId(USER_ID);
    // trader_dee540_bar_consumption is append-only. A fresh bar-content digest
    // per run leaves that row in place; this cleanup never deletes it.
    await client`delete from trader_blind_validation_results where organization_id = ${orgId}`;
    await client`delete from trader_strategy_candidates where organization_id = ${orgId}`;
    await client`delete from research_dataset where organization_id = ${orgId}`;
    await client`delete from trader_orders where organization_id = ${orgId}`;
    await client`delete from organization_entitlements where organization_id = ${orgId}`;
    await client`delete from organization_subscriptions where organization_id = ${orgId}`;
    await client`delete from organization_members where organization_id = ${orgId}`;
    await client`delete from organizations where id = ${orgId}`;
    await client`delete from user_platform_roles where user_id = ${USER_ID}`;
    await client`delete from profiles where user_id = ${USER_ID}`;
    await client`delete from users where id = ${USER_ID}`;
    await client`delete from auth.users where id = ${USER_ID}`;
  }

  beforeAll(async () => {
    const { client, db } = await openPool();
    try {
      await cleanupOrg(client);
      await client`insert into auth.users (id) values (${USER_ID}) on conflict (id) do nothing`;
      await db.insert(pgSchema.users).values({
        id: USER_ID,
        identityLabel: "DEE-540 max pool",
        email: `${USER_ID}@waia.invalid`,
        passwordHash: null,
      });
      organizationId = await ensureUserCoreSeedPostgres(db, {
        userId: USER_ID,
        displayName: "DEE-540 max pool",
      });
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 20_000);

  afterAll(async () => {
    const client = postgres(url!, { max: 1 });
    try {
      await cleanupOrg(client);
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 20_000);

  async function seedHoldout(db: WaiaPostgresDb, close: string, strategyVersion: string) {
    const context = requireOrgContext(organizationId);
    const openMs = Date.UTC(2026, 5, 22, 9, 40, 0) + crypto.getRandomValues(new Uint32Array(1))[0]!;
    const bars = [buildBar(close, openMs)];
    const blindDigest = computeBarSetDigest(bars);
    const datasetId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    await insertResearchDatasetPostgres(db, context, {
      id: datasetId,
      name: `dee540-max-pool-${strategyVersion}`,
      symbol: "BTC/USDT",
      interval: "1m",
      sealed: {
        trainBarCount: 1,
        validationBarCount: 1,
        blindBarCount: 1,
        trainDigest: blindDigest,
        validationDigest: blindDigest,
        blindDigest,
        sealedAt: "2026-06-22T09:41:00.000Z",
      },
    });
    const candidate = await registerStrategyCandidatePostgres(db, context, {
      id: candidateId,
      strategyId: "dee540_max_pool",
      strategyVersion,
      paramsJson: "{}",
      status: "walk_forward_validated",
    });
    return { context, bars, blindDigest, datasetId, candidate };
  }

  async function onExecutor(context: OrgContext, executor: Dee540BlindTailExecutor): Promise<void> {
    await deleteMockExecutionArtifactsForOrgPostgres(executor, context);
    const repository = createPostgresOrderRepositoryFromExecutor(executor);
    await repository.listOrders(context, { executionMode: "mock" });
  }

  it("commits the blind tail when delete and the order repository run on the transaction", async () => {
    const { client, db } = await openPool();
    const work = (async () => {
      const seeded = await seedHoldout(db, "64001", "success");
      const outcome = await commitDee540BlindHoldout(db, {
        blindDigest: seeded.blindDigest,
        context: seeded.context,
        candidate: seeded.candidate,
        datasetId: seeded.datasetId,
        blindBars: seeded.bars,
        expectedBlindDigest: seeded.blindDigest,
        runBacktest: async ({ bars, executor }) => {
          expect(bars).toEqual(seeded.bars);
          await onExecutor(seeded.context, executor);
          return successMetrics();
        },
        readRepository: {
          getBlindValidationResultForCandidate: (context, candidateId) =>
            getBlindValidationResultForCandidatePostgres(db, context, candidateId),
        },
        bindRepository,
      });
      expect(outcome.metrics).toEqual(successMetrics());
      const consumed = await db
        .select()
        .from(pgSchema.traderDee540BarConsumption)
        .where(eq(pgSchema.traderDee540BarConsumption.blindDigest, seeded.blindDigest));
      expect(consumed).toHaveLength(1);
      const results = await db
        .select()
        .from(pgSchema.traderBlindValidationResults)
        .where(eq(pgSchema.traderBlindValidationResults.candidateId, seeded.candidate.id));
      expect(results).toHaveLength(1);
      expect(JSON.parse(results[0]!.metricsJson)).toMatchObject({ schemaVersion: "1.0.0" });
      const stored = await getStrategyCandidateByIdPostgres(
        db,
        seeded.context,
        seeded.candidate.id,
      );
      expect(stored?.status).toBe("blind_validated");
      expect(stored?.blindUsed).toBe(true);
    })();
    work.catch(() => undefined);
    try {
      await withDeadline(work, DEADLINE_MS);
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 20_000);

  it("commits consume and one terminal row when the backtest throws after the bars are seen", async () => {
    const { client, db } = await openPool();
    const work = (async () => {
      const seeded = await seedHoldout(db, "64002", "thrown");
      const failure = new Error("blind backtest failed after bars");
      await expect(
        commitDee540BlindHoldout(db, {
          blindDigest: seeded.blindDigest,
          context: seeded.context,
          candidate: seeded.candidate,
          datasetId: seeded.datasetId,
          blindBars: seeded.bars,
          expectedBlindDigest: seeded.blindDigest,
          runBacktest: async ({ executor }) => {
            await onExecutor(seeded.context, executor);
            throw failure;
          },
          readRepository: {
            getBlindValidationResultForCandidate: (context, candidateId) =>
              getBlindValidationResultForCandidatePostgres(db, context, candidateId),
          },
          bindRepository,
        }),
      ).rejects.toBe(failure);
      const consumed = await db
        .select()
        .from(pgSchema.traderDee540BarConsumption)
        .where(eq(pgSchema.traderDee540BarConsumption.blindDigest, seeded.blindDigest));
      expect(consumed).toHaveLength(1);
      const results = await db
        .select()
        .from(pgSchema.traderBlindValidationResults)
        .where(eq(pgSchema.traderBlindValidationResults.candidateId, seeded.candidate.id));
      expect(results).toHaveLength(1);
      expect(JSON.parse(results[0]!.metricsJson)).toMatchObject({
        schemaVersion: DEE540_BLIND_TERMINAL_SCHEMA,
        outcome: "error",
        phase: "backtest",
      });
      const stored = await getStrategyCandidateByIdPostgres(
        db,
        seeded.context,
        seeded.candidate.id,
      );
      expect(stored?.status).toBe("walk_forward_validated");
      expect(stored?.blindUsed).toBe(false);
    })();
    work.catch(() => undefined);
    try {
      await withDeadline(work, DEADLINE_MS);
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 20_000);
});

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function shiftBars(bars: readonly Bar[], shiftMs: number): Bar[] {
  return bars.map((bar) => {
    const openMs = Date.parse(bar.barOpenTime) + shiftMs;
    const closeMs = Date.parse(bar.barCloseTime) + shiftMs;
    return {
      ...bar,
      barOpenTime: new Date(openMs).toISOString(),
      barCloseTime: new Date(closeMs).toISOString(),
    };
  });
}

function blindWindowEmittedOrder(sink: ResearchValidationBacktestArtifactSink): boolean {
  return (sink.cycleResults ?? []).some(
    (cycle) =>
      cycle.execution != null || cycle.strategyExecutions.some((row) => row.execution != null),
  );
}

/**
 * End-to-end CLI path on max:1. Each run uses a fresh org and bar-content
 * digest. Append-only consume and intelligence rows are left in place.
 */
describe.skipIf(!integrationEnabled || !url)("DEE-540 blind tail CLI path on a max:1 pool", () => {
  let shiftNonce = 0;

  async function openPool(): Promise<{ client: postgres.Sql; db: WaiaPostgresDb }> {
    const driver = waiaPostgresJsDriverOptions();
    expect(driver.max).toBe(1);
    const client = postgres(url!, driver);
    const db = drizzle(client, { schema: pgSchema });
    return { client, db };
  }

  async function seedOrg(db: WaiaPostgresDb, client: postgres.Sql): Promise<OrgContext> {
    const userId = crypto.randomUUID();
    await client`insert into auth.users (id) values (${userId}) on conflict (id) do nothing`;
    await db.insert(pgSchema.users).values({
      id: userId,
      identityLabel: "DEE-540 pipeline",
      email: `${userId}@waia.invalid`,
      passwordHash: null,
    });
    const organizationId = await ensureUserCoreSeedPostgres(db, {
      userId,
      displayName: "DEE-540 pipeline",
    });
    return requireOrgContext(organizationId);
  }

  async function buildCliDeps(db: WaiaPostgresDb, context: OrgContext) {
    const writeAudit = (input: Parameters<typeof writeTraderAuditLogPostgres>[1]) =>
      writeTraderAuditLogPostgres(db, input);
    const nowMs = () => Date.now();
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    const limits = createPostgresRiskLimitsService(db);
    await limits.upsertLimitsForOrg(context, { ...DEFAULT_ORG_RISK_LIMITS });
    const killSwitchResolver = createKillSwitchResolver({
      repository: createPostgresKillSwitchRepository(db),
      nowMs,
    });
    const riskEngine = createPostgresRiskEngineService(db, {
      limitsService: limits,
      killSwitchResolver,
      rateStore: createInMemoryOrderRateStore(),
      writeAudit,
      nowMs,
      newDecisionId: () => crypto.randomUUID(),
    });
    return {
      deps: {
        execution: createOrderExecutionServiceFromDeps({
          riskEngine,
          orderRepository: createPostgresOrderRepository(db),
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
      },
      createOrderRepository: () => createPostgresOrderRepository(db),
    };
  }

  async function prepare(db: WaiaPostgresDb, client: postgres.Sql, label: string) {
    shiftNonce += 1;
    const context = await seedOrg(db, client);
    const uniqueDays = shiftNonce + (crypto.getRandomValues(new Uint32Array(1))[0]! % 50_000);
    const bars = shiftBars(buildResearchIntegrationBars(), uniqueDays * DAY_MS);
    await insertMarketBarsPostgres(
      db,
      context,
      bars.map((bar) => ({ bar })),
    );
    const strategyVersion = `0.1.${label}-${shiftNonce}`;
    const datasetName = `dee540-max-pool-${label}-${shiftNonce}`;
    const sealPreview = await computeM9DatasetSealPreviewPostgres(db, context, {
      symbol: "BTC/USDT",
      interval: "1m",
    });
    const campaignScope: M9CampaignAuthorizationScope = {
      organizationId: context.organizationId,
      strategyId: "mean_reversion_v0",
      strategyVersion,
      symbol: "BTC/USDT",
      interval: "1m",
      vaultDir: `tests/fixtures/dee540-max-pool-${label}`,
      metricsSchemaVersion: "1.0.0",
    };
    const blindScope = buildM9BlindAuthorizationScope({
      campaignScope,
      datasetName,
      blindDigest: sealPreview.sealed.blindDigest,
      sidecarContentDigest: null,
    });
    const cli = await buildCliDeps(db, context);
    return {
      context,
      strategyVersion,
      datasetName,
      blindDigest: sealPreview.sealed.blindDigest,
      operatorBlindAuthorization: computeM9BlindAuthorizationDigest(blindScope),
      blindScope,
      ...cli,
    };
  }

  function closureInput(db: WaiaPostgresDb, blindDigest: string) {
    const wp21 = createWp21RuntimeDepsPostgres(db);
    return {
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      intelligenceRecordsSink: createIntelligenceCycleBundleRepositoryPostgres(db),
      forecastDecisionSink: createForecastDecisionBundleRepositoryPostgres(db),
      outcomeResolutionSink: wp21.outcomeResolutionSink,
      calibrationSink: wp21.calibrationSink,
      confidenceUpdateSink: wp21.confidenceUpdateSink,
      wp21RuntimeDeps: wp21,
      outcomeResolutionReadPort: wp21.outcomeResolutionReadPort,
      wp21PostgresExecutor: db,
      wp21Provenance: {
        codeSha: "dee540-max-pool",
        datasetContentDigest: blindDigest,
      },
    };
  }

  it(
    "completes the CLI pipeline when the blind window emits an order",
    async () => {
      const sink: ResearchValidationBacktestArtifactSink = {};
      const { client, db } = await openPool();
      const work = (async () => {
        const prepared = await prepare(db, client, "orders");
        const result = await runResearchPipelinePostgres(db, {
          context: prepared.context,
          datasetName: prepared.datasetName,
          symbol: "BTC/USDT",
          interval: "1m",
          strategyId: "mean_reversion_v0",
          strategyVersion: prepared.strategyVersion,
          oosBarCount: 20,
          requireMultiRegimeCoverage: false,
          deps: prepared.deps,
          createOrderRepository: prepared.createOrderRepository,
          submitResearchMockOrders: true,
          newId: () => crypto.randomUUID(),
          pipelineBacktest: {
            operatorBlindAuthorization: prepared.operatorBlindAuthorization,
            blindAuthorizationScope: prepared.blindScope,
            officialHoldoutAccessRequested: false,
            blindArtifactSink: sink,
          },
        });
        expect(blindWindowEmittedOrder(sink)).toBe(true);
        expect(result.dataset.blindDigest).toBe(prepared.blindDigest);
        const consumed = await db
          .select()
          .from(pgSchema.traderDee540BarConsumption)
          .where(eq(pgSchema.traderDee540BarConsumption.blindDigest, prepared.blindDigest));
        expect(consumed).toHaveLength(1);
        const results = await db
          .select()
          .from(pgSchema.traderBlindValidationResults)
          .where(eq(pgSchema.traderBlindValidationResults.candidateId, result.strategyCandidateId));
        expect(results).toHaveLength(1);
        expect(JSON.parse(results[0]!.metricsJson).schemaVersion).toBe("1.0.0");
        const stored = await getStrategyCandidateByIdPostgres(
          db,
          prepared.context,
          result.strategyCandidateId,
        );
        expect(stored?.status).toBe("blind_validated");
        expect(stored?.blindUsed).toBe(true);
      })();
      work.catch(() => undefined);
      try {
        await withDeadline(work, PIPELINE_DEADLINE_MS);
      } finally {
        await client.end({ timeout: 5 });
      }
    },
    PIPELINE_DEADLINE_MS + 30_000,
  );

  it(
    "completes the CLI pipeline with epistemic closure when the blind window emits an order",
    async () => {
      const sink: ResearchValidationBacktestArtifactSink = {};
      const { client, db } = await openPool();
      const work = (async () => {
        const prepared = await prepare(db, client, "closure");
        const result = await runResearchPipelinePostgres(db, {
          context: prepared.context,
          datasetName: prepared.datasetName,
          symbol: "BTC/USDT",
          interval: "1m",
          strategyId: "mean_reversion_v0",
          strategyVersion: prepared.strategyVersion,
          oosBarCount: 20,
          requireMultiRegimeCoverage: false,
          deps: prepared.deps,
          createOrderRepository: prepared.createOrderRepository,
          submitResearchMockOrders: true,
          newId: () => crypto.randomUUID(),
          pipelineBacktest: {
            operatorBlindAuthorization: prepared.operatorBlindAuthorization,
            blindAuthorizationScope: prepared.blindScope,
            officialHoldoutAccessRequested: false,
            blindArtifactSink: sink,
          },
          ...closureInput(db, prepared.blindDigest),
        });
        expect(blindWindowEmittedOrder(sink)).toBe(true);
        const consumed = await db
          .select()
          .from(pgSchema.traderDee540BarConsumption)
          .where(eq(pgSchema.traderDee540BarConsumption.blindDigest, prepared.blindDigest));
        expect(consumed).toHaveLength(1);
        const results = await db
          .select()
          .from(pgSchema.traderBlindValidationResults)
          .where(eq(pgSchema.traderBlindValidationResults.candidateId, result.strategyCandidateId));
        expect(results).toHaveLength(1);
        expect(JSON.parse(results[0]!.metricsJson).schemaVersion).toBe("1.0.0");
      })();
      work.catch(() => undefined);
      try {
        await withDeadline(work, PIPELINE_DEADLINE_MS);
      } finally {
        await client.end({ timeout: 5 });
      }
    },
    PIPELINE_DEADLINE_MS + 30_000,
  );

  it(
    "commits consume and one terminal row when the blind backtest throws after an order",
    async () => {
      const sink: ResearchValidationBacktestArtifactSink = {};
      const { client, db } = await openPool();
      const work = (async () => {
        const prepared = await prepare(db, client, "thrown");
        await expect(
          runResearchPipelinePostgres(db, {
            context: prepared.context,
            datasetName: prepared.datasetName,
            symbol: "BTC/USDT",
            interval: "1m",
            strategyId: "mean_reversion_v0",
            strategyVersion: prepared.strategyVersion,
            oosBarCount: 20,
            requireMultiRegimeCoverage: false,
            deps: prepared.deps,
            createOrderRepository: prepared.createOrderRepository,
            submitResearchMockOrders: true,
            newId: () => crypto.randomUUID(),
            pipelineBacktest: {
              operatorBlindAuthorization: prepared.operatorBlindAuthorization,
              blindAuthorizationScope: prepared.blindScope,
              officialHoldoutAccessRequested: false,
              blindArtifactSink: sink,
            },
            afterBlindBacktest: async () => {
              throw new Error("blind backtest failed after order");
            },
          }),
        ).rejects.toThrow("blind backtest failed after order");
        expect(blindWindowEmittedOrder(sink)).toBe(true);
        const consumed = await db
          .select()
          .from(pgSchema.traderDee540BarConsumption)
          .where(eq(pgSchema.traderDee540BarConsumption.blindDigest, prepared.blindDigest));
        expect(consumed).toHaveLength(1);
        const results = await db
          .select()
          .from(pgSchema.traderBlindValidationResults)
          .where(
            eq(
              pgSchema.traderBlindValidationResults.organizationId,
              prepared.context.organizationId,
            ),
          );
        expect(results).toHaveLength(1);
        expect(JSON.parse(results[0]!.metricsJson)).toMatchObject({
          schemaVersion: DEE540_BLIND_TERMINAL_SCHEMA,
          outcome: "error",
          phase: "backtest",
        });
        const candidates = await db
          .select()
          .from(pgSchema.traderStrategyCandidates)
          .where(
            eq(pgSchema.traderStrategyCandidates.organizationId, prepared.context.organizationId),
          );
        expect(candidates).toHaveLength(1);
        expect(candidates[0]?.status).toBe("walk_forward_validated");
        expect(candidates[0]?.blindUsed).toBe(false);
      })();
      work.catch(() => undefined);
      try {
        await withDeadline(work, PIPELINE_DEADLINE_MS);
      } finally {
        await client.end({ timeout: 5 });
      }
    },
    PIPELINE_DEADLINE_MS + 30_000,
  );
});
