/**
 * RI-INTEGRATION-1 / RI-P7 — Deterministic research pipeline orchestrator CLI.
 *
 * Usage:
 *   WAIA_DB_BACKEND=postgres DATABASE_URL_POSTGRES=... pnpm trader:research:pipeline -- \
 *     --org-id=<uuid> \
 *     --symbol=BTC/USDT \
 *     --interval=1m \
 *     --strategy-id=mean_reversion_v0 \
 *     --strategy-version=0.1.0 \
 *     [--oos-bar-count=20] \
 *     [--dataset-name=ri-run-1] \
 *     [--build-pka] \
 *     [--pka-out=production-knowledge-asset.json]
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
import { buildProductionKnowledgeAsset } from "@/lib/trader/knowledge/build-production-knowledge-asset";
import { serializeProductionKnowledgeAsset } from "@/lib/trader/knowledge/serialize-production-knowledge-asset";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import { resolveResearchPipelineCliBlindTail } from "@/lib/trader/research/dee-540-blind-tail-gate";
import { computeM9DatasetSealPreviewPostgres } from "@/lib/trader/research/m9-dataset-seal-preview";
import { runResearchPipelinePostgres } from "@/lib/trader/research/research-orchestrator";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { createIntelligenceCycleBundleRepositoryPostgres } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import { createForecastDecisionBundleRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { createWp21RuntimeDepsPostgres } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
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
const DEFAULT_OOS_BAR_COUNT = 20;

export function printResearchPipelineUsage(): void {
  console.log(`Research pipeline orchestrator (RI-P7)

Usage:
  pnpm trader:research:pipeline -- \\
    --org-id=<uuid> \\
    [--symbol=BTC/USDT] \\
    [--interval=1m] \\
    [--strategy-id=mean_reversion_v0] \\
    [--strategy-version=0.1.0] \\
    [--dataset-name=ri-pipeline-run] \\
    [--oos-bar-count=20] \\
    [--out=evidence.json] \\
    [--build-pka] \\
    [--pka-out=production-knowledge-asset.json] \\
    [--htr-epistemic-closure] \\
    --operator-blind-authorization=<digest> \\
    --blind-authorization-scope=<json>

The blind tail stays closed without the DEE-540 authorization gate.
Official 2025 holdout remains SEALED_NOT_ACCESSED (--official-holdout and
--partition=blind-holdout are refused).

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

export function parseOosBarCount(flags: Map<string, string>): number {
  const raw = flags.get("oos-bar-count") ?? String(DEFAULT_OOS_BAR_COUNT);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${LOG_PREFIX} --oos-bar-count must be a positive integer`);
  }
  return parsed;
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
  const oosBarCount = parseOosBarCount(flags);
  const buildPka = flags.has("build-pka");
  const htrEpistemicClosure = flags.has("htr-epistemic-closure");

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

  const blindTail = resolveResearchPipelineCliBlindTail(flags);

  // Metadata-only preflight; permitted orchestrator reads and verifies bars during execution.
  const datasetPreview = await computeM9DatasetSealPreviewPostgres(db, context, { symbol, interval });
  const barSetDigest = datasetPreview.contentDigest;

  const wp21Deps = htrEpistemicClosure ? createWp21RuntimeDepsPostgres(db) : undefined;

  const result = await runResearchPipelinePostgres(db, {
    context,
    datasetName,
    symbol,
    interval,
    strategyId,
    strategyVersion,
    oosBarCount,
    deps: { execution, reconciliation },
    createOrderRepository: () => createPostgresOrderRepository(db),
    pipelineBacktest: {
      operatorBlindAuthorization: blindTail.operatorBlindAuthorization,
      blindAuthorizationScope: blindTail.blindAuthorizationScope,
      officialHoldoutAccessRequested: false,
    },
    ...(htrEpistemicClosure
      ? {
          historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
          intelligenceRecordsSink: createIntelligenceCycleBundleRepositoryPostgres(db),
          forecastDecisionSink: createForecastDecisionBundleRepositoryPostgres(db),
          outcomeResolutionSink: wp21Deps!.outcomeResolutionSink,
          calibrationSink: wp21Deps!.calibrationSink,
          confidenceUpdateSink: wp21Deps!.confidenceUpdateSink,
          wp21RuntimeDeps: wp21Deps,
          outcomeResolutionReadPort: wp21Deps!.outcomeResolutionReadPort,
          wp21PostgresExecutor: db,
          wp21Provenance: {
            codeSha: process.env.GITHUB_SHA ?? "local-dev",
            datasetContentDigest: barSetDigest,
          },
        }
      : {}),
  });

  const serialized = `${JSON.stringify(result.evidenceDocument, null, 2)}\n`;
  const outPath = flags.get("out")?.trim();
  if (outPath) {
    writeFileSync(outPath, serialized, "utf8");
    console.info(`${LOG_PREFIX} evidence written: ${outPath}`);
  } else {
    process.stdout.write(serialized);
  }

  if (buildPka) {
    const pka = buildProductionKnowledgeAsset({
      evidenceDocument: result.evidenceDocument,
      dataset: result.dataset,
      barSetDigest,
      barCount: datasetPreview.barCount,
      symbol,
      interval,
      walkForwardWindowCount: result.walkForwardWindowCount,
      blindMetrics: result.blindMetrics,
      mkbLinkage: result.knowledge,
      edgeConfidence: "0.0000",
      edgeStrength: "0.0000",
      edgeVerified: false,
      builderGitSha: process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    });
    const pkaSerialized = serializeProductionKnowledgeAsset(pka);
    const pkaOut = flags.get("pka-out")?.trim();
    if (pkaOut) {
      writeFileSync(pkaOut, pkaSerialized, "utf8");
      console.info(`${LOG_PREFIX} PKA written: ${pkaOut} knowledgeId=${pka.knowledgeId}`);
    } else {
      process.stderr.write(pkaSerialized);
    }
  }

  console.error(
    `${LOG_PREFIX} completed datasetId=${result.dataset.id} backtestRunId=${result.backtestRunId} ` +
      `candidateId=${result.strategyCandidateId} blindId=${result.blindValidationResultId} ` +
      `knowledgeEvent=${result.knowledge.marketEventId} oosBarCount=${oosBarCount}`,
  );
}
if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
