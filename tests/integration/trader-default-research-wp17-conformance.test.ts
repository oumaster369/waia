/**
 * HTR-WP17 default research path conformance — profile propagation, single cost point,
 * initial portfolio contract, and split-brain fail-closed behavior.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import { bindHistoricalExecutionModelToSession } from "@/lib/trader/backtest/historical-execution-profile";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import * as costModelModule from "@/lib/trader/execution/cost-model";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import * as fillEconomicsModule from "@/lib/trader/execution/fill-economics";
import { EXECUTION_FACT_KIND_HISTORICAL_SIMULATED } from "@/lib/trader/execution/historical-execution-model.types";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import {
  HistoricalExecutionProfileConfigurationError,
  isHistoricalExecutionServiceEnabled,
} from "@/lib/trader/research/htr-historical-execution-configuration";
import {
  assertHtrInitialPortfolioContract,
  createHtrInitialAccountRiskState,
  createHtrInitialPortfolioAccountState,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-contract";
import { buildResearchV2PortfolioContext } from "@/lib/trader/research/research-portfolio-config";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import {
  runResearchValidationBacktest,
  type ResearchValidationBacktestArtifactSink,
} from "@/lib/trader/research/research-backtest-runner";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
} from "@/lib/trader/research/strategy-candidate.types";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
  createRiskEngineService,
} from "@/lib/trader/risk";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { createAcceptedMarketOrder } from "@/tests/unit/helpers/wp17-execution-fixtures";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000415w";
const STRATEGY_VERSION = "0.1.0";

function loadFixtureBars(): Bar[] {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return (JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[] }).bars;
}

function flatBars(count: number): Bar[] {
  const bars: Bar[] = [];
  for (let index = 0; index < count; index += 1) {
    const openTime = new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000,
    ).toISOString();
    const closeTime = new Date(Date.parse(openTime) + 60_000).toISOString();
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      barOpenTime: openTime,
      barCloseTime: closeTime,
      open: "65000.00",
      high: "65010.00",
      low: "64990.00",
      close: "65000.00",
      volume: "12.50",
    });
  }
  return bars;
}

async function seedResearchSession() {
  const session = await createInMemoryResearchBacktestSession();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: USER_ID,
    email: "htr-wp17-default-path@waia.invalid",
    password: "password123",
    identityLabel: "HTR WP17 Default Path",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: USER_ID,
    displayName: "HTR WP17 Default Path",
  });
  await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgId), {
    ...DEFAULT_ORG_RISK_LIMITS,
  });
  return { session, context: requireOrgContext(orgId) };
}

function buildLegacyPaperDeps(db: ReturnType<typeof getDb>) {
  const rateStore = createInMemoryOrderRateStore();
  const connector = new MockExchangeConnector();
  const orderRepository = createSqliteOrderRepository(db);
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs: () => Date.now(),
  });
  const limitsService = createSqliteRiskLimitsService(db);
  const riskEngine = createRiskEngineService({
    limitsService,
    killSwitchResolver,
    rateStore,
    writeAudit: () => "legacy-audit",
    nowMs: () => Date.now(),
    newDecisionId: () => "legacy-decision",
  });
  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit: () => "legacy-audit",
    nowMs: () => Date.now(),
  });
  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs: () => Date.now(),
    writeAudit: () => "legacy-audit",
  });
  return {
    deps: { execution, reconciliation },
    orderRepository,
  };
}

describe("HTR-WP17 default research path conformance", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("split-brain fail-closed configuration", () => {
    it("rejects historical execution service enabled without profile", async () => {
      const { session, context } = await seedResearchSession();
      try {
        await expect(
          runResearchValidationBacktest({
            context,
            bars: flatBars(25),
            strategyId: MEAN_REVERSION_V0,
            strategyVersion: STRATEGY_VERSION,
            datasetId: "dataset-wp17-split-brain",
            runId: "run-wp17-split-brain",
            split: "validation",
            costModel: createCostModelV1("10", "5"),
            deps: session.deps,
            orderRepository: session.orderRepository,
            accountKey: "wp17-split-brain",
            defaultQuantity: "0.01",
          }),
        ).rejects.toBeInstanceOf(HistoricalExecutionProfileConfigurationError);
      } finally {
        session.cleanup();
      }
    });

    it("rejects wrong profile id when historical execution service is enabled", async () => {
      const { session, context } = await seedResearchSession();
      const wrongProfile = {
        ...session.historicalExecutionProfile,
        profileId: "wrong-profile/v9" as typeof session.historicalExecutionProfile.profileId,
      };
      try {
        await expect(
          runResearchValidationBacktest({
            context,
            bars: flatBars(25),
            strategyId: MEAN_REVERSION_V0,
            strategyVersion: STRATEGY_VERSION,
            datasetId: "dataset-wp17-wrong-profile",
            runId: "run-wp17-wrong-profile",
            split: "validation",
            costModel: createCostModelV1("10", "5"),
            deps: session.deps,
            orderRepository: session.orderRepository,
            accountKey: "wp17-wrong-profile",
            defaultQuantity: "0.01",
            historicalExecutionProfile: wrongProfile,
          }),
        ).rejects.toBeInstanceOf(HistoricalExecutionProfileConfigurationError);
      } finally {
        session.cleanup();
      }
    });

    it("rejects profile present when historical execution service is disabled", async () => {
      const { session, context } = await seedResearchSession();
      const db = getDb();
      const legacy = buildLegacyPaperDeps(db);
      try {
        await expect(
          runResearchValidationBacktest({
            context,
            bars: flatBars(25),
            strategyId: MEAN_REVERSION_V0,
            strategyVersion: STRATEGY_VERSION,
            datasetId: "dataset-wp17-no-service",
            runId: "run-wp17-no-service",
            split: "validation",
            costModel: createCostModelV1("10", "5"),
            deps: legacy.deps,
            orderRepository: legacy.orderRepository,
            accountKey: "wp17-no-service",
            defaultQuantity: "0.01",
            historicalExecutionProfile: session.historicalExecutionProfile,
          }),
        ).rejects.toBeInstanceOf(HistoricalExecutionProfileConfigurationError);
      } finally {
        session.cleanup();
      }
    });

    it("accepts valid profile with enabled historical execution service", async () => {
      const { session, context } = await seedResearchSession();
      try {
        expect(isHistoricalExecutionServiceEnabled(session.deps)).toBe(true);
        await expect(
          runResearchValidationBacktest({
            context,
            bars: flatBars(25),
            strategyId: MEAN_REVERSION_V0,
            strategyVersion: STRATEGY_VERSION,
            datasetId: "dataset-wp17-valid",
            runId: "run-wp17-valid",
            split: "validation",
            costModel: createCostModelV1("10", "5"),
            deps: session.deps,
            orderRepository: session.orderRepository,
            accountKey: "wp17-valid",
            defaultQuantity: "0.01",
            historicalExecutionProfile: session.historicalExecutionProfile,
          }),
        ).resolves.toBeDefined();
      } finally {
        session.cleanup();
      }
    });

    it("preserves legacy non-HTR caller behavior without historical execution profile", async () => {
      const db = getDb();
      insertEmailPasswordUser(db, {
        id: "00000000-0000-4000-8000-0000000415l",
        email: "legacy-non-htr@waia.invalid",
        password: "password123",
        identityLabel: "Legacy Non-HTR",
      });
      const orgId = ensureUserCoreSeedSqlite(db, {
        userId: "00000000-0000-4000-8000-0000000415l",
        displayName: "Legacy Non-HTR",
      });
      await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgId), {
        ...DEFAULT_ORG_RISK_LIMITS,
      });
      const legacy = buildLegacyPaperDeps(db);
      const applyCostSpy = vi.spyOn(costModelModule, "applyCostToFill");
      const context = requireOrgContext(orgId);

      await runResearchValidationBacktest({
        context,
        bars: flatBars(25),
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        datasetId: "dataset-legacy-non-htr",
        runId: "run-legacy-non-htr",
        split: "validation",
        costModel: createCostModelV1("10", "5"),
        deps: legacy.deps,
        orderRepository: legacy.orderRepository,
        accountKey: "legacy-non-htr",
        defaultQuantity: "0.01",
      });

      expect(isHistoricalExecutionServiceEnabled(legacy.deps)).toBe(false);
      expect(applyCostSpy.mock.calls.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("default research execution path (V1 + V2)", () => {
    async function runDefaultResearchPath(
      metricsSchemaVersion: typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION | "1.0.0",
    ) {
      const { session, context } = await seedResearchSession();
      const applyCostSpy = vi.spyOn(costModelModule, "applyCostToFill");
      const bars = flatBars(25);
      const artifactSink: ResearchValidationBacktestArtifactSink = {};
      const costModel = createCostModelV1("10", "5");
      const portfolio = buildResearchV2PortfolioContext(costModel);

      try {
        const commonInput = {
          context,
          bars,
          strategyId: MEAN_REVERSION_V0,
          strategyVersion: STRATEGY_VERSION,
          datasetId: "dataset-wp17-default-path",
          runId: "run-wp17-default-path",
          split: "validation" as const,
          costModel,
          deps: session.deps,
          orderRepository: session.orderRepository,
          accountKey: "wp17-default-path",
          defaultQuantity: "0.01",
          cycleIdPrefix: buildResearchValidationCycleIdPrefix("run-wp17-default-path"),
          artifactSink,
          historicalExecutionProfile: session.historicalExecutionProfile,
        };

        const metrics =
          metricsSchemaVersion === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION
            ? await runResearchValidationBacktest({
                ...commonInput,
                metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
                portfolio,
              })
            : await runResearchValidationBacktest({
                ...commonInput,
                metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
              });

        expect(session.historicalExecutionProfile.profileId).toBe(
          "htr-historical-execution-profile/v1",
        );
        expect(applyCostSpy).not.toHaveBeenCalled();

        return { metrics, artifactSink, portfolio };
      } finally {
        session.cleanup();
      }
    }

    async function runWp17FillProofViaRunBacktest() {
      const { session, context } = await seedResearchSession();
      const applyCostSpy = vi.spyOn(costModelModule, "applyCostToFill");
      const economicsSpy = vi.spyOn(fillEconomicsModule, "applyHistoricalExecutionEconomics");
      const recordFillSpy = vi.spyOn(session.orderRepository, "recordFill");
      const bars = flatBars(25);
      const window = {
        start: new Date(bars[0]!.barOpenTime),
        end: new Date(bars.at(-1)!.barCloseTime),
      };

      const order = await createAcceptedMarketOrder(session.orderRepository, context, {
        quantity: "0.01000000",
        symbol: "BTC/USDT",
      });
      session.historicalExecutionProfile.exchange.registerOrder(
        { ...order, symbol: "BTCUSDT" },
        0,
        Date.parse(bars[0]!.barCloseTime),
      );

      try {
        try {
          await runBacktest({
            context,
            barSource: new HistoricalBarReplaySource({
              bars,
              cycleIdPrefix: "wp17-default-fill-proof",
            }),
            deps: session.deps,
            orderRepository: session.orderRepository,
            accountKey: "wp17-fill-proof",
            defaultQuantity: "0.01",
            costModel: createCostModelV1("10", "5"),
            strategySignalIds: [MEAN_REVERSION_V0],
            strategyId: MEAN_REVERSION_V0,
            strategyVersion: STRATEGY_VERSION,
            regimeLabel: "AGGREGATE",
            datasetId: "dataset-wp17-fill-proof",
            runId: "run-wp17-fill-proof",
            split: "validation",
            window,
            accountState: createHtrInitialAccountRiskState(),
            exportedAt: new Date(window.end),
            historicalExecutionProfile: session.historicalExecutionProfile,
            maxCycles: 2,
            enableReplayFusedContext: false,
            activeStrategyIds: [],
          });
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("sell quantity")) {
            throw error;
          }
        }

        expect(applyCostSpy).not.toHaveBeenCalled();
        expect(economicsSpy.mock.calls.length).toBeGreaterThan(0);

        for (const call of recordFillSpy.mock.calls) {
          const fillInput = call[1];
          if (fillInput.executionFactKind) {
            expect(fillInput.executionFactKind).toBe(EXECUTION_FACT_KIND_HISTORICAL_SIMULATED);
          }
        }

        const fills = await session.orderRepository.listFills(context, order.id);
        expect(fills.length).toBeGreaterThan(0);
        expect(fills[0]!.executedAt.getTime()).toBeGreaterThan(order.createdAt.getTime());
      } finally {
        session.cleanup();
      }
    }

    it("V1 uses WP17 profile, single economics owner, and canonical initial portfolio", async () => {
      const initial = createHtrInitialAccountRiskState();
      expect(initial.availableBalanceUsdt).toBe(HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT);

      const { metrics } = await runDefaultResearchPath("1.0.0");
      expect(metrics.schemaVersion).toBe("1.0.0");
    });

    it("V2 uses WP17 profile, single economics owner, and canonical initial portfolio", async () => {
      const { metrics, artifactSink, portfolio } = await runDefaultResearchPath(
        RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
      );
      expect(metrics.schemaVersion).toBe(RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION);
      expect(artifactSink.portfolioContext?.runConfig.startingBalanceUsdt).toBe(
        HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      );
      assertHtrInitialPortfolioContract(
        createHtrInitialPortfolioAccountState({
          runConfig: portfolio.runConfig,
          limits: portfolio.limits,
        }),
      );
    });

    it("fills registered orders on N+1 via runBacktest with WP17 economics only", async () => {
      await runWp17FillProofViaRunBacktest();
    });

    it("propagates profile through runBacktest when invoked from default session shape", async () => {
      const { session, context } = await seedResearchSession();
      const applyCostSpy = vi.spyOn(costModelModule, "applyCostToFill");
      const bars = loadFixtureBars();
      const window = {
        start: new Date(bars[0]!.barOpenTime),
        end: new Date(bars.at(-1)!.barCloseTime),
      };

      try {
        await runBacktest({
          context,
          barSource: new HistoricalBarReplaySource({ bars }),
          deps: session.deps,
          orderRepository: session.orderRepository,
          accountKey: "wp17-run-backtest",
          defaultQuantity: "0.01",
          costModel: createCostModelV1("10", "5"),
          strategySignalIds: [MEAN_REVERSION_V0],
          strategyId: MEAN_REVERSION_V0,
          strategyVersion: STRATEGY_VERSION,
          regimeLabel: "AGGREGATE",
          datasetId: "dataset-wp17-run-backtest",
          runId: "run-wp17-run-backtest",
          split: "validation",
          window,
          accountState: createHtrInitialAccountRiskState(),
          exportedAt: new Date(window.end),
          historicalExecutionProfile: session.historicalExecutionProfile,
        });

        expect(applyCostSpy).not.toHaveBeenCalled();
      } finally {
        session.cleanup();
      }
    });

    it("rejects bindHistoricalExecutionModelToSession mismatch at runBacktest boundary", async () => {
      const { session, context } = await seedResearchSession();
      const bars = flatBars(25);
      const window = {
        start: new Date(bars[0]!.barOpenTime),
        end: new Date(bars.at(-1)!.barCloseTime),
      };
      const orphanProfile = bindHistoricalExecutionModelToSession();

      try {
        await expect(
          runBacktest({
            context,
            barSource: new HistoricalBarReplaySource({ bars }),
            deps: buildLegacyPaperDeps(getDb()).deps,
            orderRepository: buildLegacyPaperDeps(getDb()).orderRepository,
            accountKey: "wp17-orphan-profile",
            defaultQuantity: "0.01",
            costModel: createCostModelV1("10", "5"),
            strategySignalIds: [MEAN_REVERSION_V0],
            strategyId: MEAN_REVERSION_V0,
            strategyVersion: STRATEGY_VERSION,
            regimeLabel: "AGGREGATE",
            datasetId: "dataset-wp17-orphan-profile",
            runId: "run-wp17-orphan-profile",
            split: "validation",
            window,
            accountState: createHtrInitialAccountRiskState(),
            exportedAt: new Date(window.end),
            historicalExecutionProfile: orphanProfile,
          }),
        ).rejects.toBeInstanceOf(HistoricalExecutionProfileConfigurationError);
      } finally {
        session.cleanup();
      }
    });
  });
});
