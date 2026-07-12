import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import bcrypt from "bcryptjs";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { users } from "@/db/schema";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { createManualReplayClock } from "@/lib/trader/research/deterministic-replay-clock";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
  createRiskEngineService,
} from "@/lib/trader/risk";
import {
  aggregateBigIntMax,
  aggregateBigIntMedian,
  aggregateBigIntP95NearestRank,
  aggregateNumberMax,
  aggregateNumberMedian,
  aggregateNumberP95NearestRank,
  createReplayBenchmarkObserver,
  NOOP_REPLAY_BENCHMARK_OBSERVER,
  REPLAY_BENCHMARK_ALL_STAGES,
  REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION,
  REPLAY_BENCHMARK_PER_CYCLE_STAGES,
  REPLAY_BENCHMARK_PER_RUN_STAGES,
  type ReplayBenchmarkRunResult,
  type ReplayBenchmarkStageId,
} from "@/lib/trader/backtest/replay-benchmark-instrumentation";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import type { TraderFixtureFile } from "@/lib/trader/market-data/types";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import type { TraderAuditInput } from "@/lib/trader/types";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";

export const HTR_WP03_BENCHMARK_FIXTURE_PATH = path.join(
  process.cwd(),
  "tests/fixtures/trader/dee-337-p5-btcusdt-1m-replay.json",
);

export const HTR_WP03_BENCHMARK_FIXTURE_METADATA_PATH = path.join(
  process.cwd(),
  "tests/fixtures/trader/dee-337-p5-btcusdt-1m-replay.metadata.json",
);

export const HTR_WP03_BENCHMARK_FIXTURE_SHA256 =
  "814981bc3055d8fd52d1277d60a0b443de7644416aceba8cbe99819c70242061";

export const HTR_WP03_BENCHMARK_EVIDENCE_DIR = path.join(
  process.cwd(),
  "replay-runs/RI-P7/htr-wp03-replay-benchmark-baseline",
);

export const HTR_WP03_BENCHMARK_COMMAND = "pnpm trader:replay:benchmark";

export const HTR_WP03_BENCHMARK_WARM_RUNS = 5;

export const HTR_WP03_BENCHMARK_EXPECTED_CYCLES = 81;

const BENCHMARK_USER_ID = "00000000-0000-4000-8000-0000000415w3";
const BENCHMARK_DECISION_ID = "00000000-0000-4000-8000-0000000415w5";
const BENCHMARK_STRATEGY_VERSION = "0.1.0";
const BENCHMARK_REPLAY_CLOCK_START_MS = Date.parse("2026-01-01T00:00:00.000Z");

type BenchmarkSession = {
  deps: PaperCycleDeps;
  orderRepository: OrderRepository;
  cleanup: () => void;
};

function createBenchmarkNewIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(415500 + sequence).padStart(12, "0")}`;
  };
}

async function withDeterministicRandomUuid<T>(run: () => Promise<T>): Promise<T> {
  let sequence = 0;
  const originalRandomUuid = crypto.randomUUID.bind(crypto);
  crypto.randomUUID = () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(415600 + sequence).padStart(12, "0")}`;
  };
  try {
    return await run();
  } finally {
    crypto.randomUUID = originalRandomUuid;
  }
}

function migrateBenchmarkDb(): void {
  resetWaiaSqliteSingleton();
  const db = getDb();
  migrate(db, { migrationsFolder: path.join(process.cwd(), "db/migrations") });
}

async function createDeterministicBenchmarkSession(): Promise<BenchmarkSession> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-htr-wp03-benchmark-"));
  const dbPath = path.join(tempDir, "benchmark-replay.sqlite");
  process.env.DATABASE_URL = dbPath;

  migrateBenchmarkDb();

  const db = getDb();
  const writeAudit = (_input: TraderAuditInput) => "htr-wp03-benchmark-audit";
  const replayClock = createManualReplayClock(BENCHMARK_REPLAY_CLOCK_START_MS);
  const nowMs = () => replayClock.nowMs();
  const rateStore = createInMemoryOrderRateStore();
  const connector = new MockExchangeConnector({ nowMs });
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

  const orderRepository = createSqliteOrderRepository(db);
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
    newDecisionId: () => BENCHMARK_DECISION_ID,
  });
  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit,
    nowMs,
  });
  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs,
    writeAudit,
  });

  return {
    deps: {
      execution,
      reconciliation,
      researchReplayDeterminism: {
        clock: replayClock,
        resetWindowState: () => rateStore.clear(),
      },
    },
    orderRepository,
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort temp cleanup
      }
    },
  };
}

