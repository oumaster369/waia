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
import { createPostgresOrderRepositoryFromExecutor } from "@/lib/trader/execution/repository-adapters";
import { deleteMockExecutionArtifactsForOrgPostgres } from "@/lib/trader/execution/repository-postgres";
import type { Bar } from "@/lib/trader/intelligence/types";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { insertResearchDatasetPostgres } from "@/lib/trader/market-data/research-dataset-repository-postgres";
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
const USER_ID = "00000000-0000-4000-8000-0000000540b1";
const DEADLINE_MS = 8_000;

function buildBar(close: string): Bar {
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: "2026-06-22T09:40:00.000Z",
    barCloseTime: "2026-06-22T09:41:00.000Z",
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
  const digests: string[] = [];

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
    for (const digest of digests) {
      await client`delete from trader_dee540_bar_consumption where blind_digest = ${digest}`;
    }
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
        email: "dee540-max-pool@waia.invalid",
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
    const bars = [buildBar(close)];
    const blindDigest = computeBarSetDigest(bars);
    digests.push(blindDigest);
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
