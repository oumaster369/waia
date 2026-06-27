/**
 * AT-E9 / S5 — Paper loop bar-close orchestrator CLI (mock execution only).
 *
 * Waits for 1m bar-close cadence, polls HTX snapshot, runs one mock paper cycle per bar.
 * Does not complete M7, AT-E9 FG, or DEE-209 — enables timed paper-loop runs and Accelerated Historical Replay Validation.
 *
 * Usage:
 *   pnpm trader:paper:loop -- --org-id=<uuid> --account-key=acct-paper-loop
 *   pnpm trader:paper:loop -- --org-id=<uuid> --account-key=acct-paper-loop --max-cycles=1
 *
 * Unbounded soak (omit --max-cycles; stop with SIGINT/SIGTERM after current cycle):
 *   pnpm trader:paper:loop -- --org-id=<uuid> --account-key=acct-paper-loop
 *
 * Soak log grep (stdout JSON; one cycle_complete line per bar-close cycle — DEE-266):
 *   grep '"kind":"paper_loop"' | grep '"outcome":"cycle_complete"'
 *   grep '"cycle_id":"<prefix>-0"'
 *
 * Soak analysis is a separate human step — this CLI does not validate or pass M7.
 *
 * Requires DATABASE_URL (SQLite) and WAIA_TRADER_CLI=1 (set by package.json script).
 * Sleeps to the next bar-close boundary before each fetch (default 60s interval).
 * SIGINT/SIGTERM aborts after the current cycle completes.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import type { WaiaDb } from "@/db/types";
import { getDb } from "@/db/client";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { FixtureBarPollAdapter } from "@/lib/trader/market-data/fixture-bar-poll-adapter";
import { ScenarioSequenceBarPollAdapter } from "@/lib/trader/market-data/scenario-sequence-bar-poll-adapter";
import type { BarPollSource, BarReplayMode } from "@/lib/trader/market-data/types";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import { runPaperBarCloseLoop } from "@/lib/trader/paper/paper-bar-close-loop";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import type { TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

type CliConfig = {
  orgId: string;
  accountKey: string;
  quantity: string;
  cyclePrefix: string;
  maxCycles: number | undefined;
  barIntervalMs: number;
  fixturePath: string | undefined;
  scenarioFixturePaths: string[] | undefined;
  replayMode: BarReplayMode | undefined;
  deterministicReplay: boolean;
};

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

/** Relaxed org limits for deterministic historical replay (DEE-337); not used for live operator paper-loop runs. */
const DETERMINISTIC_REPLAY_ORG_RISK_LIMITS = {
  ...DEFAULT_ORG_RISK_LIMITS,
  maxNotional: "1000000.00",
  maxOrdersPerWindow: 10_000,
  windowMs: 60_000,
  collarBps: 10_000,
  maxPositionPerSymbol: "1000",
  maxDailyLoss: "1000000.00",
  maxDrawdown: "1000000.00",
  maxOpenOrders: 10_000,
  maxQuoteExposure: "1000000.00",
} as const;

function printUsage(): void {
  console.log(`Usage:
  pnpm trader:paper:loop -- --org-id=<uuid> --account-key=<key> [options]

Options:
  --org-id=<uuid>           Organization ID (required)
  --account-key=<key>       Trading account key (required)
  --quantity=<decimal>      Default order quantity (default: 0.01)
  --cycle-prefix=<prefix>   HTX poll cycle ID prefix (default: paper-loop)
  --max-cycles=<n>          Stop after N cycles (default: run until SIGINT)
  --bar-interval-ms=<ms>    Bar-close interval in ms (default: 60000)
  --fixture-path=<path>     Pinned OHLCV fixture JSON (deterministic replay; no live HTX)
  --replay-mode=<mode>      full | expand | wrap-expand | scenario-sequence (DEE-337 default: scenario-sequence)
  --scenario-fixtures=<csv> Comma-separated golden fixture paths (scenario-sequence; auto from *.metadata.json when omitted)
  --deterministic-replay    Use synthetic wall clock (required for fixture rate limits)
  --help                    Show this help

Environment:
  DATABASE_URL              SQLite database path (required)
  WAIA_TRADER_CLI=1         Required safety gate (set by pnpm script)

Cadence: sleeps to the next bar-close boundary before each poll + mock paper cycle.
With --fixture-path, polls a pinned OHLCV artifact instead of live HTX REST.
Execution mode is locked to mock (MockExchangeConnector only).`);
}

