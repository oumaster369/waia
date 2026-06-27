/**
 * DEE-337 / NEW-10 — Closed-trade-per-strategy soak evidence CLI (S0 / P5).
 *
 * Reads trader_orders/trader_fills from the soak SQLite book and emits per-strategy
 * closed-trade counts plus a digest-sealed export document. Evidence extraction only —
 * does not substitute for the mandatory wall-clock soak.
 *
 * Usage:
 *   pnpm trader:paper:soak:evidence -- \
 *     --db=file:/path/to/paper-soak.db \
 *     --org-id=<uuid> \
 *     --account-key=acct-paper-loop \
 *     --start-utc=2026-06-20T00:00:00.000Z \
 *     --end-utc=2026-06-22T00:00:00.000Z \
 *     --out=closed-trade-evidence.json
 *
 * Requires WAIA_TRADER_CLI=1 (set by package.json script).
 */

import fs from "node:fs";

import { getDb } from "@/db/client";
import { createSqliteOrderRepository } from "@/lib/trader/execution";
import { P5_TWO_STRATEGY_SOAK_IDS } from "@/lib/trader/paper/analyze-paper-soak-log";
import { buildSoakStrategyEvidence } from "@/lib/trader/paper/build-soak-strategy-evidence";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

function printUsage(): void {
  console.log(`Usage:
  pnpm trader:paper:soak:evidence -- [options]

Options:
  --db=<path>               SQLite DATABASE_URL path (required; e.g. file:/path/to/paper-soak.db)
  --org-id=<uuid>           Organization ID (required)
  --account-key=<key>       Trading account key from soak metadata (required)
  --start-utc=<iso>         Soak window start, UTC ISO-8601 (required)
  --end-utc=<iso>           Soak window end, UTC ISO-8601 (required)
  --strategy-ids=<csv>      Required strategy signal IDs (default: P5 pair)
  --execution-mode=<mode>   mock or paper (default: mock)
  --out=<path>              Write JSON artifact to path (default: stdout)
  --help                    Show this help

Default strategy IDs:
  ${P5_TWO_STRATEGY_SOAK_IDS.join(", ")}

Exit codes:
  0 — every required strategy has >= 1 closed trade in the window
  1 — analysis failed or any required strategy has zero closed trades`);
}

function parseIsoUtc(label: string, raw: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`[trader:paper:soak:evidence] ${label} must be a valid ISO-8601 timestamp`);
  }
  return parsed;
}

function normalizeDatabaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("file:")) {
    return trimmed;
  }
  return `file:${trimmed}`;
}

function parseExecutionMode(raw: string | undefined): PaperBookExecutionMode {
  const mode = raw?.trim() ?? "mock";
  if (mode !== "mock" && mode !== "paper") {
    throw new Error(
      `[trader:paper:soak:evidence] --execution-mode must be mock or paper (got ${mode})`,
    );
  }
  return mode;
}

function parseArgs(argv: string[]): {
  databaseUrl: string;
  orgId: string;
  accountKey: string;
  window: { start: Date; end: Date };
  strategySignalIds: string[];
  executionMode: PaperBookExecutionMode;
  outPath: string | undefined;
} {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const databaseUrlRaw = argv
    .find((arg) => arg.startsWith("--db="))
    ?.split("=")
    .slice(1)
    .join("=")
    .trim();
  if (!databaseUrlRaw) {
    throw new Error("[trader:paper:soak:evidence] --db=<path> is required");
  }

  const orgId = argv
    .find((arg) => arg.startsWith("--org-id="))
    ?.split("=")[1]
    ?.trim();
  if (!orgId) {
    throw new Error("[trader:paper:soak:evidence] --org-id=<uuid> is required");
  }

  const accountKey = argv
    .find((arg) => arg.startsWith("--account-key="))
    ?.split("=")[1]
    ?.trim();
  if (!accountKey) {
    throw new Error("[trader:paper:soak:evidence] --account-key=<key> is required");
  }

  const startUtcRaw = argv
    .find((arg) => arg.startsWith("--start-utc="))
    ?.split("=")
    .slice(1)
    .join("=")
    .trim();
  const endUtcRaw = argv
    .find((arg) => arg.startsWith("--end-utc="))
    ?.split("=")
    .slice(1)
    .join("=")
    .trim();
  if (!startUtcRaw || !endUtcRaw) {
    throw new Error(
      "[trader:paper:soak:evidence] --start-utc=<iso> and --end-utc=<iso> are required",
    );
  }

  const window = {
    start: parseIsoUtc("--start-utc", startUtcRaw),
    end: parseIsoUtc("--end-utc", endUtcRaw),
  };
  if (window.start.getTime() >= window.end.getTime()) {
    throw new Error("[trader:paper:soak:evidence] --start-utc must be before --end-utc");
  }

  const strategyIdsRaw = argv.find((arg) => arg.startsWith("--strategy-ids="))?.split("=")[1];
  const strategySignalIds =
    strategyIdsRaw === undefined || strategyIdsRaw.trim() === ""
      ? [...P5_TWO_STRATEGY_SOAK_IDS]
      : strategyIdsRaw
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
  if (strategySignalIds.length === 0) {
    throw new Error("[trader:paper:soak:evidence] --strategy-ids must list at least one id");
  }

  const executionMode = parseExecutionMode(
    argv.find((arg) => arg.startsWith("--execution-mode="))?.split("=")[1],
  );

  const outPath = argv
    .find((arg) => arg.startsWith("--out="))
    ?.split("=")
    .slice(1)
    .join("=")
    .trim();

  return {
    databaseUrl: normalizeDatabaseUrl(databaseUrlRaw),
    orgId,
    accountKey,
    window,
    strategySignalIds,
    executionMode,
    outPath: outPath && outPath.length > 0 ? outPath : undefined,
  };
}

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error(
      "[trader:paper:soak:evidence] WAIA_TRADER_CLI=1 is required (use pnpm trader:paper:soak:evidence)",
    );
  }

  const args = parseArgs(process.argv.slice(2));
  process.env.DATABASE_URL = args.databaseUrl;

  const db = getDb();
  const context = requireOrgContext(args.orgId);
  const orderRepository = createSqliteOrderRepository(db);

  const evidence = await buildSoakStrategyEvidence({
    context,
    orderRepository,
    window: args.window,
    strategySignalIds: args.strategySignalIds,
    executionMode: args.executionMode,
    accountKey: args.accountKey,
    exportedAt: new Date(),
  });

  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (args.outPath) {
    fs.writeFileSync(args.outPath, serialized, "utf8");
    console.info(`[trader:paper:soak:evidence] artifact written: ${args.outPath}`);
  } else {
    process.stdout.write(serialized);
  }

  console.error(
    `[trader:paper:soak:evidence] summary org=${evidence.organizationId} account=${evidence.accountKey} ` +
      `window=${evidence.window.start}..${evidence.window.end} ` +
      `counts=${evidence.strategyCounts.map((entry) => `${entry.strategySignalId}:${entry.closedTradeCount}`).join(",")}`,
  );

  if (!evidence.closedTradeEvidenceReady) {
    console.error(`[trader:paper:soak:evidence] FAIL — ${evidence.blockingReasons.join("; ")}`);
    process.exit(1);
  }

  console.info("[trader:paper:soak:evidence] PASS — closed-trade evidence gates satisfied");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[trader:paper:soak:evidence] ${message}`);
  process.exit(1);
});
