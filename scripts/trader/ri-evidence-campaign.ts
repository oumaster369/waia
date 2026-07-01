/**
 * RI-P7 — Evidence campaign + Production Knowledge Asset recorder.
 *
 * Usage:
 *   WAIA_DB_BACKEND=postgres DATABASE_URL_POSTGRES=... pnpm trader:ri:campaign -- \
 *     --org-id=<uuid> \
 *     [--track=a|b|both] \
 *     [--vault-dir=replay-runs/RI-P7] \
 *     [--oos-bar-count=20]
 *
 * Requires WAIA_TRADER_CLI=1 (set by package.json script).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
import {
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  TREND_MOMENTUM_V0,
  TREND_MOMENTUM_V0_VERSION,
} from "@/lib/trader/intelligence/types";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { listMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
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

const LOG_PREFIX = "[trader:ri:campaign]";

export type CampaignTrack = "a" | "b" | "both";

export type CampaignTrackConfig = {
  trackId: "A" | "B";
  strategyId: string;
  strategyVersion: string;
  datasetName: string;
};

export const CAMPAIGN_TRACK_A: CampaignTrackConfig = {
  trackId: "A",
  strategyId: MEAN_REVERSION_V0,
  strategyVersion: MEAN_REVERSION_V0_VERSION,
  datasetName: "ri-p7-track-a-mean-reversion",
};

export const CAMPAIGN_TRACK_B: CampaignTrackConfig = {
  trackId: "B",
  strategyId: TREND_MOMENTUM_V0,
  strategyVersion: TREND_MOMENTUM_V0_VERSION,
  datasetName: "ri-p7-track-b-trend-momentum",
};

export type RiEvidenceCampaignManifest = {
  schemaVersion: "ri_p7_evidence_campaign_v1";
  campaignId: string;
  generatedAt: string;
  builderGitSha: string | null;
  organizationId: string;
  symbol: InstrumentId;
  interval: BarInterval;
  oosBarCount: number;
  note: string;
  tracks: Array<{
    trackId: "A" | "B";
    strategyId: string;
    strategyVersion: string;
    evidencePath: string;
    pkaPath: string;
    knowledgeId: string;
    evidenceDigest: string;
    pkaDigest: string;
    marketEventId: string;
    knowledgeEdgeId: string;
    regimeSatisfiesRequirement: boolean;
    regimeCoverage: {
      regimes: readonly string[];
      nonTrendingCount: number;
      downRegimeCount: number;
      satisfiesRequirement: boolean;
    };
    costModelVersion: string;
  }>;
  liveGatesPaused: string[];
};

export function printRiCampaignUsage(): void {
  console.log(`RI-P7 evidence + PKA campaign

Usage:
  pnpm trader:ri:campaign -- \\
    --org-id=<uuid> \\
    [--symbol=BTC/USDT] \\
    [--interval=1m] \\
    [--track=a|b|both] \\
    [--vault-dir=replay-runs/RI-P7] \\
    [--oos-bar-count=20]

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

export function resolveCampaignTracks(trackFlag: string | undefined): CampaignTrackConfig[] {
  const normalized = (trackFlag?.trim().toLowerCase() || "a") as CampaignTrack;
  if (normalized === "both") {
    return [CAMPAIGN_TRACK_A, CAMPAIGN_TRACK_B];
  }
  if (normalized === "b") {
    return [CAMPAIGN_TRACK_B];
  }
  return [CAMPAIGN_TRACK_A];
}

export function parseOosBarCount(flags: Map<string, string>): number {
  const raw = flags.get("oos-bar-count") ?? "20";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${LOG_PREFIX} --oos-bar-count must be a positive integer`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.has("help")) {
    printRiCampaignUsage();
    return;
  }

  const organizationId = flags.get("org-id")?.trim();
  if (!organizationId) {
    throw new Error(`${LOG_PREFIX} --org-id is required`);
  }

  const symbol = (flags.get("symbol")?.trim() || "BTC/USDT") as InstrumentId;
  const interval = (flags.get("interval")?.trim() || "1m") as BarInterval;
  const vaultDir = resolve(flags.get("vault-dir")?.trim() || "replay-runs/RI-P7");
  const oosBarCount = parseOosBarCount(flags);
  const tracks = resolveCampaignTracks(flags.get("track"));

  mkdirSync(vaultDir, { recursive: true });

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

  const barRecords = await listMarketBarsPostgres(db, context, { symbol, interval });
  const barSetDigest = computeBarSetDigest(barRecords);

  const manifestTracks: RiEvidenceCampaignManifest["tracks"] = [];
  let trackARegimeFailed = false;

  for (const track of tracks) {
    const result = await runResearchPipelinePostgres(db, {
      context,
      datasetName: track.datasetName,
      symbol,
      interval,
      strategyId: track.strategyId,
      strategyVersion: track.strategyVersion,
      oosBarCount,
      deps: { execution, reconciliation },
      createOrderRepository: () => createPostgresOrderRepository(db),
    });

    const edgeVerified = result.evidenceDocument.evidenceBody.regimeCoverage.satisfiesRequirement;
    const pka = buildProductionKnowledgeAsset({
      evidenceDocument: result.evidenceDocument,
      dataset: result.dataset,
      barSetDigest,
      barCount: barRecords.length,
      symbol,
      interval,
      walkForwardWindowCount: result.walkForwardWindowCount,
      blindMetrics: result.blindMetrics,
      mkbLinkage: result.knowledge,
      edgeConfidence: edgeVerified ? "0.7500" : "0.2500",
      edgeStrength: "0.5000",
      edgeVerified,
      builderGitSha: process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    });

    const evidencePath = resolve(
      vaultDir,
      `track-${track.trackId.toLowerCase()}-research-evidence.json`,
    );
    const pkaPath = resolve(
      vaultDir,
      `track-${track.trackId.toLowerCase()}-production-knowledge-asset.json`,
    );

    writeFileSync(evidencePath, `${JSON.stringify(result.evidenceDocument, null, 2)}\n`, "utf8");
    writeFileSync(pkaPath, serializeProductionKnowledgeAsset(pka), "utf8");

    manifestTracks.push({
      trackId: track.trackId,
      strategyId: track.strategyId,
      strategyVersion: track.strategyVersion,
      evidencePath,
      pkaPath,
      knowledgeId: pka.knowledgeId,
      evidenceDigest: result.evidenceDocument.envelope.contentDigest,
      pkaDigest: pka.reproducibilityDigest,
      marketEventId: result.knowledge.marketEventId,
      knowledgeEdgeId: result.knowledge.knowledgeEdgeId,
      regimeSatisfiesRequirement: edgeVerified,
      regimeCoverage: result.evidenceDocument.evidenceBody.regimeCoverage,
      costModelVersion: result.evidenceDocument.evidenceBody.costModelVersion,
    });

    if (track.trackId === "A" && !edgeVerified) {
      trackARegimeFailed = true;
    }

    console.error(
      `${LOG_PREFIX} track ${track.trackId} strategy=${track.strategyId} knowledgeId=${pka.knowledgeId} ` +
        `regimeOk=${edgeVerified}`,
    );
  }

  const manifest: RiEvidenceCampaignManifest = {
    schemaVersion: "ri_p7_evidence_campaign_v1",
    campaignId: `ri-p7-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    builderGitSha: process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    organizationId,
    symbol,
    interval,
    oosBarCount,
    note: "Human HC-3.5 ceremony required. Composer cannot promote or live-enable.",
    tracks: manifestTracks,
    liveGatesPaused: ["HC-3.5", "HC-4", "L4"],
  };

  const manifestPath = resolve(vaultDir, "campaign-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.error(`${LOG_PREFIX} manifest written: ${manifestPath}`);

  if (trackARegimeFailed) {
    console.error(
      `${LOG_PREFIX} Track A regime coverage failed — HC-3.5 promotion blocked (exit 1)`,
    );
    process.exitCode = 1;
  }
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