function parseArgs(argv: string[]): CliConfig | "help" {
  if (argv.includes("--help") || argv.includes("-h")) {
    return "help";
  }

  const orgId = argv
    .find((arg) => arg.startsWith("--org-id="))
    ?.split("=")[1]
    ?.trim();
  const accountKey = argv
    .find((arg) => arg.startsWith("--account-key="))
    ?.split("=")[1]
    ?.trim();

  if (!orgId || !accountKey) {
    throw new Error("[trader:paper-loop] --org-id and --account-key are required");
  }

  const quantity = argv.find((arg) => arg.startsWith("--quantity="))?.split("=")[1] ?? "0.01";
  const cyclePrefix =
    argv.find((arg) => arg.startsWith("--cycle-prefix="))?.split("=")[1] ?? "paper-loop";

  const maxCyclesRaw = argv.find((arg) => arg.startsWith("--max-cycles="))?.split("=")[1];
  const maxCycles =
    maxCyclesRaw === undefined || maxCyclesRaw === ""
      ? undefined
      : Number.parseInt(maxCyclesRaw, 10);
  if (maxCycles !== undefined && (!Number.isFinite(maxCycles) || maxCycles <= 0)) {
    throw new Error("[trader:paper-loop] --max-cycles must be a positive integer");
  }

  const barIntervalRaw =
    argv.find((arg) => arg.startsWith("--bar-interval-ms="))?.split("=")[1] ?? "60000";
  const barIntervalMs = Number.parseInt(barIntervalRaw, 10);
  if (!Number.isFinite(barIntervalMs) || barIntervalMs <= 0) {
    throw new Error("[trader:paper-loop] --bar-interval-ms must be a positive integer");
  }

  const fixturePath = argv
    .find((arg) => arg.startsWith("--fixture-path="))
    ?.split("=")
    .slice(1)
    .join("=")
    ?.trim();

  const replayModeRaw = argv
    .find((arg) => arg.startsWith("--replay-mode="))
    ?.split("=")[1]
    ?.trim();
  const replayMode =
    replayModeRaw === undefined || replayModeRaw === ""
      ? undefined
      : (replayModeRaw as BarReplayMode);
  if (
    replayMode !== undefined &&
    replayMode !== "full" &&
    replayMode !== "expand" &&
    replayMode !== "wrap-expand" &&
    replayMode !== "scenario-sequence"
  ) {
    throw new Error(
      "[trader:paper-loop] --replay-mode must be full, expand, wrap-expand, or scenario-sequence",
    );
  }

  const scenarioFixturesRaw = argv
    .find((arg) => arg.startsWith("--scenario-fixtures="))
    ?.split("=")
    .slice(1)
    .join("=");
  const scenarioFixturePaths =
    scenarioFixturesRaw === undefined || scenarioFixturesRaw.trim() === ""
      ? undefined
      : scenarioFixturesRaw
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);

  const deterministicReplay = argv.includes("--deterministic-replay");

  if (fixturePath && !deterministicReplay) {
    throw new Error(
      "[trader:paper-loop] --fixture-path requires --deterministic-replay (synthetic clock for rate limits)",
    );
  }

  if (replayMode === "scenario-sequence" && !fixturePath && !scenarioFixturePaths) {
    throw new Error(
      "[trader:paper-loop] --replay-mode=scenario-sequence requires --fixture-path (metadata) or --scenario-fixtures",
    );
  }

  return {
    orgId,
    accountKey,
    quantity,
    cyclePrefix,
    maxCycles,
    barIntervalMs,
    fixturePath: fixturePath && fixturePath.length > 0 ? fixturePath : undefined,
    scenarioFixturePaths,
    replayMode,
    deterministicReplay,
  };
}

function buildPaperCycleDeps(
  db: WaiaDb,
  connector: MockExchangeConnector,
  writeAudit: (input: TraderAuditInput) => string,
  nowMs: () => number,
): PaperCycleDeps {
  const repo = createSqliteOrderRepository(db);
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs,
  });
  const riskEngine = createRiskEngineService({
    limitsService: createSqliteRiskLimitsService(db),
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs,
    newDecisionId: () => crypto.randomUUID(),
  });

  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository: repo,
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

  return { execution, reconciliation };
}

function resolveScenarioFixturePaths(parsed: CliConfig): string[] {
  if (parsed.scenarioFixturePaths && parsed.scenarioFixturePaths.length > 0) {
    return parsed.scenarioFixturePaths.map((entry) =>
      path.isAbsolute(entry) ? entry : path.join(process.cwd(), entry),
    );
  }

  if (!parsed.fixturePath) {
    throw new Error("[trader:paper-loop] scenario-sequence requires scenario fixture paths");
  }

  const fixturePath = path.isAbsolute(parsed.fixturePath)
    ? parsed.fixturePath
    : path.join(process.cwd(), parsed.fixturePath);
  const metadataPath = fixturePath.replace(/\.json$/i, ".metadata.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
    scenario_fixture_paths?: string[];
    scenario_strategy_ids?: string[];
  };

  const relativePaths = metadata.scenario_fixture_paths;
  if (!relativePaths || relativePaths.length === 0) {
    throw new Error(
      `[trader:paper-loop] ${metadataPath} missing scenario_fixture_paths for scenario-sequence replay`,
    );
  }

  return relativePaths.map((entry) => path.join(process.cwd(), entry));
}

