import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import { createLifecycleRecorder, createSqliteLifecycleRepository } from "@/lib/trader/lifecycle";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { bindHistoricalExecutionModelToSession } from "@/lib/trader/backtest/historical-execution-profile";
import type { HistoricalExecutionRuntime } from "@/lib/trader/execution/execution-service.types";
import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import { createManualReplayClock } from "@/lib/trader/research/deterministic-replay-clock";
import {
  createDeterministicReplayIdFactory,
  RESEARCH_REPLAY_CLOCK_START_MS,
  RESEARCH_REPLAY_ID_NAMESPACE,
  type DeterministicReplayIdFactory,
} from "@/lib/trader/research/deterministic-replay-id-factory";
import {
  createInMemoryOrderRateStore,
  type InMemoryOrderRateStore,
} from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
  createRiskEngineService,
} from "@/lib/trader/risk";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import type { TraderAuditInput } from "@/lib/trader/types";

function migrateInMemoryResearchDb(): void {
  resetWaiaSqliteSingleton();
  const db = getDb();
  migrate(db, { migrationsFolder: path.join(process.cwd(), "db/migrations") });
}

export type CreateInMemoryResearchBacktestSessionOptions = {
  /** When set, use this on-disk SQLite path instead of a temp directory. */
  sessionDbPath?: string;
  /** When set, suppress default stdout trader telemetry on the execution path. */
  telemetrySink?: WaiaTraderTelemetrySink;
};

export type InMemoryResearchBacktestSession = {
  deps: PaperCycleDeps;
  orderRepository: OrderRepository;
  historicalExecutionProfile: ReturnType<typeof bindHistoricalExecutionModelToSession>;
  sessionDbPath: string;
  rateStore: InMemoryOrderRateStore;
  connector: MockExchangeConnector;
  replayClock: ReturnType<typeof createManualReplayClock>;
  sessionNewId: DeterministicReplayIdFactory;
  orderNewId: DeterministicReplayIdFactory;
  newDecisionId: DeterministicReplayIdFactory;
  cleanup: () => void;
};

/** Isolated SQLite session for validation replay — no Postgres mock order mutation. */
export async function createInMemoryResearchBacktestSession(
  options: CreateInMemoryResearchBacktestSessionOptions = {},
): Promise<InMemoryResearchBacktestSession> {
  const ownsTempDir = options.sessionDbPath === undefined;
  let tempDir: string | undefined;
  let dbPath: string;

  if (options.sessionDbPath) {
    dbPath = options.sessionDbPath;
    const parentDir = path.dirname(dbPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  } else {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-see-a15-"));
    dbPath = path.join(tempDir, "research-replay.sqlite");
  }

  process.env.DATABASE_URL = dbPath;

  migrateInMemoryResearchDb();

  const db = getDb();
  const writeAudit = (_input: TraderAuditInput) => "see-a15-audit";
  // Deterministic replay clock (DEE-397 / ADR-0021 / HTR-WP10): seeded from the first
  // golden-fixture bar close; advanced to each cycle's evaluated bar time by the runner.
  const replayClock = createManualReplayClock(RESEARCH_REPLAY_CLOCK_START_MS);
  const nowMs = () => replayClock.nowMs();
  const now = () => new Date(nowMs());
  const sessionNewId = createDeterministicReplayIdFactory(RESEARCH_REPLAY_ID_NAMESPACE.session);
  const orderNewId = createDeterministicReplayIdFactory(RESEARCH_REPLAY_ID_NAMESPACE.order);
  const newDecisionId = createDeterministicReplayIdFactory(RESEARCH_REPLAY_ID_NAMESPACE.decision);
  const rateStore = createInMemoryOrderRateStore();
  const connector = new MockExchangeConnector({ nowMs });
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

  const orderRepository = createSqliteOrderRepository(db, { newId: orderNewId, now });
  const lifecycleRepository = createSqliteLifecycleRepository(db);
  const lifecycleRecorder = createLifecycleRecorder({
    repository: lifecycleRepository,
    newId: sessionNewId,
    nowMs,
  });
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs,
  });
  const limitsService = createSqliteRiskLimitsService(db);
  const riskEngine = createRiskEngineService({
    limitsService,
    killSwitchResolver,
    rateStore,
    writeAudit,
    nowMs,
    newDecisionId,
    ...(options.telemetrySink ? { riskTelemetrySink: options.telemetrySink } : {}),
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

  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit,
    nowMs,
    lifecycleRecorder,
    historicalExecution,
    ...(options.telemetrySink ? { executionTelemetrySink: options.telemetrySink } : {}),
  });
  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs,
    writeAudit,
    ...(options.telemetrySink ? { reconciliationTelemetrySink: options.telemetrySink } : {}),
  });

  return {
    deps: {
      execution,
      reconciliation,
      lifecycleRecorder,
      researchReplayDeterminism: {
        clock: replayClock,
        resetWindowState: () => rateStore.clear(),
        newId: sessionNewId,
        setDecisionBarIndex: (index: number) => {
          decisionBarIndex.value = index;
        },
        getDecisionBarIndex: () => decisionBarIndex.value,
        historicalExecutionSession: true,
      },
    },
    orderRepository,
    historicalExecutionProfile,
    sessionDbPath: dbPath,
    rateStore,
    connector,
    replayClock,
    sessionNewId,
    orderNewId,
    newDecisionId,
    cleanup: () => {
      resetWaiaSqliteSingleton();
      if (ownsTempDir && tempDir) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // best-effort temp cleanup
        }
      }
    },
  };
}
