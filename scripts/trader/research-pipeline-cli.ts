/**
 * RI-INTEGRATION-1 — Deterministic research pipeline orchestrator CLI.
 *
 * Usage:
 *   WAIA_DB_BACKEND=postgres DATABASE_URL_POSTGRES=... pnpm trader:research:pipeline -- \
 *     --org-id=<uuid> \
 *     --symbol=BTC/USDT \
 *     --interval=1m \
 *     --strategy-id=mean_reversion_v0 \
 *     --strategy-version=0.1.0 \
 *     [--dataset-name=ri-run-1]
 *
 * Requires WAIA_TRADER_CLI=1 (set by package.json script).
 */

import { writeFileSync } from "node:fs";

import { getPostgresDrizzle } from "@/db/postgres-client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createPostgresOrderRepository,
  createPostgresReconciliationService,
} from "@/lib/trader/execution";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import { runResearchPipelinePostgres } from "@/lib/trader/research/research-orchestrator";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createPostgresKillSwitchRepository,
  createPostgresRiskEngineService,
  createPostgresRiskLimitsService,
} from "@/lib/trader/risk";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const LOG_PREFIX = "[trader:research:pipeline]";

export function printResearchPipelineUsage(): void {
  console.log(`Research pipeline orchestrator (RI-INTEGRATION-1)

Usage:
  pnpm trader:research:pipeline -- \\
    --org-id=<uuid> \\
    [--symbol=BTC/USDT] \\
    [--interval=1m] \\
    [--strategy-id=mean_reversion_v0] \\
    [--strategy-version=0.1.0] \\
    [--dataset-name=ri-pipeline-run] \\
    [--out=evidence.json]

Environment:
  WAIA_DB_BACKEND=postgres
  DATABASE_URL_POSTGRES
  WAIA_TRADER_CLI=1`);
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) {
      flags.set(body, "true");
    } else {
      flags.set(body.slice(0, eqIndex), body.slice(eqIndex + 1));
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.has("help")) {
    printResearchPipelineUsage();
    return;
  }

  const organizationId = flags.get("org-id")?.trim();
  if (!organizationId) {
    throw new Error(`${LOG_PREFIX} --org-id is required`);
  }

  const symbol = (flags.get("symbol")?.trim() || "BTC/USDT") as InstrumentId;
  const interval = (flags.get("interval")?.trim() || "1m") as BarInterval;
  const strategyId = flags.get("strategy-id")?.trim() || "mean_reversion_v0";
  const strategyVersion = flags.get("strategy-version")?.trim() || "0.1.0";
  const datasetName = flags.get("dataset-name")?.trim() || `ri-pipeline-${Date.now()}`;

  const db = getPostgresDrizzle();
  const context = requireOrgContext(organizationId);
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
  const orderRepository = createPostgresOrderRepository(db);
  const riskEngine = createPostgresRiskEngineService(db, {
    limitsService: limits,
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs,
    newDecisionId: () => crypto.randomUUID(),
  });
  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit,
    nowMs,
  });
  const reconciliation = createPostgresReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs,
    writeAudit,
  });

  const result = await runResearchPipelinePostgres(db, {
    context,
    datasetName,
    symbol,
    interval,
    strategyId,
    strategyVersion,
    deps: { execution, reconciliation },
    createOrderRepository: () => createPostgresOrderRepository(db),
  });

  const serialized = `${JSON.stringify(result.evidenceDocument, null, 2)}\n`;
  const outPath = flags.get("out")?.trim();
  if (outPath) {
    writeFileSync(outPath, serialized, "utf8");
    console.info(`${LOG_PREFIX} evidence written: ${outPath}`);
  } else {
    process.stdout.write(serialized);
  }

  console.error(
    `${LOG_PREFIX} completed datasetId=${result.dataset.id} backtestRunId=${result.backtestRunId} ` +
      `candidateId=${result.strategyCandidateId} blindId=${result.blindValidationResultId} ` +
      `knowledgeEvent=${result.knowledge.marketEventId}`,
  );
}
if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