function resolveScenarioStrategyIds(parsed: CliConfig): string[] {
  if (!parsed.fixturePath) {
    throw new Error("[trader:paper-loop] scenario-sequence requires fixture metadata path");
  }

  const fixturePath = path.isAbsolute(parsed.fixturePath)
    ? parsed.fixturePath
    : path.join(process.cwd(), parsed.fixturePath);
  const metadataPath = fixturePath.replace(/\.json$/i, ".metadata.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
    scenario_strategy_ids?: string[];
  };

  const strategyIds = metadata.scenario_strategy_ids;
  if (!strategyIds || strategyIds.length === 0) {
    throw new Error(
      `[trader:paper-loop] ${metadataPath} missing scenario_strategy_ids for scenario-sequence replay`,
    );
  }

  return strategyIds;
}

function buildPollSource(parsed: CliConfig): BarPollSource {
  const replayMode = parsed.replayMode ?? (parsed.fixturePath ? "scenario-sequence" : undefined);

  if (replayMode === "scenario-sequence") {
    const scenarioPaths = resolveScenarioFixturePaths(parsed);
    return new ScenarioSequenceBarPollAdapter({
      scenarioPaths,
      scenarioStrategyIds: resolveScenarioStrategyIds(parsed),
      cycleIdPrefix: parsed.cyclePrefix,
    });
  }

  if (parsed.fixturePath) {
    return new FixtureBarPollAdapter({
      fixturePath: parsed.fixturePath,
      mode: replayMode ?? "wrap-expand",
      cycleIdPrefix: parsed.cyclePrefix,
    });
  }
  return new HtxBarPollSource({ cycleIdPrefix: parsed.cyclePrefix });
}

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error(
      "[trader:paper-loop] Refusing to run without WAIA_TRADER_CLI=1 (use pnpm trader:paper:loop)",
    );
  }

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("[trader:paper-loop] DATABASE_URL is required");
  }

  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    printUsage();
    return;
  }

  const context = requireOrgContext(parsed.orgId);
  const db = getDb();

  const limits = createSqliteRiskLimitsService(db);
  await limits.upsertLimitsForOrg(
    context,
    parsed.deterministicReplay
      ? { ...DETERMINISTIC_REPLAY_ORG_RISK_LIMITS }
      : { ...DEFAULT_ORG_RISK_LIMITS },
  );

  const syntheticNowMs = parsed.deterministicReplay
    ? { current: Date.parse("2026-01-01T00:00:00.000Z") }
    : undefined;
  const nowMs = syntheticNowMs !== undefined ? () => syntheticNowMs.current : () => Date.now();

  const connector = new MockExchangeConnector({
    nowMs: syntheticNowMs ? () => syntheticNowMs.current : undefined,
    emptyPositions: parsed.deterministicReplay,
  });
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

  const writeAudit = (input: TraderAuditInput) => writeTraderAuditLogSqlite(db, input);
  const orderRepository = createSqliteOrderRepository(db);

  const deps = buildPaperCycleDeps(db, connector, writeAudit, nowMs);

  const poll = buildPollSource(parsed);

  const abortController = new AbortController();
  const onSignal = () => {
    console.info("[trader:paper-loop] shutdown requested — finishing current cycle…");
    abortController.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const marketDataMode = parsed.fixturePath ? "fixture-replay" : "htx-live-poll";
  const effectiveReplayMode =
    parsed.replayMode ?? (parsed.fixturePath ? "scenario-sequence" : "n/a");
  console.info(
    `[trader:paper-loop] executionMode=mock marketDataMode=${marketDataMode} orgId=${context.organizationId} accountKey=${parsed.accountKey} barIntervalMs=${parsed.barIntervalMs} maxCycles=${parsed.maxCycles ?? "∞"} fixturePath=${parsed.fixturePath ?? "none"} replayMode=${effectiveReplayMode}`,
  );

  const result = await runPaperBarCloseLoop({
    poll,
    deps,
    context,
    accountKey: parsed.accountKey,
    defaultQuantity: parsed.quantity,
    accountState: EMPTY_STATE,
    orderRepository,
    refreshAccountState: ({ context: refreshContext, orderRepository: repo }) =>
      deriveAccountRiskStateFromMockOrders({
        context: refreshContext,
        orderRepository: repo,
        executionMode: "mock",
      }),
    barIntervalMs: parsed.barIntervalMs,
    maxCycles: parsed.maxCycles,
    syntheticNowMs,
    sleep: parsed.fixturePath ? async () => {} : undefined,
    abortSignal: abortController.signal,
  });

  console.info(
    `[trader:paper-loop] stopped cyclesRun=${result.cyclesRun} aborted=${result.aborted}`,
  );
}

main().catch((err: unknown) => {
  console.error("[trader:paper-loop] FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