export type ReplayBenchmarkEnvironment = {
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  cpuModel: string;
  cpuCount: number;
  totalMemBytes: number;
};

export type ReplayBenchmarkStageTimingAggregate = {
  medianTotalNs: string;
  p95TotalNs: string;
  maxTotalNs: string;
};

export type ReplayBenchmarkMemoryAggregate = {
  rssBytes: {
    median: number;
    p95: number;
    max: number;
  };
  heapUsedBytes: {
    median: number;
    p95: number;
    max: number;
  };
};

export type ReplayBenchmarkHarnessResult = {
  schemaVersion: typeof REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION;
  terminalState: "BENCHMARK_OK" | "BENCHMARK_FAILED";
  coldRun: ReplayBenchmarkRunResult;
  warmRuns: ReplayBenchmarkRunResult[];
  aggregate: {
    perStageTiming: Record<ReplayBenchmarkStageId, ReplayBenchmarkStageTimingAggregate>;
    memoryHighWater: ReplayBenchmarkMemoryAggregate;
  };
  environment: ReplayBenchmarkEnvironment;
  semanticReproDigest: string;
  evidenceDigest: string;
  cycleCount: number;
};

export type ReplayBenchmarkManifest = {
  schemaVersion: typeof REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION;
  fixturePath: string;
  fixtureSha256: string;
  codeSha: string;
  dirtyTree: boolean;
  command: string;
  cycleCount: number;
  perCycleStages: readonly ReplayBenchmarkStageId[];
  perRunStages: readonly ReplayBenchmarkStageId[];
  coldRuns: number;
  warmRuns: number;
  semanticReproDigest: string;
  evidenceDigest: string;
  terminalState: "BENCHMARK_OK" | "BENCHMARK_FAILED";
};

export function sha256File(filePath: string): string {
  const contents = readFileSync(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

export function readGitCodeSha(): string {
  return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
}

export function readGitDirtyTree(): boolean {
  const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  return status.length > 0;
}

export function readBenchmarkEnvironment(): ReplayBenchmarkEnvironment {
  const cpus = os.cpus();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    totalMemBytes: os.totalmem(),
  };
}

export function loadApprovedBenchmarkFixture(): TraderFixtureFile & { bars: Bar[] } {
  const fixture = JSON.parse(
    readFileSync(HTR_WP03_BENCHMARK_FIXTURE_PATH, "utf8"),
  ) as TraderFixtureFile & {
    bars: Bar[];
  };
  const digest = sha256File(HTR_WP03_BENCHMARK_FIXTURE_PATH);
  if (digest !== HTR_WP03_BENCHMARK_FIXTURE_SHA256) {
    throw new Error(
      `[htr-wp03-benchmark] fixture sha256 mismatch: expected ${HTR_WP03_BENCHMARK_FIXTURE_SHA256}, got ${digest}`,
    );
  }
  return fixture;
}

function aggregateWarmRuns(
  warmRuns: readonly ReplayBenchmarkRunResult[],
): ReplayBenchmarkHarnessResult["aggregate"] {
  const perStageTiming = Object.fromEntries(
    REPLAY_BENCHMARK_ALL_STAGES.map((stage) => {
      const totals = warmRuns.map((run) => BigInt(run.telemetry.perStage[stage].totalNs));
      return [
        stage,
        {
          medianTotalNs: aggregateBigIntMedian(totals).toString(),
          p95TotalNs: aggregateBigIntP95NearestRank(totals).toString(),
          maxTotalNs: aggregateBigIntMax(totals).toString(),
        },
      ];
    }),
  ) as Record<ReplayBenchmarkStageId, ReplayBenchmarkStageTimingAggregate>;

  const rssValues = warmRuns.map((run) => run.telemetry.memoryHighWater.rssBytes);
  const heapValues = warmRuns.map((run) => run.telemetry.memoryHighWater.heapUsedBytes);

  return {
    perStageTiming,
    memoryHighWater: {
      rssBytes: {
        median: aggregateNumberMedian(rssValues),
        p95: aggregateNumberP95NearestRank(rssValues),
        max: aggregateNumberMax(rssValues),
      },
      heapUsedBytes: {
        median: aggregateNumberMedian(heapValues),
        p95: aggregateNumberP95NearestRank(heapValues),
        max: aggregateNumberMax(heapValues),
      },
    },
  };
}

async function seedBenchmarkSession() {
  const session = await createDeterministicBenchmarkSession();
  const db = getDb();
  const email = "htr-wp03-benchmark@waia.invalid";
  db.insert(users)
    .values({
      id: BENCHMARK_USER_ID,
      email,
      identityLabel: "HTR-WP03 Replay Benchmark",
      passwordHash: bcrypt.hashSync("password123", 10),
    })
    .run();
  ensureUserTwinSeed(db, BENCHMARK_USER_ID);
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: BENCHMARK_USER_ID,
    displayName: "HTR-WP03 Replay Benchmark",
  });
  await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgId), {
    ...DEFAULT_ORG_RISK_LIMITS,
  });
  return { session, context: requireOrgContext(orgId) };
}

