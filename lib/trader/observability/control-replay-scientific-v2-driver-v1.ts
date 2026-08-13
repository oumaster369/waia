import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  applyResearchReplaySqlitePragmas,
  getDb,
  getRawSqliteDatabase,
  resetWaiaSqliteSingleton,
} from "@/db/client";
import {
  ACCOUNTING_BASIS_METHOD,
  ACCOUNTING_ENGINE_ID,
  ACCOUNTING_FRONTIER_SCHEMA_VERSION,
  computeAccountingSemanticDigest,
} from "@/lib/trader/accounting";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { COST_MODEL_VERSION_V1 } from "@/lib/trader/execution/cost-model";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
} from "@/lib/trader/execution";
import { closeIdhpsSession, openIdhpsSession } from "@/lib/trader/execution/idhps-session-registry";
import {
  buildDecisionEconomicsV2Record,
  buildV2WhyNotCashJson,
  decisionEvRangeFromRecord,
} from "@/lib/trader/intelligence/decision-economics/decision-economics-v2-service";
import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import type { ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type { StrategySignal } from "@/lib/trader/intelligence/types";
import { createLifecycleRecorder, createSqliteLifecycleRepository } from "@/lib/trader/lifecycle";
import {
  CONTROL_REPLAY_AUTHORITY_IDENTITY,
  assertControlReplayTestOnlyAuthorityV1,
  TestOnlyAuthorityRejectedError,
  type ProductionSurface,
} from "@/lib/trader/observability/control-replay-test-authority";
import {
  assertControlReplayParityEqual,
  computeControlReplayParityDigest,
} from "@/lib/trader/observability/fhv-control-replay-parity-digest";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import { createInitialPortfolioAccountState } from "@/lib/trader/portfolio/derive-portfolio-account-state";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { computeStopBasedQuantity } from "@/lib/trader/portfolio/stop-based-sizing";
import { runExecutorReadyEndToEndV1 } from "@/lib/trader/research/challengers/rv-state-conditional-challenger-v1";
import {
  assertAuthorityChainStageCompleteness,
  assertExecutionWithinRiskAuthority,
  assertHypothesisConfidenceNonAuthoritative,
  AUTHORITY_CHAIN_STAGES,
  AuthorityChainViolationError,
  extractLegacyStrategyDiagnostics,
  V2_CAPITAL_AUTHORITY_PATH,
  type AuthorityChainStage,
} from "@/lib/trader/risk/authority-chain";
import { seedFhvSqliteResearchOrganization } from "@/lib/trader/observability/fhv-sqlite-research-org-seed";
import {
  createKillSwitchResolver,
  createRiskEngineService,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import type { TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export const CONTROL_REPLAY_SCIENTIFIC_V2_DRIVER_VERSION =
  "control-replay-scientific-v2-driver/v1" as const;

export const CONTROL_REPLAY_TEST_ONLY_ADMISSION_SCHEMA =
  "control-replay-test-only-scientific-admission/v1" as const;

/** Human executable-policy digest surface — unavailable until Human receipt (§1.23–1.25). */
export const EXECUTABLE_POLICY_DIGEST_UNAVAILABLE = "EXECUTABLE_POLICY_DIGEST_UNAVAILABLE" as const;

export type ScientificControlReplayV2Result = {
  driverVersion: typeof CONTROL_REPLAY_SCIENTIFIC_V2_DRIVER_VERSION;
  authority: typeof CONTROL_REPLAY_AUTHORITY_IDENTITY;
  capitalAuthorityPath: typeof V2_CAPITAL_AUTHORITY_PATH;
  completedStages: readonly AuthorityChainStage[];
  packageContentDigestHex: string;
  packageGenerationDigestHex: string;
  distributionSemanticDigestExec: string;
  distributionSemanticDigestTerminal: string;
  forecastId: string;
  scientificAdmissionReceiptDigest: string;
  decisionActionable: boolean;
  evLowerScale8: string;
  evBaseScale8: string;
  evUpperScale8: string;
  desiredQuantity: string;
  riskApprovedQuantity: string;
  executionQuantity: string;
  orderId: string | null;
  fillId: string | null;
  parityDigest: string;
  accountingSemanticDigest: string;
  executablePolicyDigest: typeof EXECUTABLE_POLICY_DIGEST_UNAVAILABLE;
  legacyStrategyDiagnostics: ReturnType<typeof extractLegacyStrategyDiagnostics>;
  whyNotCashJson: string;
};

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function digestToHex(digest: Buffer | Uint8Array | string): string {
  if (typeof digest === "string") {
    return digest;
  }
  return Buffer.from(digest).toString("hex");
}

function buildDeterministicCorpus(symbol: string): SourceAnchor[] {
  return Array.from({ length: 120 }, (_, i) => ({
    venue: "htx",
    market: "spot",
    symbol,
    closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
    barContentDigest: sha256Hex(`cr-v2-anchor:${symbol}:${i}`),
    realizedVol20m_1m: 0.01 + (i % 12) * 0.0015,
    outcome13d: [0, 0, 0, 0.012 + (i % 5) * 0.001, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  }));
}

function buildFamily(organizationId: string, symbol: string): ReplicaRootFamilyInput {
  return {
    organizationId,
    venue: "htx",
    market: "spot",
    symbol,
    primaryHorizonMinutes: 30,
    executionHorizonMinutes: 33,
    packageSubjectVersion: "pkg-subject/v1",
    terminalTargetDefinitionDigestHex: sha256Hex(`terminal-target:${symbol}`),
    executionOpportunityTargetDefinitionDigestHex: sha256Hex(`execopp-target:${symbol}`),
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    developmentDatasetDigestHex: sha256Hex("control-replay-scientific-v2-dev-dataset"),
    featureVersion: "feature-engine/rv/v2",
    normalizationVersionDigestHex: sha256Hex("control-replay-scientific-v2-normalization"),
    codeReleaseSha: "e".repeat(40),
  };
}

/**
 * Explicit TEST_ONLY scientific-admission evidence for Control Replay.
 * Bound to package digests; NOT a WF_PREDICTIVE production PASS manufacture.
 */
export function buildControlReplayTestOnlyScientificAdmissionDigest(input: {
  organizationId: string;
  packageContentDigestHex: string;
  packageGenerationDigestHex: string;
  distributionSemanticDigestExec: string;
}): { contentDigest: string; receiptJson: string } {
  const receipt = {
    schema: CONTROL_REPLAY_TEST_ONLY_ADMISSION_SCHEMA,
    authorityClass: CONTROL_REPLAY_AUTHORITY_IDENTITY.authorityClass,
    capitalEligible: CONTROL_REPLAY_AUTHORITY_IDENTITY.capitalEligible,
    executionPurpose: CONTROL_REPLAY_AUTHORITY_IDENTITY.executionPurpose,
    organizationId: input.organizationId,
    predictive_package_content_digest_hex: input.packageContentDigestHex,
    predictive_package_generation_identity_digest_hex: input.packageGenerationDigestHex,
    distribution_semantic_digest_exec: input.distributionSemanticDigestExec,
  };
  const receiptJson = JSON.stringify(receipt);
  return { contentDigest: sha256Hex(receiptJson), receiptJson };
}

export function assertControlReplayScientificAdmissionMatchesPackage(input: {
  admissionReceiptDigest: string;
  organizationId: string;
  packageContentDigestHex: string;
  packageGenerationDigestHex: string;
  distributionSemanticDigestExec: string;
}): void {
  const expected = buildControlReplayTestOnlyScientificAdmissionDigest({
    organizationId: input.organizationId,
    packageContentDigestHex: input.packageContentDigestHex,
    packageGenerationDigestHex: input.packageGenerationDigestHex,
    distributionSemanticDigestExec: input.distributionSemanticDigestExec,
  });
  if (input.admissionReceiptDigest !== expected.contentDigest) {
    throw new AuthorityChainViolationError(
      "scientific admission receipt digest mismatch vs package/forecast identity",
    );
  }
}

export function resolveExecutablePolicyDigestOrUnavailable(): typeof EXECUTABLE_POLICY_DIGEST_UNAVAILABLE {
  return EXECUTABLE_POLICY_DIGEST_UNAVAILABLE;
}

function buildDiagnosticStrategySignal(input: {
  organizationId: string;
  symbol: string;
  confidence?: string;
  expectedEdge?: string;
  maxRisk?: string;
}): StrategySignal {
  return {
    strategySignalId: "cr-v2-diagnostic-signal",
    strategyId: "liquidity_sweep_reversal_v0",
    strategyVersion: "0.0.0",
    organizationId: input.organizationId,
    symbol: input.symbol,
    outcome: "SIGNAL",
    side: "buy",
    confidence: input.confidence ?? "0.99",
    expectedEdge: input.expectedEdge ?? "9999",
    maxRisk: input.maxRisk ?? "0.000001",
    reasonCodes: ["CONTROL_REPLAY_LEGACY_DIAGNOSTIC_ONLY"],
    msvId: "cr-v2-msv",
    featureSetId: "cr-v2-features",
    evaluatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function expectEscapePrevented(surface: ProductionSurface): void {
  try {
    assertControlReplayTestOnlyAuthorityV1({
      surface,
      authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
    });
    throw new Error(`expected TEST_ONLY rejection on ${surface}`);
  } catch (error) {
    if (!(error instanceof TestOnlyAuthorityRejectedError)) {
      throw error;
    }
  }
}

/** Real mock Execution service (no historical short-circuit) for TEST_ONLY CR. */
async function createControlReplayMockExecutionSession(input: { organizationId: string }): Promise<{
  execution: ReturnType<typeof createOrderExecutionServiceFromDeps>;
  cleanup: () => void;
}> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-cr-v2-"));
  const dbPath = path.join(tempDir, "control-replay-v2.sqlite");
  process.env.DATABASE_URL = dbPath;
  closeIdhpsSession();
  resetWaiaSqliteSingleton();
  const db = getDb();
  migrate(db, { migrationsFolder: path.join(process.cwd(), "db/migrations") });
  applyResearchReplaySqlitePragmas(getRawSqliteDatabase());
  openIdhpsSession(getRawSqliteDatabase(), { enableBans: false });

  seedFhvSqliteResearchOrganization({
    db,
    organizationId: input.organizationId,
    operatorId: "00000000-0000-4000-8000-0000000000cr",
  });
  const limitsService = createSqliteRiskLimitsService(db);
  await limitsService.upsertLimitsForOrg(requireOrgContext(input.organizationId), {
    ...DEFAULT_ORG_RISK_LIMITS,
  });

  const nowMs = () => 1_700_000_000_000;
  const writeAudit = (_input: TraderAuditInput): string => {
    void _input;
    return "cr-v2-audit";
  };
  const connector = new MockExchangeConnector({ nowMs });
  await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
  const orderRepository = createSqliteOrderRepository(db);
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs,
  });
  const riskEngine = createRiskEngineService({
    limitsService,
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs,
    newDecisionId: () => randomUUID(),
  });
  const lifecycleRecorder = createLifecycleRecorder({
    repository: createSqliteLifecycleRepository(db),
    nowMs,
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
  return {
    execution,
    cleanup: () => {
      closeIdhpsSession();
      resetWaiaSqliteSingleton();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

export type RunScientificControlReplayV2Input = {
  organizationId?: string;
  symbol?: string;
  /** Override admission digest to force fail-closed paths in tests. */
  scientificAdmissionReceiptDigestOverride?: string | null;
  requireScientificAdmission?: boolean;
  /** Legacy StrategySignal diagnostic fields — must not affect V2 economics/sizing. */
  legacyStrategySignalPatch?: Partial<
    Pick<StrategySignal, "confidence" | "expectedEdge" | "maxRisk">
  >;
  /** Omit stages to prove fail-closed completeness (tests only). */
  omitStages?: readonly AuthorityChainStage[];
  skipExecutionSubmit?: boolean;
  convictionValue?: number;
};

/**
 * Authoritative DEE-518 Control Replay scientific V2 ceremony entrypoint.
 *
 * Forecast V2 → Decision Economics V2 → desired-size (v2) → Portfolio → Risk → Execution
 * under CONTROL_REPLAY_TEST_ONLY_AUTHORITY_V1 (capitalEligible=false).
 */
export async function runScientificControlReplayV2Ceremony(
  input: RunScientificControlReplayV2Input = {},
): Promise<ScientificControlReplayV2Result> {
  assertControlReplayTestOnlyAuthorityV1({
    surface: "CONTROL_REPLAY",
    authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
  });
  for (const surface of ["production", "FULL_HISTORICAL", "shadow", "live"] as const) {
    expectEscapePrevented(surface);
  }
  if (CONTROL_REPLAY_AUTHORITY_IDENTITY.capitalEligible !== false) {
    throw new AuthorityChainViolationError("CONTROL_REPLAY capitalEligible must remain false");
  }

  assertHypothesisConfidenceNonAuthoritative({
    convictionValue: input.convictionValue ?? null,
  });

  const organizationId = input.organizationId ?? "00000000-0000-4000-8000-000000000001";
  const symbol = input.symbol ?? "BTCUSDT";
  const completedStages: AuthorityChainStage[] = [];
  const omit = new Set(input.omitStages ?? []);

  const family = buildFamily(organizationId, symbol);
  const corpus = buildDeterministicCorpus(symbol);
  const { pkg, issuance } = runExecutorReadyEndToEndV1({
    family,
    sourceCorpus: corpus,
    kConfigDec: 3,
    mConfigDec: 4,
    anchorClosedBarEpochMs: corpus[corpus.length - 1]!.closedBarEpochMs,
    anchorRealizedVol20m_1m: corpus[corpus.length - 1]!.realizedVol20m_1m,
    executionHorizonMinutes: 33,
    normalizationVersionDigestHex: family.normalizationVersionDigestHex,
  });
  if (!omit.has("FORECAST")) {
    completedStages.push("FORECAST");
  }

  const packageContentDigestHex = digestToHex(pkg.predictivePackageContentDigest);
  const packageGenerationDigestHex = digestToHex(pkg.predictivePackageGenerationIdentityDigest);
  const distributionSemanticDigestExec = digestToHex(issuance.distributionSemanticDigestExec);
  const distributionSemanticDigestTerminal = digestToHex(
    issuance.distributionSemanticDigestTerminal,
  );

  const admission = buildControlReplayTestOnlyScientificAdmissionDigest({
    organizationId,
    packageContentDigestHex,
    packageGenerationDigestHex,
    distributionSemanticDigestExec,
  });

  // Capital-authoritative V2 path: admission is mandatory (no default-off).
  // TEST_ONLY ceremony may supply an explicit override digest only when it matches
  // package identity; missing/mismatch fails closed.
  const admissionDigest: string | null | undefined =
    input.scientificAdmissionReceiptDigestOverride === undefined
      ? admission.contentDigest
      : input.scientificAdmissionReceiptDigestOverride;

  if (!admissionDigest) {
    throw new AuthorityChainViolationError("scientific admission receipt missing");
  }
  if (input.scientificAdmissionReceiptDigestOverride === undefined) {
    assertControlReplayScientificAdmissionMatchesPackage({
      admissionReceiptDigest: admissionDigest,
      organizationId,
      packageContentDigestHex,
      packageGenerationDigestHex,
      distributionSemanticDigestExec,
    });
  } else if (admissionDigest !== admission.contentDigest) {
    throw new AuthorityChainViolationError(
      "scientific admission receipt digest mismatch vs package/forecast identity",
    );
  }
  if (input.requireScientificAdmission === false) {
    throw new AuthorityChainViolationError(
      "V2 capital Decision path cannot disable scientific admission",
    );
  }

  // Deterministic forecast id for Control Replay parity (not a live UUID surface).
  const forecastId = sha256Hex(
    `cr-v2-forecast:${organizationId}:${symbol}:${packageContentDigestHex}`,
  ).slice(0, 36);
  const economics = buildDecisionEconomicsV2Record({
    organizationId,
    forecastId,
    notionalUsdt: 10_000,
    costRate: 0.001,
    slippageBufferUsdt: 5,
    replicaSamples: issuance.samples,
    scientificAdmissionReceiptDigest: admissionDigest,
    scientificAdmissionVerified: true,
  });
  const evRange = decisionEvRangeFromRecord(economics);
  if (!omit.has("DECISION")) {
    completedStages.push("DECISION");
  }

  const whyNotCashJson = buildV2WhyNotCashJson({
    forecastId,
    packageContentDigestHex,
    packageGenerationDigestHex,
    evRange,
    admissionReceiptDigest: admissionDigest,
  });
  if (whyNotCashJson.includes("Active hypothesis conviction")) {
    throw new AuthorityChainViolationError("forbidden V2 risk-over-cash rationale");
  }

  const entryPrice = "50000";
  const diagnosticSignal = buildDiagnosticStrategySignal({
    organizationId,
    symbol: "BTC/USDT",
    ...input.legacyStrategySignalPatch,
  });
  const legacyStrategyDiagnostics = extractLegacyStrategyDiagnostics(diagnosticSignal);

  const portfolioLimits = {
    maxRiskPerTradePct: DEFAULT_ORG_RISK_LIMITS.maxRiskPerTradePct,
    maxPortfolioRiskPct: DEFAULT_ORG_RISK_LIMITS.maxPortfolioRiskPct,
    maxConcurrentPositions: DEFAULT_ORG_RISK_LIMITS.maxConcurrentPositions,
    maxNotional: DEFAULT_ORG_RISK_LIMITS.maxNotional,
  };
  const account = createInitialPortfolioAccountState({
    runConfig: DEFAULT_PORTFOLIO_RUN_CONFIG,
    limits: portfolioLimits,
    stopDistanceProvider: defaultStopDistanceProvider,
  });

  // Ceiling only — stop-based risk budget is authoritative (not fixed 0.01).
  const sizingCeiling = "100";
  const sizing = computeStopBasedQuantity({
    side: "buy",
    entryPrice,
    signal: diagnosticSignal,
    account,
    limits: portfolioLimits,
    runConfig: DEFAULT_PORTFOLIO_RUN_CONFIG,
    stopDistanceProvider: defaultStopDistanceProvider,
    costModel: { version: COST_MODEL_VERSION_V1, feesBps: "10", slippageBps: "5" },
    defaultQuantity: sizingCeiling,
    capitalAuthorityPath: V2_CAPITAL_AUTHORITY_PATH,
  });
  if (!sizing.ok) {
    throw new AuthorityChainViolationError(`V2 desired-size failed: ${sizing.reason}`);
  }
  if (!omit.has("DESIRED_SIZE")) {
    completedStages.push("DESIRED_SIZE");
  }
  if (!omit.has("PORTFOLIO")) {
    completedStages.push("PORTFOLIO");
  }

  const desiredQuantity = sizing.quantity;
  let riskApprovedQuantity = desiredQuantity;
  let executionQuantity = "0";
  let orderId: string | null = null;
  let fillId: string | null = null;
  let orderCount = 0;
  let fillCount = 0;

  const session = await createControlReplayMockExecutionSession({ organizationId });
  try {
    const orgContext = requireOrgContext(organizationId);
    if (!omit.has("RISK") && !omit.has("EXECUTION") && !input.skipExecutionSubmit) {
      if (evRange.decisionActionable) {
        const submitted = await session.execution.submitOrder(orgContext, {
          clientOrderId: `cr-v2-${forecastId.slice(0, 8)}`,
          idempotencyKey: `cr-v2-idem-${forecastId}`,
          executionMode: "mock",
          symbol: "BTC/USDT",
          side: "buy",
          type: "market",
          quantity: desiredQuantity,
          referencePrice: entryPrice,
          accountKey: "default",
          accountState: {
            positions: [],
            openOrderCount: 0,
            dailyPnl: "0",
            drawdown: "0",
            quoteExposureByCurrency: {},
            availableBalanceUsdt: account.availableBalanceUsdt,
            equityUsdt: account.equityUsdt,
            openRiskUsdt: account.openRiskUsdt,
            openPositionCount: account.openPositionCount,
          },
          stopDistanceUsdt: sizing.stopDistanceUsdt,
        });
        if (submitted.status !== "submitted") {
          throw new AuthorityChainViolationError(
            `execution submit not submitted: status=${submitted.status}`,
          );
        }
        riskApprovedQuantity = submitted.order.quantity;
        const filledOrApproved =
          submitted.order.filledQuantity && submitted.order.filledQuantity !== "0"
            ? submitted.order.filledQuantity
            : riskApprovedQuantity;
        assertExecutionWithinRiskAuthority({
          proposedQuantity: desiredQuantity,
          riskApprovedQuantity,
          executionQuantity: filledOrApproved,
        });
        executionQuantity = filledOrApproved;
        orderId = submitted.order.id;
        fillId = submitted.order.id;
        orderCount = 1;
        fillCount = executionQuantity !== "0" ? 1 : 0;
      } else {
        riskApprovedQuantity = "0";
        executionQuantity = "0";
      }
      completedStages.push("RISK");
      completedStages.push("EXECUTION");
    } else {
      if (!omit.has("RISK")) {
        completedStages.push("RISK");
      }
      if (!omit.has("EXECUTION") && !input.skipExecutionSubmit) {
        completedStages.push("EXECUTION");
      }
    }

    assertAuthorityChainStageCompleteness(completedStages, AUTHORITY_CHAIN_STAGES);

    const accountingSemanticDigest = computeAccountingSemanticDigest({
      schemaVersion: ACCOUNTING_FRONTIER_SCHEMA_VERSION,
      engineId: ACCOUNTING_ENGINE_ID,
      basisMethod: ACCOUNTING_BASIS_METHOD,
      organizationId,
      accountKey: "default",
      runId: "control-replay-scientific-v2",
      accountingSequence: 1,
      frontierAsOf: "2024-01-01T00:00:00.000Z",
      monthKey: "2024-01",
      cash: account.availableBalanceUsdt,
      positions: {},
      grossRealizedPnl: "0",
      netRealizedPnl: "0",
      marks: { "BTC/USDT": { price: entryPrice, barCloseTime: "2024-01-01T00:00:00.000Z" } },
      markedPositionValue: "0",
      equity: account.equityUsdt,
      equityHwm: account.equityUsdt,
      accountDrawdownBps: 0,
      consumedFillIds: fillId ? [fillId] : [],
    });

    const parityDigest = computeControlReplayParityDigest({
      executionPurpose: CONTROL_REPLAY_AUTHORITY_IDENTITY.executionPurpose,
      executionMode: CONTROL_REPLAY_AUTHORITY_IDENTITY.executionMode,
      authorityClass: CONTROL_REPLAY_AUTHORITY_IDENTITY.authorityClass,
      capitalEligible: false,
      decisionActionable: evRange.decisionActionable,
      evLowerScale8: evRange.evLowerScale8,
      evBaseScale8: evRange.evBaseScale8,
      evUpperScale8: evRange.evUpperScale8,
      orderCount,
      fillCount,
      checkpointDigest: sha256Hex(
        `${packageContentDigestHex}:${distributionSemanticDigestExec}:${desiredQuantity}`,
      ),
      semanticParityDigest: `${economics.contentDigest}:${accountingSemanticDigest}`,
    });

    return {
      driverVersion: CONTROL_REPLAY_SCIENTIFIC_V2_DRIVER_VERSION,
      authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
      capitalAuthorityPath: V2_CAPITAL_AUTHORITY_PATH,
      completedStages,
      packageContentDigestHex,
      packageGenerationDigestHex,
      distributionSemanticDigestExec,
      distributionSemanticDigestTerminal,
      forecastId,
      scientificAdmissionReceiptDigest: admissionDigest ?? "",
      decisionActionable: evRange.decisionActionable,
      evLowerScale8: evRange.evLowerScale8,
      evBaseScale8: evRange.evBaseScale8,
      evUpperScale8: evRange.evUpperScale8,
      desiredQuantity,
      riskApprovedQuantity,
      executionQuantity,
      orderId,
      fillId,
      parityDigest,
      accountingSemanticDigest,
      executablePolicyDigest: resolveExecutablePolicyDigestOrUnavailable(),
      legacyStrategyDiagnostics,
      whyNotCashJson,
    };
  } finally {
    session.cleanup();
  }
}

export async function assertScientificControlReplayV2TwoRunParity(): Promise<void> {
  const runOne = await runScientificControlReplayV2Ceremony();
  const runTwo = await runScientificControlReplayV2Ceremony();
  assertControlReplayParityEqual(runOne.parityDigest, runTwo.parityDigest);
  if (runOne.desiredQuantity !== runTwo.desiredQuantity) {
    throw new Error("V2 desired-size non-deterministic across replay runs");
  }
  if (runOne.packageContentDigestHex !== runTwo.packageContentDigestHex) {
    throw new Error("Forecast V2 package digest non-deterministic across replay runs");
  }
}
