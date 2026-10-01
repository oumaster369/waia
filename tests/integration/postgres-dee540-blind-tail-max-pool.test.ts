/**
 * DEE-540 blind-tail commit on the production postgres.js pool (max: 1).
 *
 * A query on the parent handle while commitDee540BlindHoldout holds the
 * connection never reaches the server, so statement_timeout cannot break it.
 * This test fails that hang with a client-side deadline.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { waiaPostgresJsDriverOptions } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createPostgresOrderExecutionService,
  createPostgresOrderRepository,
  createPostgresReconciliationService,
} from "@/lib/trader/execution";
import { createPostgresOrderRepositoryFromExecutor } from "@/lib/trader/execution/repository-adapters";
import { bindHistoricalExecutionModelToSession } from "@/lib/trader/backtest/historical-execution-profile";
import { deleteMockExecutionArtifactsForOrgPostgres } from "@/lib/trader/execution/repository-postgres";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import { createForecastDecisionBundleRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { createLifecycleRecorder } from "@/lib/trader/lifecycle/lifecycle-recorder";
import { createPostgresLifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository-postgres";
import { createWp21RuntimeDepsPostgres } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import { createIntelligenceCycleBundleRepositoryPostgres } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import type { Bar } from "@/lib/trader/intelligence/types";
import { insertMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { dee540BarContentConsumed } from "@/lib/trader/research/dee-540-authorization-store";
import { insertResearchDatasetPostgres } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import {
  buildM9BlindAuthorizationScope,
  computeM9BlindAuthorizationDigest,
  type M9CampaignAuthorizationScope,
} from "@/lib/trader/research/m9-operator-authorization";
import { computeM9DatasetSealPreviewPostgres } from "@/lib/trader/research/m9-dataset-seal-preview";
import {
  bindBlindWindowToExecutor,
  runResearchPipelinePostgres,
  type RunResearchPipelineInput,
} from "@/lib/trader/research/research-orchestrator";
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
import { ResearchOrchestratorError } from "@/lib/trader/research/errors";
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

  it("rejects an outer transaction before blind status read, token burn, or bar exposure", async () => {
    const { client, db } = await openPool();
    const work = (async () => {
      const seeded = await seedHoldout(db, "64004", "outer-transaction");
      const runBacktest = vi.fn(async () => successMetrics());
      const outerRollback = new Error("rollback outer transaction after root refusal");
      let nestedError: unknown;
      let statusReads = 0;

      await expect(
        db.transaction(async (outerTx) => {
          try {
            await commitDee540BlindHoldout(outerTx as Dee540BlindTailExecutor, {
              blindDigest: seeded.blindDigest,
              context: seeded.context,
              candidate: seeded.candidate,
              datasetId: seeded.datasetId,
              blindBars: seeded.bars,
              expectedBlindDigest: seeded.blindDigest,
              runBacktest,
              readRepository: {
                getBlindValidationResultForCandidate: (context, candidateId) => {
                  statusReads += 1;
                  return getBlindValidationResultForCandidatePostgres(
                    outerTx,
                    context,
                    candidateId,
                  );
                },
              },
              bindRepository,
            });
          } catch (error) {
            nestedError = error;
          }
          throw outerRollback;
        }),
      ).rejects.toBe(outerRollback);

      const tokenConsumedAfterRollback = await dee540BarContentConsumed(db, seeded.blindDigest);
      console.error(
        "DEE1159_OUTER_TX_PROOF",
        JSON.stringify({
          statusReads,
          backtestCalls: runBacktest.mock.calls.length,
          tokenConsumedAfterRollback,
          nestedError:
            nestedError instanceof Error
              ? { name: nestedError.name, message: nestedError.message }
              : String(nestedError),
        }),
      );
      expect(nestedError).toMatchObject({
        message: expect.stringContaining("RESEARCH_ROOT_DATABASE_REQUIRED"),
      });
      expect(statusReads).toBe(0);
      expect(runBacktest).not.toHaveBeenCalled();
      expect(tokenConsumedAfterRollback).toBe(false);

      // The rejected outer transaction never saw the bars or consumed the token;
      // a legitimate root-pool retry remains the first and only opener.
      const outcome = await commitDee540BlindHoldout(db, {
        blindDigest: seeded.blindDigest,
        context: seeded.context,
        candidate: seeded.candidate,
        datasetId: seeded.datasetId,
        blindBars: seeded.bars,
        expectedBlindDigest: seeded.blindDigest,
        runBacktest,
        readRepository: {
          getBlindValidationResultForCandidate: (context, candidateId) =>
            getBlindValidationResultForCandidatePostgres(db, context, candidateId),
        },
        bindRepository,
      });
      expect(outcome.metrics).toEqual(successMetrics());
      expect(runBacktest).toHaveBeenCalledTimes(1);
      expect(await dee540BarContentConsumed(db, seeded.blindDigest)).toBe(true);
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

  it("keeps blind lifecycle reads and writes on the outcome transaction", async () => {
    const { client, db } = await openPool();
    const witnessClient = postgres(url!, { max: 1 });
    const witnessDb = drizzle(witnessClient, { schema: pgSchema });
    const work = (async () => {
      const seeded = await seedHoldout(db, "64005", `lifecycle-${crypto.randomUUID()}`);
      const entityId = `blind-lifecycle-${crypto.randomUUID()}`;
      const eventId = crypto.randomUUID();
      const clockMs = Date.UTC(2026, 5, 22, 9, 41, 0);
      class ReceiverClock {
        constructor(private currentMs: number) {}
        nowMs() { return this.currentMs; }
        setNowMs(ms: number) { this.currentMs = ms; }
      }
      const replayDeterminism = {
        clock: new ReceiverClock(clockMs),
        resetWindowState: () => undefined,
        eventId,
        newId() { return this.eventId; },
      };
      const parentRepository = createPostgresLifecycleRepository(witnessDb);
      const parentRecorder = createLifecycleRecorder({ repository: parentRepository });
      const parentRead = vi.spyOn(parentRepository, "listLifecycleEvents");
      const parentWrite = vi.spyOn(parentRecorder, "recordSignalAcceptedLifecycleEvent");
      const input: RunResearchPipelineInput = {
        context: seeded.context,
        datasetName: "unused-lifecycle-binding",
        symbol: "BTC/USDT",
        interval: "1m",
        strategyId: "dee540_max_pool",
        strategyVersion: "lifecycle",
        deps: {
          execution: createPostgresOrderExecutionService(db),
          reconciliation: createPostgresReconciliationService(db),
          lifecycleRepository: parentRepository,
          lifecycleRecorder: parentRecorder,
          researchReplayDeterminism: replayDeterminism,
        },
        createOrderRepository: () => createPostgresOrderRepository(db),
      };
      const failure = new Error("rollback blind lifecycle outcome");
      let insideEvent: { id: string; occurredAt: Date } | undefined;
      await expect(
        commitDee540BlindHoldout(db, {
          blindDigest: seeded.blindDigest,
          context: seeded.context,
          candidate: seeded.candidate,
          datasetId: seeded.datasetId,
          blindBars: seeded.bars,
          expectedBlindDigest: seeded.blindDigest,
          runBacktest: async ({ executor }) => {
            const bound = bindBlindWindowToExecutor(input, executor);
            const before = await bound.deps.lifecycleRepository!.listLifecycleEvents(
              seeded.context,
              { entityType: "STRATEGY_SIGNAL", entityId },
            );
            expect(before).toHaveLength(0);
            await bound.deps.lifecycleRecorder!.recordSignalAcceptedLifecycleEvent({
              context: seeded.context,
              strategySignalId: entityId,
            });
            const inside = await bound.deps.lifecycleRepository!.listLifecycleEvents(
              seeded.context,
              { entityType: "STRATEGY_SIGNAL", entityId },
            );
            expect(inside).toHaveLength(1);
            insideEvent = inside[0];
            throw failure;
          },
          readRepository: {
            getBlindValidationResultForCandidate: (context, candidateId) =>
              getBlindValidationResultForCandidatePostgres(db, context, candidateId),
          },
          bindRepository,
        }),
      ).rejects.toBe(failure);

      const parentReadCalls = parentRead.mock.calls.length;
      const parentWriteCalls = parentWrite.mock.calls.length;
      const outside = await parentRepository.listLifecycleEvents(seeded.context, {
        entityType: "STRATEGY_SIGNAL",
        entityId,
      });
      console.error(
        "DEE1159_BLIND_LIFECYCLE_BINDING_PROOF",
        JSON.stringify({ parentReadCalls, parentWriteCalls, outsideRows: outside.length }),
      );
      expect(parentReadCalls).toBe(0);
      expect(parentWriteCalls).toBe(0);
      expect(outside).toHaveLength(0);
      expect(insideEvent?.id).toBe(eventId);
      expect(insideEvent?.occurredAt.toISOString()).toBe(new Date(clockMs).toISOString());
      expect(await dee540BarContentConsumed(db, seeded.blindDigest)).toBe(true);
      parentRead.mockRestore();
      parentWrite.mockRestore();
    })();
    work.catch(() => undefined);
    try {
      await withDeadline(work, DEADLINE_MS);
    } finally {
      await witnessClient.end({ timeout: 5 });
      await client.end({ timeout: 5 });
    }
  }, 20_000);

  it("refuses an incomplete historical replay binding before payload access or blind burn", async () => {
    const { client, db } = await openPool();
    try {
      const seeded = await seedHoldout(db, "64007", `missing-replay-${crypto.randomUUID()}`);
      const input: RunResearchPipelineInput = {
        context: seeded.context,
        datasetName: "unused-missing-replay-binding",
        symbol: "BTC/USDT", interval: "1m",
        strategyId: "dee540_max_pool", strategyVersion: "missing-replay",
        deps: {
          execution: createPostgresOrderExecutionService(db),
          reconciliation: createPostgresReconciliationService(db),
        },
        historicalExecutionProfile: bindHistoricalExecutionModelToSession(),
        createOrderRepository: () => createPostgresOrderRepository(db),
      };
      const select = vi.spyOn(db, "select");
      try {
        await expect(runResearchPipelinePostgres(db, input)).rejects.toMatchObject({
          code: "RESEARCH_HISTORICAL_REPLAY_BINDING_REQUIRED",
        });
        expect(select).not.toHaveBeenCalled();
      } finally {
        select.mockRestore();
      }
      expect(await dee540BarContentConsumed(db, seeded.blindDigest)).toBe(false);
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it("preserves historical fill and cancellation runtime on the blind outcome executor", async () => {
    const { client, db } = await openPool();
    const work = (async () => {
      const seeded = await seedHoldout(db, "64006", `historical-runtime-${crypto.randomUUID()}`);
      const orderId = crypto.randomUUID();
      const profile = bindHistoricalExecutionModelToSession();
      const replayClock = {
        currentMs: Date.parse(seeded.bars[0]!.barCloseTime),
        nowMs() { return this.currentMs; },
        setNowMs(ms: number) { this.currentMs = ms; },
      };
      const decisionBarIndex = { value: 0 };
      const nowMs = () => replayClock.nowMs();
      const parentRepository = createPostgresOrderRepository(db);
      const parentFill = vi.spyOn(parentRepository, "recordFill");
      const parentProgress = vi.spyOn(parentRepository, "recordFillProgress");
      const parentLifecycleRepository = createPostgresLifecycleRepository(db);
      const parentLifecycleRecorder = createLifecycleRecorder({
        repository: parentLifecycleRepository,
      });
      const parentLifecycleWrite = vi.spyOn(parentLifecycleRecorder, "recordFillLifecycle");
      const parentKillSwitch = createKillSwitchResolver({
        repository: createPostgresKillSwitchRepository(db),
        nowMs,
      });
      const input: RunResearchPipelineInput = {
        context: seeded.context,
        datasetName: "unused-historical-runtime-binding",
        symbol: "BTC/USDT",
        interval: "1m",
        strategyId: "dee540_max_pool",
        strategyVersion: "historical-runtime",
        deps: {
          execution: createOrderExecutionServiceFromDeps({
            riskEngine: createPostgresRiskEngineService(db, { nowMs }),
            orderRepository: parentRepository,
            killSwitchResolver: parentKillSwitch,
            connectorForMode: () => new MockExchangeConnector({ nowMs }),
            writeAudit: (audit) => writeTraderAuditLogPostgres(db, audit),
            nowMs,
            lifecycleRecorder: parentLifecycleRecorder,
            historicalExecution: {
              enabled: true,
              model: profile.model,
              exchange: profile.exchange,
              getDecisionBarIndex: () => decisionBarIndex.value,
              getReplayNowMs: nowMs,
            },
          }),
          reconciliation: createPostgresReconciliationService(db),
          lifecycleRecorder: parentLifecycleRecorder,
          lifecycleRepository: parentLifecycleRepository,
          researchReplayDeterminism: {
            clock: replayClock,
            resetWindowState: () => undefined,
            setDecisionBarIndex: (index) => { decisionBarIndex.value = index; },
            getDecisionBarIndex: () => decisionBarIndex.value,
            historicalExecutionSession: true,
          },
        },
        historicalExecutionProfile: profile,
        createOrderRepository: () => parentRepository,
      };
      const failure = new Error("rollback historical blind outcome");
      let insideFillCount = 0;
      let insideEconomicsCount = 0;
      let insideCancelled = false;
      try {
        await expect(
          commitDee540BlindHoldout(db, {
            blindDigest: seeded.blindDigest,
            context: seeded.context,
            candidate: seeded.candidate,
            datasetId: seeded.datasetId,
            blindBars: seeded.bars,
            expectedBlindDigest: seeded.blindDigest,
            runBacktest: async ({ executor }) => {
              const bound = bindBlindWindowToExecutor(input, executor);
              const scopedOrders = createPostgresOrderRepositoryFromExecutor(executor);
              const created = await scopedOrders.createOrder(seeded.context, {
                id: orderId,
                venue: "HTX",
                executionMode: "mock",
                symbol: "BTCUSDT",
                side: "buy",
                type: "market",
                quantity: "0.20000000",
                clientOrderId: `blind-historical-${orderId}`,
                idempotencyKey: `blind-historical-${orderId}`,
                riskDecisionId: crypto.randomUUID(),
              });
              const approved = await scopedOrders.transitionOrder(seeded.context, {
                orderId: created.id,
                expectedStateVersion: created.stateVersion,
                toState: "RISK_APPROVED",
              });
              const sent = await scopedOrders.transitionOrder(seeded.context, {
                orderId: approved.id,
                expectedStateVersion: approved.stateVersion,
                toState: "SENT_TO_EXCHANGE",
              });
              const accepted = await scopedOrders.transitionOrder(seeded.context, {
                orderId: sent.id,
                expectedStateVersion: sent.stateVersion,
                toState: "ACCEPTED",
              });
              const partial = await bound.deps.execution.recordSimulatedFill!(
                seeded.context,
                accepted,
                {
                  orderId,
                  organizationId: seeded.context.organizationId,
                  symbol: "BTCUSDT",
                  side: "buy",
                  fillSequence: 1,
                  sourceBarIndex: 1,
                  sourceBar: seeded.bars[0]!,
                  grossFillPrice: "64006",
                  sliceQuantity: "0.10000000",
                  remainingQuantityAfter: "0.10000000",
                  acceptedAt: new Date(seeded.bars[0]!.barOpenTime),
                  fillTimestamp: new Date(seeded.bars[0]!.barCloseTime),
                  submitLatencyMs: 50,
                  cancelLatencyMs: null,
                },
                true,
              );
              insideFillCount = (await scopedOrders.listFills(seeded.context, orderId)).length;
              insideEconomicsCount = (await executor.select()
                .from(pgSchema.traderFillExecutionEconomics)
                .where(eq(pgSchema.traderFillExecutionEconomics.organizationId, seeded.context.organizationId))).length;
              const cancelled = await bound.deps.execution.transitionOrderCancelled!(seeded.context, partial);
              insideCancelled = cancelled.state === "CANCELLED";
              throw failure;
            },
            readRepository: {
              getBlindValidationResultForCandidate: (context, candidateId) =>
                getBlindValidationResultForCandidatePostgres(db, context, candidateId),
            },
            bindRepository,
          }),
        ).rejects.toBe(failure);
        expect(insideFillCount).toBe(1);
        expect(insideEconomicsCount).toBe(1);
        expect(insideCancelled).toBe(true);
        expect(await parentRepository.getOrderById(seeded.context, orderId)).toBeNull();
        expect((await db.select().from(pgSchema.traderFills)
          .where(eq(pgSchema.traderFills.orderId, orderId)))).toHaveLength(0);
        expect((await db.select().from(pgSchema.traderFillExecutionEconomics)
          .where(eq(pgSchema.traderFillExecutionEconomics.orderId, orderId)))).toHaveLength(0);
        expect((await db.select().from(pgSchema.traderOrderEvents)
          .where(eq(pgSchema.traderOrderEvents.orderId, orderId)))).toHaveLength(0);
        expect(parentFill).not.toHaveBeenCalled();
        expect(parentProgress).not.toHaveBeenCalled();
        expect(parentLifecycleWrite).not.toHaveBeenCalled();
        expect(await dee540BarContentConsumed(db, seeded.blindDigest)).toBe(true);
      } finally {
        parentFill.mockRestore();
        parentProgress.mockRestore();
        parentLifecycleWrite.mockRestore();
      }
    })();
    work.catch(() => undefined);
    try {
      await withDeadline(work, DEADLINE_MS);
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 20_000);

  it("lets only one of two concurrent openers see the bars when the terminal insert throws", async () => {
    const first = await openPool();
    const second = await openPool();
    const work = (async () => {
      const seeded = await seedHoldout(first.db, "64003", "concurrent-terminal");
      let seen = 0;
      const open = (db: WaiaPostgresDb) =>
        commitDee540BlindHoldout(db, {
          blindDigest: seeded.blindDigest,
          context: seeded.context,
          candidate: seeded.candidate,
          datasetId: seeded.datasetId,
          blindBars: seeded.bars,
          expectedBlindDigest: seeded.blindDigest,
          runBacktest: async () => {
            seen += 1;
            await new Promise((resolve) => setTimeout(resolve, 200));
            return successMetrics();
          },
          readRepository: {
            getBlindValidationResultForCandidate: (context, candidateId) =>
              getBlindValidationResultForCandidatePostgres(db, context, candidateId),
          },
          bindRepository: (tx) => ({
            ...bindRepository(tx),
            insertBlindValidationResult: async () => {
              throw new Error("terminal insert failed");
            },
          }),
        });
      const settled = await Promise.allSettled([open(first.db), open(second.db)]);
      expect(seen).toBe(1);
      expect(settled.every((entry) => entry.status === "rejected")).toBe(true);
      const reasons = settled.map((entry) =>
        entry.status === "rejected" ? entry.reason : undefined,
      );
      expect(reasons.filter((reason) => reason instanceof ResearchOrchestratorError)).toEqual([
        expect.objectContaining({ code: "DEE540_AUTHORIZATION_ALREADY_CONSUMED" }),
      ]);
      expect(
        reasons.some(
          (reason) => reason instanceof Error && reason.message === "terminal insert failed",
        ),
      ).toBe(true);
      const consumed = await first.db
        .select()
        .from(pgSchema.traderDee540BarConsumption)
        .where(eq(pgSchema.traderDee540BarConsumption.blindDigest, seeded.blindDigest));
      expect(consumed).toHaveLength(1);
      const results = await first.db
        .select()
        .from(pgSchema.traderBlindValidationResults)
        .where(eq(pgSchema.traderBlindValidationResults.candidateId, seeded.candidate.id));
      expect(results).toHaveLength(0);
      await expect(
        commitDee540BlindHoldout(second.db, {
          blindDigest: seeded.blindDigest,
          context: seeded.context,
          candidate: seeded.candidate,
          datasetId: seeded.datasetId,
          blindBars: seeded.bars,
          expectedBlindDigest: seeded.blindDigest,
          runBacktest: async () => {
            seen += 1;
            return successMetrics();
          },
          readRepository: {
            getBlindValidationResultForCandidate: (context, candidateId) =>
              getBlindValidationResultForCandidatePostgres(second.db, context, candidateId),
          },
          bindRepository,
        }),
      ).rejects.toMatchObject({ code: "DEE540_AUTHORIZATION_ALREADY_CONSUMED" });
      expect(seen).toBe(1);
    })();
    work.catch(() => undefined);
    try {
      await withDeadline(work, DEADLINE_MS);
    } finally {
      await first.client.end({ timeout: 5 });
      await second.client.end({ timeout: 5 });
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
    "rejects a transaction handle at the public research pipeline boundary before querying bars",
    async () => {
      const { client, db } = await openPool();
      const work = (async () => {
        const prepared = await prepare(db, client, "outer-pipeline");
        const outerRollback = new Error("rollback outer transaction after root refusal");
        let pipelineError: unknown;
        let selectSpy: ReturnType<typeof vi.spyOn> | undefined;
        const createOrderRepository = vi.fn(() => {
          throw new Error("pipeline reached backtest setup before root check");
        });

        await expect(
          db.transaction(async (outerTx) => {
            selectSpy = vi.spyOn(outerTx, "select");
            try {
              await runResearchPipelinePostgres(outerTx as unknown as WaiaPostgresDb, {
                context: prepared.context,
                datasetName: prepared.datasetName,
                symbol: "BTC/USDT",
                interval: "1m",
                strategyId: "mean_reversion_v0",
                strategyVersion: prepared.strategyVersion,
                oosBarCount: 20,
                requireMultiRegimeCoverage: false,
                deps: prepared.deps,
                createOrderRepository,
                submitResearchMockOrders: true,
                newId: () => crypto.randomUUID(),
                pipelineBacktest: {
                  skipBlindTail: true,
                  enableReplayFusedContext: false,
                },
              });
            } catch (error) {
              pipelineError = error;
            }
            console.error(
              "DEE1160_PUBLIC_PIPELINE_ROOT_PROOF",
              JSON.stringify({
                transactionSelectCalls: selectSpy.mock.calls.length,
                orderRepositoryFactoryCalls: createOrderRepository.mock.calls.length,
                error:
                  pipelineError instanceof Error
                    ? { name: pipelineError.name, message: pipelineError.message }
                    : String(pipelineError),
              }),
            );
            throw outerRollback;
          }),
        ).rejects.toBe(outerRollback);

        expect(pipelineError).toMatchObject({
          message: expect.stringContaining("RESEARCH_ROOT_DATABASE_REQUIRED"),
        });
        expect(selectSpy).toHaveBeenCalledTimes(0);
        expect(createOrderRepository).not.toHaveBeenCalled();
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
            enableReplayFusedContext: false,
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
            enableReplayFusedContext: false,
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
              enableReplayFusedContext: false,
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
