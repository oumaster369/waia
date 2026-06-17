/**
 * AT-E9 / S5 — Paper loop bar-close orchestrator CLI (mock execution only).
 *
 * Waits for 1m bar-close cadence, polls HTX snapshot, runs one mock paper cycle per bar.
 * Does not complete M7 or AT-E9 FG — enables timed paper-loop runs for future soak validation.
 *
 * Usage:
 *   pnpm trader:paper:loop -- --org-id=<uuid> --account-key=acct-paper-loop
 *   pnpm trader:paper:loop -- --org-id=<uuid> --account-key=acct-paper-loop --max-cycles=1
 *
 * Requires DATABASE_URL (SQLite) and WAIA_TRADER_CLI=1 (set by package.json script).
 * Sleeps to the next bar-close boundary before each fetch (default 60s interval).
 * SIGINT/SIGTERM aborts after the current cycle completes.
 */

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
};

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

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
  --help                    Show this help

Environment:
  DATABASE_URL              SQLite database path (required)
  WAIA_TRADER_CLI=1         Required safety gate (set by pnpm script)

Cadence: sleeps to the next bar-close boundary before each HTX poll + mock paper cycle.
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

  return {
    orgId,
    accountKey,
    quantity,
    cyclePrefix,
    maxCycles,
    barIntervalMs,
  };
}

function buildPaperCycleDeps(
  db: WaiaDb,
  connector: MockExchangeConnector,
  writeAudit: (input: TraderAuditInput) => string,
): PaperCycleDeps {
  const repo = createSqliteOrderRepository(db);
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs: Date.now,
  });
  const riskEngine = createRiskEngineService({
    limitsService: createSqliteRiskLimitsService(db),
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs: Date.now,
    newDecisionId: () => crypto.randomUUID(),
  });

  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository: repo,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit,
    nowMs: Date.now,
  });

  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs: Date.now,
    writeAudit,
  });

  return { execution, reconciliation };
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
  await limits.upsertLimitsForOrg(context, { ...DEFAULT_ORG_RISK_LIMITS });

  const connector = new MockExchangeConnector();
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

  const writeAudit = (input: TraderAuditInput) => writeTraderAuditLogSqlite(db, input);
  const deps = buildPaperCycleDeps(db, connector, writeAudit);

  const poll = new HtxBarPollSource({ cycleIdPrefix: parsed.cyclePrefix });

  const abortController = new AbortController();
  const onSignal = () => {
    console.info("[trader:paper-loop] shutdown requested — finishing current cycle…");
    abortController.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  console.info(
    `[trader:paper-loop] executionMode=mock orgId=${context.organizationId} accountKey=${parsed.accountKey} barIntervalMs=${parsed.barIntervalMs} maxCycles=${parsed.maxCycles ?? "∞"}`,
  );

  const result = await runPaperBarCloseLoop({
    poll,
    deps,
    context,
    accountKey: parsed.accountKey,
    defaultQuantity: parsed.quantity,
    accountState: EMPTY_STATE,
    barIntervalMs: parsed.barIntervalMs,
    maxCycles: parsed.maxCycles,
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