export async function runReplayBenchmarkOnce(input: {
  bars: readonly Bar[];
  includeInstrumentation: boolean;
}): Promise<{
  benchmark: ReplayBenchmarkRunResult | null;
  backtest: Awaited<ReturnType<typeof runBacktest>>;
}> {
  return withDeterministicRandomUuid(async () => {
    const { session, context } = await seedBenchmarkSession();
    try {
      const fixture = loadApprovedBenchmarkFixture();
      const window = {
        start: new Date(input.bars[0]!.barOpenTime),
        end: new Date(input.bars.at(-1)!.barCloseTime),
      };
      const costModel = createCostModelV1("10", "5");
      const barSource = new HistoricalBarReplaySource({
        bars: input.bars,
        quote: fixture.latestQuote,
        cycleIdPrefix: "htr-wp03-benchmark",
      });

      const instrumentation = input.includeInstrumentation ? createReplayBenchmarkObserver() : null;

      const backtest = await runBacktest({
        context,
        barSource,
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "htr-wp03-benchmark",
        defaultQuantity: "0.01",
        costModel,
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: BENCHMARK_STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "htr-wp03-benchmark",
        runId: "htr-wp03-benchmark",
        split: "validation",
        window,
        accountState: {
          positions: [],
          openOrderCount: 0,
          dailyPnl: "0",
          drawdown: "0",
          quoteExposureByCurrency: {},
        },
        exportedAt: new Date("2026-07-12T00:00:00.000Z"),
        activeStrategyIds: [MEAN_REVERSION_V0],
        refreshAccountStateBetweenStrategies: true,
        newId: createBenchmarkNewIdFactory(),
        benchmarkObserver: instrumentation?.observer ?? NOOP_REPLAY_BENCHMARK_OBSERVER,
      });

      const benchmark = instrumentation ? instrumentation.collect() : null;
      return { benchmark, backtest };
    } finally {
      session.cleanup();
    }
  });
}

