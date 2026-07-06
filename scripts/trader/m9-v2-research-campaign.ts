/**
 * DEE-384 / M9 — Full Execution Server v2 research campaign CLI.
 *
 * Default posture: requires explicit operator authorization digests.
 * Build agents must NOT run this command against live Org-0 without operator go/no-go.
 *
 * Usage:
 *   pnpm trader:m9:campaign -- \\
 *     --org-id=<uuid> \\
 *     --strategy-id=mean_reversion_v0 \\
 *     --strategy-version=<BUMPED> \\
 *     --metrics-schema-version=2.0.0 \\
 *     --operator-campaign-authorization=<digest> \\
 *     --operator-blind-authorization=<digest> \\
 *     [--vault-dir=replay-runs/RI-P7/m9-v2-research-campaign-org0] \\
 *     [--enable-guardian-exits=1]
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
import { createLifecycleRecorder, createPostgresLifecycleRepository } from "@/lib/trader/lifecycle";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { listMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import {
  applyCampaignSuffixToStrategyVersion,
  assertStrategyCandidateSlotAvailablePostgres,
} from "@/lib/trader/research/m9-candidate-preflight";
import {
  M9_DEFAULT_DATASET_NAME,
  M9_DEFAULT_VAULT_DIR,
  parseEnableGuardianExits,
  parseM9Flags,
  parseM9MetricsSchemaVersion,
  parseM9OosBarCount,
  parseM9PortfolioConfig,
  resolveM9CampaignStrategy,
  resolveM9SymbolInterval,
} from "@/lib/trader/research/m9-campaign-flags";
import { buildM9GuardianReasonSampleExport } from "@/lib/trader/research/m9-guardian-sample-export";
import { buildM9LifecycleTraceExport } from "@/lib/trader/research/m9-lifecycle-trace-export";
import {
  assertM9BlindAuthorization,
  assertM9CampaignAuthorization,
  buildM9OperatorAuthorizationRecord,
  computeM9BlindAuthorizationDigest,
  computeM9CampaignAuthorizationDigest,
  type M9BlindAuthorizationScope,
  type M9CampaignAuthorizationScope,
} from "@/lib/trader/research/m9-operator-authorization";
import { buildM9V2MetricsExport } from "@/lib/trader/research/m9-v2-metrics-export";
import {
  finalizeResearchCampaignOutcomePostgres,
  sealResearchCampaignOutcomeArtifacts,
} from "@/lib/trader/research/finalize-research-campaign-outcome";
import { tryLoadCanonicalInventorySnapshot } from "@/lib/trader/research/load-campaign-inventory-snapshot";
import { ResearchPipelineRegimeFailureError } from "@/lib/trader/research/errors";
import { runResearchPipelinePostgres } from "@/lib/trader/research/research-orchestrator";
import type { ResearchValidationBacktestArtifactSink } from "@/lib/trader/research/research-backtest-runner";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
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

const LOG_PREFIX = "[trader:m9:campaign]";

export type M9ResearchCampaignManifest = {
  schemaVersion: "m9_v2_research_campaign_v1";
  campaignId: string;
  generatedAt: string;
  builderGitSha: string | null;
  organizationId: string;
  symbol: string;
  interval: string;
  strategyId: string;
  strategyVersion: string;
  metricsSchemaVersion: string;
  oosBarCount: number;
  vaultDir: string;
  promotionAttempted: false;
  enableGuardianExits: boolean;
  artifactPaths: {
    evidence: string;
    pka: string;
    metricsExport: string;
    lifecycleTrace: string;
    guardianSample: string | null;
    operatorAuthorization: string;
  };
  digests: {
    evidence: string;
    pka: string;
    metricsExport: string | null;
    lifecycleTrace: string | null;
    guardianSample: string | null;
    campaignAuthorization: string;
    blindAuthorization: string;
  };
  knowledgeId: string | null;
  regimeSatisfiesRequirement: boolean | null;
  note: string;
};

export function printM9CampaignUsage(): void {
  console.log(`M9 v2 research campaign (operator-authorized)

Usage:
  pnpm trader:m9:campaign -- \\
    --org-id=<uuid> \\
    --strategy-id=mean_reversion_v0 \\
    --strategy-version=<BUMPED> \\
    --metrics-schema-version=2.0.0 \\
    --operator-campaign-authorization=<digest> \\
    --operator-blind-authorization=<digest> \\
    [--vault-dir=${M9_DEFAULT_VAULT_DIR}] \\
    [--campaign-suffix=<suffix>] \\
    [--starting-balance-usdt=1000000.00] \\
    [--enable-guardian-exits=1]

Environment:
  WAIA_DB_BACKEND=postgres
  DATABASE_URL_POSTGRES
  WAIA_TRADER_CLI=1
  M9_STARTING_BALANCE_USDT (optional portfolio override)`);
}

function requireFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)?.trim();
  if (!value) {
    throw new Error(`${LOG_PREFIX} --${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const flags = parseM9Flags(process.argv.slice(2));
  if (flags.has("help")) {
    printM9CampaignUsage();
    return;
  }

  const organizationId = requireFlag(flags, "org-id");
  const operatorCampaignAuthorization = requireFlag(flags, "operator-campaign-authorization");
  const operatorBlindAuthorization = requireFlag(flags, "operator-blind-authorization");
  parseM9MetricsSchemaVersion(flags);

  const { symbol, interval } = resolveM9SymbolInterval(flags);
  const vaultDir = resolve(flags.get("vault-dir")?.trim() || M9_DEFAULT_VAULT_DIR);
  const oosBarCount = parseM9OosBarCount(flags);
  const portfolioConfig = parseM9PortfolioConfig(flags);
  const enableGuardianExits = parseEnableGuardianExits(flags);
  const campaignSuffix = flags.get("campaign-suffix")?.trim();
  const datasetName = flags.get("dataset-name")?.trim() || M9_DEFAULT_DATASET_NAME;
  const operatorId = flags.get("operator-id")?.trim() ?? null;

  const baseStrategy = resolveM9CampaignStrategy(flags);
  const strategyVersion = applyCampaignSuffixToStrategyVersion(
    baseStrategy.strategyVersion,
    campaignSuffix,
  );

  const campaignScope: M9CampaignAuthorizationScope = {
    organizationId,
    strategyId: baseStrategy.strategyId,
    strategyVersion,
    symbol,
    interval,
    vaultDir,
    metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
    campaignSuffix,
  };
  assertM9CampaignAuthorization(operatorCampaignAuthorization, campaignScope);

  const blindScope: M9BlindAuthorizationScope = {
    ...campaignScope,
    datasetName,
  };
  assertM9BlindAuthorization(operatorBlindAuthorization, blindScope);

  mkdirSync(vaultDir, { recursive: true });

  const authorizationRecord = buildM9OperatorAuthorizationRecord({
    campaignScope,
    blindScope,
    campaignAuthorizationDigest: computeM9CampaignAuthorizationDigest(campaignScope),
    blindAuthorizationDigest: computeM9BlindAuthorizationDigest(blindScope),
    operatorId,
  });
  const authorizationPath = resolve(vaultDir, "operator-authorization-record.json");
  writeFileSync(authorizationPath, `${JSON.stringify(authorizationRecord, null, 2)}\n`, "utf8");

  const db = getPostgresDrizzle();
  const context = requireOrgContext(organizationId);
  await assertStrategyCandidateSlotAvailablePostgres(
    db,
    context,
    baseStrategy.strategyId,
    strategyVersion,
  );

  const writeAudit = (input: Parameters<typeof writeTraderAuditLogPostgres>[1]) =>
    writeTraderAuditLogPostgres(db, input);
  const nowMs = () => Date.now();
  const connector = new MockExchangeConnector();
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

  const limits = createPostgresRiskLimitsService(db);
  await limits.upsertLimitsForOrg(context, { ...DEFAULT_ORG_RISK_LIMITS });

  const lifecycleRepository = createPostgresLifecycleRepository(db);
  const lifecycleRecorder = createLifecycleRecorder({ repository: lifecycleRepository });

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
    lifecycleRecorder,
  });
  const reconciliation = createPostgresReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs,
    writeAudit,
  });

  const barRecords = await listMarketBarsPostgres(db, context, { symbol, interval });
  const barSetDigest = computeBarSetDigest(barRecords);
  const builderGitSha = process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  const validationArtifactSink: ResearchValidationBacktestArtifactSink = {};

  try {
    const result = await runResearchPipelinePostgres(db, {
      context,
      datasetName,
      symbol,
      interval,
      strategyId: baseStrategy.strategyId,
      strategyVersion,
      oosBarCount,
      deps: { execution, reconciliation, lifecycleRecorder, lifecycleRepository },
      createOrderRepository: () => orderRepository,
      pipelineBacktest: {
        metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
        portfolioConfig,
        guardian: {
          enabled: enableGuardianExits,
          enableExitEngine: enableGuardianExits,
        },
        operatorBlindAuthorization,
        blindAuthorizationScope: blindScope,
        validationArtifactSink,
      },
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
      builderGitSha,
    });

    const evidencePath = resolve(vaultDir, "m9-research-evidence.json");
    const pkaPath = resolve(vaultDir, "m9-production-knowledge-asset.json");
    const metricsExportPath = resolve(vaultDir, "m9-v2-metrics-export.json");
    const lifecycleTracePath = resolve(vaultDir, "m9-lifecycle-trace.json");

    writeFileSync(evidencePath, `${JSON.stringify(result.evidenceDocument, null, 2)}\n`, "utf8");
    writeFileSync(pkaPath, serializeProductionKnowledgeAsset(pka), "utf8");

    const metricsExport = buildM9V2MetricsExport({
      portfolioConfig,
      validationMetrics: result.validationMetrics,
      blindMetrics: result.blindMetrics,
    });
    writeFileSync(metricsExportPath, `${JSON.stringify(metricsExport, null, 2)}\n`, "utf8");

    const lifecycleTrace = await buildM9LifecycleTraceExport({
      context,
      lifecycleRepository,
      strategyId: baseStrategy.strategyId,
      strategyVersion,
    });
    writeFileSync(lifecycleTracePath, `${JSON.stringify(lifecycleTrace, null, 2)}\n`, "utf8");

    let guardianSamplePath: string | null = null;
    if (enableGuardianExits && result.validationCycleResults) {
      guardianSamplePath = resolve(vaultDir, "m9-guardian-reason-sample.json");
      const guardianSample = buildM9GuardianReasonSampleExport({
        organizationId,
        strategyId: baseStrategy.strategyId,
        strategyVersion,
        cycleResults: result.validationCycleResults,
      });
      writeFileSync(guardianSamplePath, `${JSON.stringify(guardianSample, null, 2)}\n`, "utf8");
    }

    const manifest: M9ResearchCampaignManifest = {
      schemaVersion: "m9_v2_research_campaign_v1",
      campaignId: `m9-v2-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      builderGitSha,
      organizationId,
      symbol,
      interval,
      strategyId: baseStrategy.strategyId,
      strategyVersion,
      metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
      oosBarCount,
      vaultDir,
      promotionAttempted: false,
      enableGuardianExits,
      artifactPaths: {
        evidence: evidencePath,
        pka: pkaPath,
        metricsExport: metricsExportPath,
        lifecycleTrace: lifecycleTracePath,
        guardianSample: guardianSamplePath,
        operatorAuthorization: authorizationPath,
      },
      digests: {
        evidence: result.evidenceDocument.envelope.contentDigest,
        pka: pka.reproducibilityDigest,
        metricsExport: null,
        lifecycleTrace: null,
        guardianSample: null,
        campaignAuthorization: operatorCampaignAuthorization,
        blindAuthorization: operatorBlindAuthorization,
      },
      knowledgeId: pka.knowledgeId,
      regimeSatisfiesRequirement: edgeVerified,
      note: "M9 v2 research campaign — promotion forbidden; mock ledger research isolation only.",
    };

    const inventory = await tryLoadCanonicalInventorySnapshot(db, context, { orderRepository });
    const successOutcome = await finalizeResearchCampaignOutcomePostgres(db, context, {
      kind: "success",
      scope: {
        organizationId,
        strategyId: baseStrategy.strategyId,
        strategyVersion,
      },
      inventory,
      builderGitSha,
    });

    const sealedPaths = sealResearchCampaignOutcomeArtifacts({
      vaultDir,
      naming: "flat",
      diagnosticsBasename: "m9-campaign-operator-diagnostics.json",
      outcome: successOutcome,
      manifest,
      manifestBasename: "m9-campaign-manifest.json",
    });

    console.error(
      `${LOG_PREFIX} complete strategy=${baseStrategy.strategyId}@${strategyVersion} ` +
        `knowledgeId=${pka.knowledgeId} regimeOk=${edgeVerified} manifest=${sealedPaths.manifestPath} ` +
        `diagnostics=${sealedPaths.operatorDiagnosticsPath}`,
    );

    if (!edgeVerified) {
      console.error(`${LOG_PREFIX} regime coverage failed — promotion blocked (exit 1)`);
      process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof ResearchPipelineRegimeFailureError) {
      const rejectOutcome = await finalizeResearchCampaignOutcomePostgres(db, context, {
        kind: "governed_reject",
        scope: {
          organizationId,
          strategyId: baseStrategy.strategyId,
          strategyVersion,
        },
        governedReject: error,
        orderRepository,
        builderGitSha,
      });
      const artifactPaths = sealResearchCampaignOutcomeArtifacts({
        vaultDir,
        naming: "flat",
        rejectionBasename: "m9-research-rejection-record.json",
        evolutionBasename: "m9-evolution-cycle-mvp.json",
        diagnosticsBasename: "m9-campaign-operator-diagnostics.json",
        outcome: rejectOutcome,
      });

      console.error(
        `${LOG_PREFIX} STRATEGY_FAILED rejection=${artifactPaths.rejectionRecordPath} ` +
          `evolution=${artifactPaths.evolutionCyclePath} ` +
          `diagnostics=${artifactPaths.operatorDiagnosticsPath}`,
      );
      process.exitCode = 1;
      return;
    }

    const crashOutcome = await finalizeResearchCampaignOutcomePostgres(db, context, {
      kind: "crash",
      scope: {
        organizationId,
        strategyId: baseStrategy.strategyId,
        strategyVersion,
        datasetId: datasetName,
      },
      error,
      orderRepository,
      builderGitSha,
    });
    const artifactPaths = sealResearchCampaignOutcomeArtifacts({
      vaultDir,
      naming: "flat",
      rejectionBasename: "m9-research-rejection-record.json",
      evolutionBasename: "m9-evolution-cycle-mvp.json",
      diagnosticsBasename: "m9-campaign-operator-diagnostics.json",
      outcome: crashOutcome,
    });

    console.error(
      `${LOG_PREFIX} CAMPAIGN_CRASH rejection=${artifactPaths.rejectionRecordPath} ` +
        `evolution=${artifactPaths.evolutionCyclePath} ` +
        `diagnostics=${artifactPaths.operatorDiagnosticsPath}`,
    );
    process.exitCode = 1;
    return;
  }
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
