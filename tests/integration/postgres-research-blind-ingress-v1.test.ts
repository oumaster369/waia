/** Synthetic PostgreSQL proofs for metadata-first dataset reads and DEE-540 ingress order. */
import { randomInt } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { insertMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import {
  computeBarSetDigest,
  sealResearchDataset,
  splitBarsThreeWay,
} from "@/lib/trader/market-data/research-dataset";
import { insertResearchDatasetPostgres } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import { createPostgresOrderRepository } from "@/lib/trader/execution";
import { createPostgresOrderRepositoryFromExecutor } from "@/lib/trader/execution/repository-adapters";
import {
  createPostgresLifecycleRepository,
  createPostgresLifecycleRepositoryFromExecutor,
} from "@/lib/trader/lifecycle/lifecycle-repository-postgres";
import {
  buildM9BlindAuthorizationScope,
  computeM9BlindAuthorizationDigest,
} from "@/lib/trader/research/m9-operator-authorization";
import { assertDee540BlindTailAuthorized } from "@/lib/trader/research/dee-540-blind-tail-gate";
import { dee540BarContentConsumed } from "@/lib/trader/research/dee-540-authorization-store";
import {
  computeM9DatasetSealPreviewPostgres,
  loadM9ResearchPayloadPostgres,
} from "@/lib/trader/research/m9-dataset-seal-preview";
import { runResearchPipelinePostgres } from "@/lib/trader/research/research-orchestrator";
import { buildHtrPostgresResearchSession } from "@/tests/integration/htr-postgres-fixture-prelude";
import { buildResearchIntegrationBars } from "@/tests/helpers/build-research-integration-bars";
import { deleteKnowledgeAuthorityRowsForOrg } from "@/tests/helpers/knowledge-authority-test-cleanup";
import {
  commitDee540BlindHoldout,
  type Dee540BlindPayloadCapability,
  type Dee540BlindTailExecutor,
} from "@/lib/trader/research/dee-540-blind-tail-commit";
import {
  getBlindValidationResultForCandidatePostgres,
  insertBlindValidationResultPostgres,
  markStrategyCandidateBlindUsedPostgres,
  registerStrategyCandidatePostgres,
  updateStrategyCandidateStatusPostgres,
} from "@/lib/trader/research/strategy-candidate-repository-postgres";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const databaseUrl = process.env.DATABASE_URL_POSTGRES?.trim();
const testUserId = crypto.randomUUID();
const runOffsetMinutes = randomInt(0, 15 * 365 * 24 * 60);
const queryLog: string[] = [];
const queryRecords: Array<{ query: string; params: unknown[] }> = [];
let organizationId: string;
let client: postgres.Sql;
let witnessClient: postgres.Sql | undefined;
let db: WaiaPostgresDb;
let fixtureSequence = 0;

function fixtureBars(offset: number, count = 10): Bar[] {
  const base = Date.UTC(2025, 0, 1, 0, 0) + runOffsetMinutes * 60_000 + offset * 86_400_000;
  return Array.from({ length: count }, (_, index) => {
    const open = base + index * 60_000;
    const close = String(100 + index);
    return {
      symbol: "BTC/USDT",
      interval: "1m",
      open: close,
      high: String(Number(close) + 1),
      low: String(Number(close) - 1),
      close,
      volume: "1",
      barOpenTime: new Date(open).toISOString(),
      barCloseTime: new Date(open + 60_000).toISOString(),
    };
  });
}

async function seedDataset(options: { forgedDigestIndex?: number; barCount?: number } = {}) {
  fixtureSequence += 1;
  const context = requireOrgContext(organizationId);
  const bars = fixtureBars(fixtureSequence, options.barCount);
  const stored = bars.map((bar, index) => ({
    bar,
    ...(index === options.forgedDigestIndex ? { contentDigest: "f".repeat(64) } : {}),
  }));
  await insertMarketBarsPostgres(db, context, stored);
  const sealed = sealResearchDataset(bars, splitBarsThreeWay(bars));
  const datasetId = crypto.randomUUID();
  await insertResearchDatasetPostgres(db, context, {
    id: datasetId,
    name: `blind-ingress-${fixtureSequence}`,
    symbol: "BTC/USDT",
    interval: "1m",
    sealed,
  });
  return { context, bars, sealed, datasetId };
}

async function seedPipelineBars() {
  fixtureSequence += 1;
  const context = requireOrgContext(organizationId);
  const bars = buildResearchIntegrationBars();
  await insertMarketBarsPostgres(db, context, bars.map(bar => ({ bar })));
  return { context, bars };
}

function campaignGrant(context: OrgContext, blindDigest: string) {
  const campaignScope = {
    organizationId: context.organizationId,
    strategyId: "synthetic_blind_ingress",
    strategyVersion: "1.0.0",
    symbol: "BTC/USDT",
    interval: "1m",
    vaultDir: "synthetic-only",
    metricsSchemaVersion: "1.0.0",
  };
  const blindAuthorizationScope = buildM9BlindAuthorizationScope({
    campaignScope,
    datasetName: "synthetic-blind-ingress",
    blindDigest,
  });
  const operatorBlindAuthorization = computeM9BlindAuthorizationDigest(blindAuthorizationScope);
  return assertDee540BlindTailAuthorized({ operatorBlindAuthorization, blindAuthorizationScope });
}

async function seedCandidate(context: OrgContext, datasetId: string) {
  const candidate = await registerStrategyCandidatePostgres(db, context, {
    id: crypto.randomUUID(),
    strategyId: `blind-ingress-${fixtureSequence}`,
    strategyVersion: "1.0.0",
    paramsJson: "{}",
    status: "walk_forward_validated",
  });
  return { candidate, datasetId };
}

const successMetrics: ResearchValidationMetrics = {
  schemaVersion: "1.0.0",
  tradeCount: 0,
  periodRealizedPnl: "0",
  periodTotalFees: "0",
  byRegime: [],
};

function selectsOhlcvPayload(query: string): boolean {
  const projection = query.split(/\bfrom\b/i)[0] ?? "";
  return /(?:^|[\s",.])(?:open|high|low|close|volume)(?=$|[\s",])/i.test(projection);
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

async function cleanupFixtureData(): Promise<void> {
  if (!client || !organizationId) return;
  await client.unsafe(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_block_delete`);
  await client.unsafe(
    `DELETE FROM audit_logs WHERE organization_id = $1 OR entity_id IN (
      SELECT id::text FROM trader_strategy_promotion_records WHERE organization_id = $1
    )`,
    [organizationId],
  );
  await client.unsafe(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_block_delete`);
  await deleteKnowledgeAuthorityRowsForOrg(client, organizationId);
  await client`delete from trader_market_events where organization_id = ${organizationId}`;
  await client`delete from trader_blind_validation_results where organization_id = ${organizationId}`;
  await client`delete from trader_walk_forward_windows where organization_id = ${organizationId}`;
  await client`delete from trader_strategy_candidates where organization_id = ${organizationId}`;
  await client`delete from trader_backtest_results where organization_id = ${organizationId}`;
  await client`delete from trader_backtest_runs where organization_id = ${organizationId}`;
  await client`delete from research_dataset where organization_id = ${organizationId}`;
  await client`delete from trader_fills where organization_id = ${organizationId}`;
  await client`delete from trader_order_events where organization_id = ${organizationId}`;
  await client`delete from trader_orders where organization_id = ${organizationId}`;
  await client`delete from trader_strategy_promotion_records where organization_id = ${organizationId}`;
  await client`delete from trader_market_bars where organization_id = ${organizationId}`;
}

describe.skipIf(!enabled || !databaseUrl)("synthetic research blind ingress PostgreSQL contract", () => {
  beforeAll(async () => {
    await cleanupWp13Org(databaseUrl!, testUserId);
    organizationId = await seedWp13User(databaseUrl!, testUserId, "Blind ingress synthetic fixture");
    client = postgres(databaseUrl!, {
      max: 1,
      debug: (_connection, query) => queryLog.push(query),
    });
    db = drizzle(client, {
      schema: pgSchema,
      logger: { logQuery: (query, params) => queryRecords.push({ query, params }) },
    }) as WaiaPostgresDb;
  });

  beforeEach(async () => {
    queryLog.length = 0;
    queryRecords.length = 0;
    await cleanupFixtureData();
  });

  afterAll(async () => {
    await cleanupFixtureData();
    await witnessClient?.end({ timeout: 5 });
    await client?.end({ timeout: 5 });
    if (organizationId) await cleanupWp13Org(databaseUrl!, testUserId);
  });

  it("previews metadata only and matches the legacy deterministic seal", async () => {
    const fixture = await seedDataset();
    queryLog.length = 0;
    const preview = await computeM9DatasetSealPreviewPostgres(db, fixture.context, {
      symbol: "BTC/USDT",
      interval: "1m",
    });
    const metadataQuery = queryLog.find(query => /from\s+["`]?trader_market_bars/i.test(query));
    expect(metadataQuery).toBeDefined();
    const projection = metadataQuery!.split(/\bfrom\b/i)[0]!;
    expect(selectsOhlcvPayload(projection)).toBe(false);
    expect(preview.barCount).toBe(fixture.bars.length);

    const legacySeal = sealResearchDataset(fixture.bars, splitBarsThreeWay(fixture.bars));
    expect(preview.contentDigest).toBe(computeBarSetDigest(fixture.bars));
    expect(preview.sealed).toMatchObject({
      trainBarCount: legacySeal.trainBarCount,
      validationBarCount: legacySeal.validationBarCount,
      blindBarCount: legacySeal.blindBarCount,
      trainDigest: legacySeal.trainDigest,
      validationDigest: legacySeal.validationDigest,
      blindDigest: legacySeal.blindDigest,
    });
  });

  it("reads only the requested half-open nonblind and validation ranges", async () => {
    const fixture = await seedDataset();
    const preview = await computeM9DatasetSealPreviewPostgres(db, fixture.context, {
      symbol: "BTC/USDT",
      interval: "1m",
    });
    queryLog.length = 0;
    const nonblind = await loadM9ResearchPayloadPostgres(db, fixture.context, preview, {
      partition: "nonblind",
    });
    const nonblindQuery = queryLog.find(query => /select[\s\S]*from\s+["`]?trader_market_bars/i.test(query));
    expect(nonblind).toEqual(fixture.bars.slice(0, 8));
    expect(nonblindQuery).toMatch(/bar_open_time[\s\S]*>=/i);
    expect(nonblindQuery).toMatch(/bar_open_time[\s\S]*</i);
    expect(nonblind.some(bar => bar.barOpenTime >= fixture.bars[8]!.barOpenTime)).toBe(false);

    queryLog.length = 0;
    const validation = await loadM9ResearchPayloadPostgres(db, fixture.context, preview, {
      partition: "validation",
    });
    expect(validation).toEqual(fixture.bars.slice(6, 8));
    expect(validation).toHaveLength(preview.sealed.validationBarCount);
  });

  it("rejects a well-formed but forged stored content hash against actual OHLCV", async () => {
    const fixture = await seedDataset({ forgedDigestIndex: 0 });
    const preview = await computeM9DatasetSealPreviewPostgres(db, fixture.context, {
      symbol: "BTC/USDT",
      interval: "1m",
    });
    await expect(loadM9ResearchPayloadPostgres(db, fixture.context, preview, {
      partition: "nonblind",
    })).rejects.toThrow("M9_PAYLOAD_COMMITMENT_MISMATCH");
  });

  it.each(["insert", "replace", "delete"] as const)(
    "refuses an exact-tuple/count mismatch after a %s race",
    async mutation => {
      const fixture = await seedDataset();
      const preview = await computeM9DatasetSealPreviewPostgres(db, fixture.context, {
        symbol: "BTC/USDT",
        interval: "1m",
      });
      const first = fixture.bars[0]!;
      if (mutation === "insert") {
        const openMs = Date.parse(first.barOpenTime) + 30_000;
        const bar: Bar = {
          ...first,
          open: "1000", high: "1001", low: "999", close: "1000",
          barOpenTime: new Date(openMs).toISOString(),
          barCloseTime: new Date(openMs + 60_000).toISOString(),
        };
        await insertMarketBarsPostgres(db, fixture.context, [{ bar }]);
      } else if (mutation === "replace") {
        await client`update trader_market_bars set open = '1000', high = '1001', low = '999', close = '1000'
          where organization_id = ${organizationId} and symbol = 'BTC/USDT'
            and interval = '1m' and bar_open_time = ${first.barOpenTime}::timestamptz`;
      } else {
        await client`delete from trader_market_bars where organization_id = ${organizationId}
          and symbol = 'BTC/USDT' and interval = '1m' and bar_open_time = ${first.barOpenTime}::timestamptz`;
      }
      await expect(loadM9ResearchPayloadPostgres(db, fixture.context, preview, {
        partition: "nonblind",
      })).rejects.toThrow("M9_PAYLOAD_COMMITMENT_MISMATCH");
    },
  );

  it("requires authorization and an active invocation capability before blind payload SQL", async () => {
    const fixture = await seedDataset();
    const preview = await computeM9DatasetSealPreviewPostgres(db, fixture.context, {
      symbol: "BTC/USDT",
      interval: "1m",
    });
    const grant = campaignGrant(fixture.context, preview.sealed.blindDigest);
    queryLog.length = 0;
    await expect(loadM9ResearchPayloadPostgres(db, fixture.context, preview, {
      partition: "blind",
      grant,
      capability: {} as Dee540BlindPayloadCapability,
    })).rejects.toThrow("DEE540_ACTIVE_BLIND_PAYLOAD_CAPABILITY_REQUIRED");
    await expect(loadM9ResearchPayloadPostgres(db, fixture.context, preview, {
      partition: "blind",
    } as never)).rejects.toMatchObject({ code: "DEE540_BLIND_TAIL_AUTHORIZATION_REQUIRED" });
    expect(queryLog.some(query =>
      /trader_market_bars/i.test(query) && selectsOhlcvPayload(query))).toBe(false);
  });

  it("witnesses the committed burn inside the lazy loader before blind payload SQL", async () => {
    const fixture = await seedDataset();
    const preview = await computeM9DatasetSealPreviewPostgres(db, fixture.context, {
      symbol: "BTC/USDT",
      interval: "1m",
    });
    const { candidate } = await seedCandidate(fixture.context, fixture.datasetId);
    const grant = campaignGrant(fixture.context, preview.sealed.blindDigest);
    let loadCalls = 0;
    let burnWitnessed = false;
    let capturedCapability: Dee540BlindPayloadCapability | undefined;
    let capturedExecutor: Dee540BlindTailExecutor | undefined;
    witnessClient = postgres(databaseUrl!, { max: 1 });
    const witnessDb = drizzle(witnessClient, { schema: pgSchema }) as WaiaPostgresDb;
    queryLog.length = 0;

    const outcome = await commitDee540BlindHoldout(db, {
      blindDigest: preview.sealed.blindDigest,
      context: fixture.context,
      candidate,
      datasetId: fixture.datasetId,
      expectedBlindDigest: preview.sealed.blindDigest,
      loadBlindBars: async (tx, capability) => {
        loadCalls += 1;
        capturedCapability = capability;
        capturedExecutor = tx;
        // Independent connection visibility proves the consume committed before any payload read.
        burnWitnessed = await dee540BarContentConsumed(witnessDb, preview.sealed.blindDigest);
        expect(burnWitnessed).toBe(true);
        const request = {
          partition: "blind",
          grant,
          capability,
        } as const;
        await expect(loadM9ResearchPayloadPostgres(witnessDb, fixture.context, preview, request))
          .rejects.toThrow("DEE540_ACTIVE_BLIND_PAYLOAD_CAPABILITY_REQUIRED");
        const bars = await loadM9ResearchPayloadPostgres(tx, fixture.context, preview, request);
        await expect(loadM9ResearchPayloadPostgres(tx, fixture.context, preview, request))
          .rejects.toThrow("DEE540_ACTIVE_BLIND_PAYLOAD_CAPABILITY_REQUIRED");
        return bars;
      },
      runBacktest: async ({ bars }) => {
        expect(bars).toEqual(fixture.bars.slice(8));
        return successMetrics;
      },
      readRepository: {
        getBlindValidationResultForCandidate: (context, candidateId) =>
          getBlindValidationResultForCandidatePostgres(db, context, candidateId),
      },
      bindRepository,
    });

    expect(outcome.metrics).toEqual(successMetrics);
    expect(loadCalls).toBe(1);
    expect(burnWitnessed).toBe(true);
    const committedBurn = queryLog.findIndex(query => /^commit\b/i.test(query.trim()));
    const payloadRead = queryLog.findIndex(query =>
      /trader_market_bars/i.test(query) && selectsOhlcvPayload(query));
    expect(committedBurn).toBeGreaterThanOrEqual(0);
    expect(payloadRead).toBeGreaterThan(committedBurn);
    await expect(loadM9ResearchPayloadPostgres(capturedExecutor!, fixture.context, preview, {
      partition: "blind",
      grant,
      capability: capturedCapability!,
    })).rejects.toThrow("DEE540_ACTIVE_BLIND_PAYLOAD_CAPABILITY_REQUIRED");
  });

  it("keeps the burn after a post-burn payload failure and never invokes a retry loader", async () => {
    const fixture = await seedDataset();
    const preview = await computeM9DatasetSealPreviewPostgres(db, fixture.context, {
      symbol: "BTC/USDT",
      interval: "1m",
    });
    const { candidate } = await seedCandidate(fixture.context, fixture.datasetId);
    const grant = campaignGrant(fixture.context, preview.sealed.blindDigest);
    let loadCalls = 0;
    const request = {
      blindDigest: preview.sealed.blindDigest,
      context: fixture.context,
      candidate,
      datasetId: fixture.datasetId,
      expectedBlindDigest: preview.sealed.blindDigest,
      loadBlindBars: async (tx: Dee540BlindTailExecutor) => {
        loadCalls += 1;
        expect(await dee540BarContentConsumed(tx, preview.sealed.blindDigest)).toBe(true);
        await tx.execute(sql.raw("SELECT * FROM dee1159_missing_synthetic_payload_table"));
        throw new Error("the missing synthetic table query unexpectedly succeeded");
      },
      runBacktest: async () => successMetrics,
      readRepository: {
        getBlindValidationResultForCandidate: (context: OrgContext, candidateId: string) =>
          getBlindValidationResultForCandidatePostgres(db, context, candidateId),
      },
      bindRepository,
    };
    await expect(commitDee540BlindHoldout(db, request)).rejects.toThrow(
      "dee1159_missing_synthetic_payload_table",
    );
    expect(await dee540BarContentConsumed(db, preview.sealed.blindDigest)).toBe(true);
    const terminal = await getBlindValidationResultForCandidatePostgres(
      db, fixture.context, candidate.id,
    );
    expect(JSON.parse(terminal!.metricsJson)).toMatchObject({
      schemaVersion: "dee540_blind_terminal_v1",
      outcome: "error",
      phase: "payload_read",
    });
    await expect(commitDee540BlindHoldout(db, request)).rejects.toThrow();
    expect(loadCalls).toBe(1);
    expect(grant.blindAuthorizationScope.blindDigest).toBe(preview.sealed.blindDigest);
  });

  it("records a terminal result when success-result insertion fails after the burn", async () => {
    const fixture = await seedDataset();
    const preview = await computeM9DatasetSealPreviewPostgres(db, fixture.context, {
      symbol: "BTC/USDT",
      interval: "1m",
    });
    const { candidate } = await seedCandidate(fixture.context, fixture.datasetId);
    const grant = campaignGrant(fixture.context, preview.sealed.blindDigest);
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const functionName = `dee1159_reject_success_${suffix}`;
    const triggerName = `dee1159_reject_success_${suffix}`;
    const orderId = crypto.randomUUID();
    const lifecycleEventId = crypto.randomUUID();
    const lifecycleEntityId = crypto.randomUUID();
    let loadCalls = 0;
    const request = {
      blindDigest: preview.sealed.blindDigest,
      context: fixture.context,
      candidate,
      datasetId: fixture.datasetId,
      expectedBlindDigest: preview.sealed.blindDigest,
      loadBlindBars: async (tx: Dee540BlindTailExecutor, capability: Dee540BlindPayloadCapability) => {
        loadCalls += 1;
        return loadM9ResearchPayloadPostgres(tx, fixture.context, preview, {
          partition: "blind", grant, capability,
        });
      },
      runBacktest: async ({ executor }: { executor: Dee540BlindTailExecutor }) => {
        const orders = createPostgresOrderRepositoryFromExecutor(executor);
        const lifecycle = createPostgresLifecycleRepositoryFromExecutor(executor);
        await orders.createOrder(fixture.context, {
          id: orderId,
          venue: "htx",
          executionMode: "mock",
          symbol: "BTC/USDT",
          side: "buy",
          type: "market",
          quantity: "1",
          clientOrderId: `blind-result-fault-${suffix}`,
          idempotencyKey: `blind-result-fault-${suffix}`,
          riskDecisionId: `blind-result-fault-${suffix}`,
        });
        await lifecycle.insertLifecycleEvent(fixture.context, {
          event: {
            id: lifecycleEventId,
            organizationId: fixture.context.organizationId,
            entityType: "STRATEGY_SIGNAL",
            entityId: lifecycleEntityId,
            phase: "SIGNAL_ACCEPTED",
            payload: null,
            occurredAt: new Date(fixture.bars[0]!.barCloseTime),
            researchRunId: null,
          },
        });
        expect(await orders.getOrderById(fixture.context, orderId)).not.toBeNull();
        expect(await lifecycle.listLifecycleEvents(fixture.context, {
          entityType: "STRATEGY_SIGNAL",
          entityId: lifecycleEntityId,
        })).toHaveLength(1);
        return successMetrics;
      },
      readRepository: {
        getBlindValidationResultForCandidate: (context: OrgContext, candidateId: string) =>
          getBlindValidationResultForCandidatePostgres(db, context, candidateId),
      },
      bindRepository,
    };

    try {
      await client.unsafe(`CREATE FUNCTION public.${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.metrics_json NOT LIKE '%"schemaVersion":"dee540_blind_terminal_v1"%' THEN
            RAISE EXCEPTION 'synthetic_success_insert_refused';
          END IF;
          RETURN NEW;
        END $$`);
      await client.unsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON public.trader_blind_validation_results
        FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`);

      await expect(commitDee540BlindHoldout(db, request)).rejects.toThrow(
        "synthetic_success_insert_refused",
      );
      expect(await dee540BarContentConsumed(db, preview.sealed.blindDigest)).toBe(true);
      const terminal = await getBlindValidationResultForCandidatePostgres(
        db, fixture.context, candidate.id,
      );
      expect(JSON.parse(terminal!.metricsJson)).toMatchObject({
        schemaVersion: "dee540_blind_terminal_v1",
        outcome: "error",
        phase: "result_insert",
      });
      expect(await createPostgresOrderRepository(db).getOrderById(fixture.context, orderId)).toBeNull();
      expect(await createPostgresLifecycleRepository(db).listLifecycleEvents(fixture.context, {
        entityType: "STRATEGY_SIGNAL",
        entityId: lifecycleEntityId,
      })).toHaveLength(0);
      await expect(commitDee540BlindHoldout(db, request)).rejects.toThrow();
      expect(loadCalls).toBe(1);
    } finally {
      await client.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON public.trader_blind_validation_results`);
      await client.unsafe(`DROP FUNCTION IF EXISTS public.${functionName}()`);
    }
  });

  it("fails an ungranted pipeline request after metadata only and before any OHLCV read", async () => {
    const fixture = await seedDataset({ barCount: 60 });
    queryLog.length = 0;
    await expect(runResearchPipelinePostgres(db, {
      context: fixture.context,
      datasetName: "synthetic-unauthorized-pipeline",
      symbol: "BTC/USDT",
      interval: "1m",
      strategyId: "synthetic-unauthorized",
      strategyVersion: "1.0.0",
      deps: {} as never,
      createOrderRepository: () => { throw new Error("unreachable before authorization"); },
      pipelineBacktest: {},
    })).rejects.toMatchObject({ code: "DEE540_BLIND_TAIL_AUTHORIZATION_REQUIRED" });
    const marketBarQueries = queryLog.filter(query => /from\s+["`]?trader_market_bars/i.test(query));
    expect(marketBarQueries.length).toBeGreaterThan(0);
    expect(marketBarQueries.every(query => !selectsOhlcvPayload(query))).toBe(true);
  });

  it("skipBlindTail reads validation only and leaves the full-evidence gate closed", async () => {
    const fixture = await seedPipelineBars();
    const preview = await computeM9DatasetSealPreviewPostgres(db, fixture.context, {
      symbol: "BTC/USDT",
      interval: "1m",
    });
    const blindStart = preview.commitments[
      preview.sealed.trainBarCount + preview.sealed.validationBarCount
    ]!.barOpenTime;
    const session = await buildHtrPostgresResearchSession(db, organizationId, {
      replayNamespaceSeed: 915_153,
    });
    queryLog.length = 0;
    queryRecords.length = 0;

    // This legacy pipeline still requires a blind-validated candidate at the final
    // provenance gate. skipBlindTail avoids blind payload access, so the run must
    // stop there rather than fabricate a completed evidence result.
    await expect(runResearchPipelinePostgres(db, {
      context: fixture.context,
      datasetName: `blind-ingress-skip-${fixtureSequence}`,
      symbol: "BTC/USDT",
      interval: "1m",
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: `0.1.${fixtureSequence}`,
      oosBarCount: 20,
      requireMultiRegimeCoverage: false,
      deps: session.deps,
      historicalExecutionProfile: session.historicalExecutionProfile,
      createOrderRepository: () => createPostgresOrderRepository(db),
      submitResearchMockOrders: true,
      newId: () => crypto.randomUUID(),
      pipelineBacktest: { skipBlindTail: true, enableReplayFusedContext: false },
    })).rejects.toMatchObject({ code: "RESEARCH_EVIDENCE_CANDIDATE_STATUS_INVALID" });
    const payloadReads = queryRecords.filter(({ query }) =>
      /select[\s\S]*from\s+["`]?trader_market_bars/i.test(query) && selectsOhlcvPayload(query));
    expect(payloadReads).toHaveLength(1);
    const payloadRead = payloadReads[0]!;
    expect(payloadRead.query).toMatch(/bar_open_time[\s\S]*>=/i);
    expect(payloadRead.query).toMatch(/bar_open_time[\s\S]*</i);
    const normalizedParams = payloadRead.params.map(value =>
      value instanceof Date ? value.toISOString() : String(value));
    expect(normalizedParams).toContain(blindStart);
    expect(queryRecords.some(({ query }) => /trader_dee540_bar_consumption/i.test(query))).toBe(false);

    const queriesDuringRun = [...queryRecords];
    expect(await dee540BarContentConsumed(db, preview.sealed.blindDigest)).toBe(false);
    expect(queriesDuringRun.some(({ query }) => /trader_dee540_bar_consumption/i.test(query))).toBe(false);
  }, 180_000);
});
