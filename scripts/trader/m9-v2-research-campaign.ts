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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createLongRunningCampaignPostgresRuntime,
  disposePostgresClientSafely,
  withCampaignDbRetry,
} from "@/db/postgres-client";
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
  assertM9V017RunProfile,
  M9_DEFAULT_DATASET_NAME,
  M9_DEFAULT_VAULT_DIR,
  parseEnableGuardianExits,
  parseM9Flags,
  parseM9MetricsSchemaVersion,
  parseM9OosBarCount,
  parseM9PortfolioConfig,
  parseRequireProviderFusion,
  resolveM9ProviderSidecarPath,
  loadM9ProviderSidecar,
  resolveM9CampaignStrategy,
  resolveM9SymbolInterval,
} from "@/lib/trader/research/m9-campaign-flags";
import { computeM9DatasetSealPreviewPostgres } from "@/lib/trader/research/m9-dataset-seal-preview";
import { buildM9DecisionTraceExport } from "@/lib/trader/research/m9-decision-trace-export";
import { buildM9GuardianReasonSampleExport } from "@/lib/trader/research/m9-guardian-sample-export";
import {
  assertProviderFusionRequirements,
  buildM9ProviderCoverageMatrixMarkdown,
  buildM9ProviderFusionExport,
  computeArtifactFileDigest,
} from "@/lib/trader/research/m9-provider-fusion-export";
import { computeSidecarContentDigest } from "@/lib/trader/market-data/replay/sidecar-content-digest";
import { isReplayProviderSidecarV2 } from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { buildM9LifecycleTraceExport } from "@/lib/trader/research/m9-lifecycle-trace-export";
import { buildM9MarketUnderstandingSampleExport } from "@/lib/trader/research/m9-market-understanding-export";
import {
  assertM9BlindAuthorizationV2,
  assertM9CampaignAuthorization,
  buildM9BlindAuthorizationScope,
  buildM9OperatorAuthorizationRecord,
  computeM9BlindAuthorizationDigest,
  computeM9CampaignAuthorizationDigest,
  type M9CampaignAuthorizationScope,
} from "@/lib/trader/research/m9-operator-authorization";
import { createManualReplayClock } from "@/lib/trader/research/deterministic-replay-clock";
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
import {
  buildCampaignRunFrontmatter,
  type CampaignRunFrontmatter,
} from "@/lib/trader/research/campaign-run-frontmatter";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const LOG_PREFIX = "[trader:m9:campaign]";

/**
 * Fixed governance-gate placeholder scale (NOT an evidence-derived score). PKA confidence
 * scoring from actual blind/walk-forward metrics is deferred to a future PR — see ADR-0021
 * scope note. Explicitly de-labeled per DEE-397 audit finding so this is not mistaken for a
 * measured edge-confidence metric.
 */
const PKA_GOVERNANCE_GATE_EDGE_CONFIDENCE_VERIFIED = "0.7500";
const PKA_GOVERNANCE_GATE_EDGE_CONFIDENCE_UNVERIFIED = "0.2500";
const PKA_GOVERNANCE_GATE_EDGE_STRENGTH_PLACEHOLDER = "0.5000";