export async function runReplayBenchmarkHarness(): Promise<ReplayBenchmarkHarnessResult> {
  const fixture = loadApprovedBenchmarkFixture();
  const bars = fixture.bars;

  const cold = await runReplayBenchmarkOnce({ bars, includeInstrumentation: true });
  if (!cold.benchmark || cold.benchmark.terminalState !== "BENCHMARK_OK") {
    throw new Error("[htr-wp03-benchmark] cold run failed");
  }

  const warmRuns: ReplayBenchmarkRunResult[] = [];
  let semanticReproDigest = "";
  let evidenceDigest = "";

  for (let index = 0; index < HTR_WP03_BENCHMARK_WARM_RUNS; index += 1) {
    const warm = await runReplayBenchmarkOnce({ bars, includeInstrumentation: true });
    if (!warm.benchmark || warm.benchmark.terminalState !== "BENCHMARK_OK") {
      throw new Error(`[htr-wp03-benchmark] warm run ${index + 1} failed`);
    }
    warmRuns.push(warm.benchmark);
    if (index === 0) {
      semanticReproDigest = computeReplayReproContentDigest(warm.backtest.exportDocument);
      evidenceDigest = warm.backtest.evidenceDigest;
    }
  }

  const parity = await runReplayBenchmarkOnce({ bars, includeInstrumentation: false });
  if (
    parity.backtest.evidenceDigest !== evidenceDigest ||
    computeReplayReproContentDigest(parity.backtest.exportDocument) !== semanticReproDigest
  ) {
    throw new Error("[htr-wp03-benchmark] semantic parity check failed during harness");
  }

  return {
    schemaVersion: REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION,
    terminalState: "BENCHMARK_OK",
    coldRun: cold.benchmark,
    warmRuns,
    aggregate: aggregateWarmRuns(warmRuns),
    environment: readBenchmarkEnvironment(),
    semanticReproDigest,
    evidenceDigest,
    cycleCount: cold.backtest.cycleCount,
  };
}

export function buildReplayBenchmarkManifest(
  harness: ReplayBenchmarkHarnessResult,
): ReplayBenchmarkManifest {
  return {
    schemaVersion: REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION,
    fixturePath: HTR_WP03_BENCHMARK_FIXTURE_PATH,
    fixtureSha256: HTR_WP03_BENCHMARK_FIXTURE_SHA256,
    codeSha: readGitCodeSha(),
    dirtyTree: readGitDirtyTree(),
    command: HTR_WP03_BENCHMARK_COMMAND,
    cycleCount: harness.cycleCount,
    perCycleStages: REPLAY_BENCHMARK_PER_CYCLE_STAGES,
    perRunStages: REPLAY_BENCHMARK_PER_RUN_STAGES,
    coldRuns: 1,
    warmRuns: HTR_WP03_BENCHMARK_WARM_RUNS,
    semanticReproDigest: harness.semanticReproDigest,
    evidenceDigest: harness.evidenceDigest,
    terminalState: harness.terminalState,
  };
}

export function writeReplayBenchmarkEvidence(
  harness: ReplayBenchmarkHarnessResult,
  outputDir = HTR_WP03_BENCHMARK_EVIDENCE_DIR,
): { resultPath: string; manifestPath: string; readmePath: string } {
  mkdirSync(outputDir, { recursive: true });
  const manifest = buildReplayBenchmarkManifest(harness);
  const resultPath = path.join(outputDir, "benchmark-result.json");
  const manifestPath = path.join(outputDir, "benchmark-manifest.json");
  const readmePath = path.join(outputDir, "README.md");

  writeFileSync(resultPath, `${JSON.stringify(harness, null, 2)}\n`, "utf8");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(
    readmePath,
    `# HTR-WP03 replay benchmark baseline

Measurement-only baseline for the legacy expanding-window replay path
(\`HistoricalBarReplaySource\` → \`runBacktest\` → \`runPaperCycleOnce\`).

## Reproduce

\`\`\`bash
pnpm trader:replay:benchmark
\`\`\`

## Fixture

- Path: \`tests/fixtures/trader/dee-337-p5-btcusdt-1m-replay.json\`
- SHA-256: \`${HTR_WP03_BENCHMARK_FIXTURE_SHA256}\`
- Cycles: ${HTR_WP03_BENCHMARK_EXPECTED_CYCLES} (100 bars, expanding window from 20)

## Non-goals

This baseline does **not** assert performance qualification (D-11B deferred to HTR-WP22),
does not optimize replay, and does not close HTR-GAP-024.
`,
    "utf8",
  );

  return { resultPath, manifestPath, readmePath };
}