export type M9ResearchCampaignManifest = {
  schemaVersion: "m9_v2_research_campaign_v1";
  campaignId: string;
  generatedAt: string;
  /** Additive provenance block (DEE-407) — does not alter pipeline/blind-holdout semantics. */
  frontmatter: CampaignRunFrontmatter;
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
    marketUnderstandingSample: string | null;
    providerSidecar: string | null;
    providerFusion: string | null;
    providerCoverageMatrix: string | null;
    decisionTrace: string | null;
    operatorAuthorization: string;
  };
  digests: {
    evidence: string;
    pka: string;
    metricsExport: string | null;
    lifecycleTrace: string | null;
    guardianSample: string | null;
    marketUnderstandingSample: string | null;
    providerSidecar: string | null;
    providerFusion: string | null;
    providerCoverageMatrix: string | null;
    decisionTrace: string | null;
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
    [--provider-sidecar-path=<path>] \\
    [--require-provider-fusion=1] \\
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
  const requireProviderFusion = parseRequireProviderFusion(flags);
  const campaignSuffix = flags.get("campaign-suffix")?.trim();
  const datasetName = flags.get("dataset-name")?.trim() || M9_DEFAULT_DATASET_NAME;
  const operatorId = flags.get("operator-id")?.trim() ?? null;

  const providerSidecarPath = resolveM9ProviderSidecarPath(flags, vaultDir);
  const providerSidecar = loadM9ProviderSidecar(providerSidecarPath);
  const sidecarContentDigest = providerSidecar
    ? computeSidecarContentDigest(providerSidecar)
    : null;

  // Repeat M9 v0.1.7 run profile (DEE-398 / ADR-0022): sidecar v2, provider fusion, and
  // guardian exits must all be explicitly enabled — an authorized run must never silently
  // omit any of these gates. Checked before any file/DB write.
  assertM9V017RunProfile({
    requireProviderFusion,
    enableGuardianExits,
    sidecarIsV2: Boolean(providerSidecar && isReplayProviderSidecarV2(providerSidecar)),
  });

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

  // Resilient long-running campaign connection (DEE-399): prefers a session-mode/direct
  // Postgres URL over the Supabase transaction pooler for this multi-hour single connection —
  // see db/postgres-client.ts createLongRunningCampaignPostgresRuntime(). Disposed in the
  // `finally` below regardless of success/governed-reject/crash outcome.
  const { db, _sql: campaignSql, urlSource } = createLongRunningCampaignPostgresRuntime();
  console.error(`${LOG_PREFIX} campaign DB connection source=${urlSource}`);
  const context = requireOrgContext(organizationId);

  try {
    await runM9CampaignBody();
  } finally {
    await disposePostgresClientSafely(campaignSql);
  }

  async function runM9CampaignBody(): Promise<void> {
    // Preflight seal (DEE-398 / ADR-0022): binds the blind authorization to the actual sealed
    // replay content — not just the dataset name/label — before any authorization record or
    // side effect is written. The orchestrator re-seals and re-verifies this same content at
    // runtime (fail-closed on mismatch).
    // Idempotent read — safe to retry a transient connection drop (DEE-399).
    const sealPreview = await withCampaignDbRetry(() =>
      computeM9DatasetSealPreviewPostgres(db, context, { symbol, interval }),
    );
    const blindScope = buildM9BlindAuthorizationScope({
      campaignScope,
      datasetName,
      blindDigest: sealPreview.sealed.blindDigest,
      sidecarContentDigest,
    });
    assertM9BlindAuthorizationV2(operatorBlindAuthorization, blindScope);

    // Remaining fail-fast preflight — must also pass before any authorization record or side
    // effect is written (no partial/misleading vault state on a rejected run).
    // Idempotent read-only assertion — safe to retry (DEE-399).
    await withCampaignDbRetry(() =>
      assertStrategyCandidateSlotAvailablePostgres(
        db,
        context,
        baseStrategy.strategyId,
        strategyVersion,
      ),
    );

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

    const writeAudit = (input: Parameters<typeof writeTraderAuditLogPostgres>[1]) =>
      writeTraderAuditLogPostgres(db, input);
    // Deterministic replay clock (DEE-397 / ADR-0021): the backtest runner advances this to
    // each cycle's evaluated bar time before invoking execution/risk deps, so `nowMs()` never
    // observes the wall clock while replaying. The seed value below is only ever read before
    // the first backtest cycle sets it and never reaches a risk decision, order, or digest.
    const replayClock = createManualReplayClock(Date.now());
    const nowMs = () => replayClock.nowMs();
    const rateStore = createInMemoryOrderRateStore();
    const connector = new MockExchangeConnector({ nowMs });
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
      rateStore,
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

    // Idempotent read — safe to retry a transient connection drop (DEE-399).
    const barRecords = await withCampaignDbRetry(() =>
      listMarketBarsPostgres(db, context, { symbol, interval }),
    );
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
        deps: {
          execution,
          reconciliation,
          lifecycleRecorder,
          lifecycleRepository,
          researchReplayDeterminism: {
            clock: replayClock,
            resetWindowState: () => rateStore.clear(),
          },
        },
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
          providerSidecar,
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
        edgeConfidence: edgeVerified
          ? PKA_GOVERNANCE_GATE_EDGE_CONFIDENCE_VERIFIED
          : PKA_GOVERNANCE_GATE_EDGE_CONFIDENCE_UNVERIFIED,
        edgeStrength: PKA_GOVERNANCE_GATE_EDGE_STRENGTH_PLACEHOLDER,
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

      let marketUnderstandingSamplePath: string | null = null;
      if (validationArtifactSink.cycleResults && validationArtifactSink.cycleResults.length > 0) {
        marketUnderstandingSamplePath = resolve(vaultDir, "m9-market-understanding-sample.json");
        const understandingSample = buildM9MarketUnderstandingSampleExport({
          organizationId,
          strategyId: baseStrategy.strategyId,
          strategyVersion,
          cycleResults: validationArtifactSink.cycleResults,
        });
        writeFileSync(
          marketUnderstandingSamplePath,
          `${JSON.stringify(understandingSample, null, 2)}\n`,
          "utf8",
        );
      }

      const providerSidecarArtifactPath = providerSidecarPath ?? null;
      let providerFusionPath: string | null = null;
      let providerCoverageMatrixPath: string | null = null;
      let decisionTracePath: string | null = null;
      let providerFusionDigest: string | null = null;
      let providerCoverageMatrixDigest: string | null = null;
      let decisionTraceDigest: string | null = null;

      if (validationArtifactSink.cycleResults && validationArtifactSink.cycleResults.length > 0) {
        const fusedSamples = validationArtifactSink.cycleResults
          .map((cycle) => cycle.evaluation.fusedContext)
          .filter((fused): fused is NonNullable<typeof fused> => fused !== undefined);

        providerFusionPath = resolve(vaultDir, "m9-provider-fusion.json");
        const providerFusion = buildM9ProviderFusionExport({
          organizationId,
          strategyId: baseStrategy.strategyId,
          strategyVersion,
          instrumentId: symbol,
          fusedSamples,
          providerSidecar,
        });
        if (requireProviderFusion) {
          assertProviderFusionRequirements(providerFusion);
        }
        const providerFusionJson = `${JSON.stringify(providerFusion, null, 2)}\n`;
        writeFileSync(providerFusionPath, providerFusionJson, "utf8");
        providerFusionDigest = providerFusion.contentDigest;

        providerCoverageMatrixPath = resolve(vaultDir, "m9-provider-coverage-matrix.md");
        const coverageMarkdown = buildM9ProviderCoverageMatrixMarkdown(providerFusion);
        writeFileSync(providerCoverageMatrixPath, coverageMarkdown, "utf8");
        providerCoverageMatrixDigest = computeArtifactFileDigest(coverageMarkdown);

        decisionTracePath = resolve(vaultDir, "m9-decision-trace.json");
        const decisionTrace = buildM9DecisionTraceExport({
          organizationId,
          strategyId: baseStrategy.strategyId,
          strategyVersion,
          cycleResults: validationArtifactSink.cycleResults,
        });
        const decisionTraceJson = `${JSON.stringify(decisionTrace, null, 2)}\n`;
        writeFileSync(decisionTracePath, decisionTraceJson, "utf8");
        decisionTraceDigest = decisionTrace.contentDigest;
      } else if (requireProviderFusion) {
        throw new Error(
          `${LOG_PREFIX} --require-provider-fusion=1 requires validation cycle results with fused context`,
        );
      }

      const manifest: M9ResearchCampaignManifest = {
        schemaVersion: "m9_v2_research_campaign_v1",
        campaignId: `m9-v2-${Date.now()}`,
        generatedAt: new Date().toISOString(),
        frontmatter: buildCampaignRunFrontmatter({
          runId: result.backtestRunId,
          gitSha: builderGitSha,
          dbConnectionMode: urlSource,
        }),
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
          marketUnderstandingSample: marketUnderstandingSamplePath,
          providerSidecar: providerSidecarArtifactPath,
          providerFusion: providerFusionPath,
          providerCoverageMatrix: providerCoverageMatrixPath,
          decisionTrace: decisionTracePath,
          operatorAuthorization: authorizationPath,
        },
        digests: {
          evidence: result.evidenceDocument.envelope.contentDigest,
          pka: pka.reproducibilityDigest,
          metricsExport: computeArtifactFileDigest(readFileSync(metricsExportPath, "utf8")),
          lifecycleTrace: computeArtifactFileDigest(readFileSync(lifecycleTracePath, "utf8")),
          guardianSample: guardianSamplePath
            ? computeArtifactFileDigest(readFileSync(guardianSamplePath, "utf8"))
            : null,
          marketUnderstandingSample: marketUnderstandingSamplePath
            ? computeArtifactFileDigest(readFileSync(marketUnderstandingSamplePath, "utf8"))
            : null,
          providerSidecar: sidecarContentDigest,
          providerFusion: providerFusionDigest,
          providerCoverageMatrix: providerCoverageMatrixDigest,
          decisionTrace: decisionTraceDigest,
          campaignAuthorization: operatorCampaignAuthorization,
          blindAuthorization: operatorBlindAuthorization,
        },
        knowledgeId: pka.knowledgeId,
        regimeSatisfiesRequirement: edgeVerified,
        note: "M9 v2 research campaign — promotion forbidden; mock ledger research isolation only.",
      };

      // Finalization seal (DEE-399): idempotent inventory read + diagnostics build, retried on a
      // transient connection drop so the success artifact is reliably sealed.
      const inventory = await withCampaignDbRetry(() =>
        tryLoadCanonicalInventorySnapshot(db, context, { orderRepository }),
      );
      const successOutcome = await withCampaignDbRetry(() =>
        finalizeResearchCampaignOutcomePostgres(db, context, {
          kind: "success",
          scope: {
            organizationId,
            strategyId: baseStrategy.strategyId,
            strategyVersion,
          },
          inventory,
          builderGitSha,
        }),
      );

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
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
