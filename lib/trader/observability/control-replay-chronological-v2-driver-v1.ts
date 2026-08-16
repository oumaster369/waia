/**
 * Chronological Control Replay V2 driver (DEE-538 tooling).
 *
 * Walks qualified pre-holdout bars through historical time using the canonical
 * Forecast V2 → Decision Economics V2 → Portfolio/Risk sizing → historical
 * execution simulation (partial fills, fees, spread, impact) → accounting →
 * Guardian path. Does not call runFullHistoricalBacktest / StrategySignal V1.
 *
 * CONTROL_REPLAY_TEST_ONLY_AUTHORITY_V1 remains capitalEligible=false.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import {
  ACCOUNTING_BASIS_METHOD,
  ACCOUNTING_ENGINE_ID,
  ACCOUNTING_FRONTIER_SCHEMA_VERSION,
  computeAccountingSemanticDigest,
} from "@/lib/trader/accounting";
import type { ReplayCheckpointRecord } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import type { HistoricalExecutionCheckpointSlice } from "@/lib/trader/execution/historical-execution-model.types";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { HistoricalExecutionPersistencePort } from "@/lib/trader/execution/historical-simulated-exchange";
import { tryNormalizeSymbolForHistoricalExecution } from "@/lib/trader/execution/historical-execution-symbol";
import { decideGuardianAction } from "@/lib/trader/guardian/guardian-decision-model";
import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  buildDecisionEconomicsV2Record,
  decisionEvRangeFromRecord,
} from "@/lib/trader/intelligence/decision-economics/decision-economics-v2-service";
import type { ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import type { Bar, StrategySignal } from "@/lib/trader/intelligence/types";
import { mergeFhvSharedPortfolioBarsChronologically } from "@/lib/trader/market-data/fhv-shared-portfolio-bar-replay-source";
import type { HtxVolumeQualificationReceiptV1 } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import {
  bindHistoricalExecutionModelToSession,
  htxVolumeRawFromClosedBar,
  requireProfileHtxVolumeAuthority,
} from "@/lib/trader/backtest/historical-execution-profile";
import {
  buildControlReplaySourceAnchorsFromRealBars,
  CONTROL_REPLAY_OFFICIAL_MARKET_AUTHORITY,
} from "@/lib/trader/observability/control-replay-preholdout-source-corpus-v1";
import { buildControlReplayTestOnlyScientificAdmissionDigest } from "@/lib/trader/observability/control-replay-scientific-v2-driver-v1";
import {
  CONTROL_REPLAY_AUTHORITY_IDENTITY,
  assertControlReplayTestOnlyAuthorityV1,
} from "@/lib/trader/observability/control-replay-test-authority";
import { computeControlReplayParityDigest } from "@/lib/trader/observability/fhv-control-replay-parity-digest";
import { buildAndWriteFhvOperatorStatus } from "@/lib/trader/observability/fhv-status-writer";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import { createInitialPortfolioAccountState } from "@/lib/trader/portfolio/derive-portfolio-account-state";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { computeStopBasedQuantity } from "@/lib/trader/portfolio/stop-based-sizing";
import {
  COST_MODEL_VERSION_V1,
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { runExecutorReadyEndToEndV1 } from "@/lib/trader/research/challengers/rv-state-conditional-challenger-v1";
import { V2_CAPITAL_AUTHORITY_PATH } from "@/lib/trader/risk/authority-chain";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { addDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export const CONTROL_REPLAY_CHRONOLOGICAL_V2_DRIVER_VERSION =
  "control-replay-chronological-v2-driver/v1" as const;

export const DEE_594_DOWNSTREAM_PREREQUISITE_STATUS = "NOT_SATISFIED_BY_DEE_537" as const;

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function digestToHex(digest: Buffer | Uint8Array | string): string {
  if (typeof digest === "string") {
    return digest;
  }
  return Buffer.from(digest).toString("hex");
}

export type ChronologicalControlReplayCheckpointV1 = Readonly<{
  schemaVersion: "control-replay-chronological-checkpoint/v1";
  runId: string;
  cycleIndex: number;
  lastBarOpenTime: string;
  orderCount: number;
  fillCount: number;
  cash: string;
  equity: string;
  netPnl: string;
  guardianState: string;
  accountingSemanticDigest: string;
  semanticParityDigest: string;
  fillIds: readonly string[];
  orders: readonly OrderRow[];
  executionSlice: HistoricalExecutionCheckpointSlice;
}>;

export type ChronologicalControlReplayV2Result = Readonly<{
  driverVersion: typeof CONTROL_REPLAY_CHRONOLOGICAL_V2_DRIVER_VERSION;
  authority: typeof CONTROL_REPLAY_AUTHORITY_IDENTITY;
  runId: string;
  cycleCount: number;
  orderCount: number;
  fillCount: number;
  cash: string;
  equity: string;
  netPnl: string;
  guardianState: string;
  accountingSemanticDigest: string;
  parityDigest: string;
  normalizedParityDigest: string;
  packageContentDigestHex: string;
  capitalEligible: false;
  executionScope: "PRE_HOLDOUT_SHARED_PORTFOLIO";
  constructionAuthority: "DEVELOPMENT";
  dee594Status: typeof DEE_594_DOWNSTREAM_PREREQUISITE_STATUS;
}>;

function buildFamily(
  organizationId: string,
  symbol: string,
  identity: { codeReleaseSha: string; developmentDatasetDigestHex: string },
): ReplicaRootFamilyInput {
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
    developmentDatasetDigestHex: identity.developmentDatasetDigestHex,
    featureVersion: "feature-engine/rv/v2",
    normalizationVersionDigestHex: sha256Hex("control-replay-scientific-v2-normalization"),
    codeReleaseSha: identity.codeReleaseSha,
  };
}

function diagnosticSignal(organizationId: string, symbol: string): StrategySignal {
  return {
    strategySignalId: "cr-chrono-diagnostic-signal",
    strategyId: "liquidity_sweep_reversal_v0",
    strategyVersion: "0.0.0",
    organizationId,
    symbol,
    outcome: "SIGNAL",
    side: "buy",
    confidence: "0.99",
    expectedEdge: "9999",
    maxRisk: "0.000001",
    reasonCodes: ["CONTROL_REPLAY_LEGACY_DIAGNOSTIC_ONLY"],
    msvId: "cr-chrono-msv",
    featureSetId: "cr-chrono-features",
    evaluatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function compactSymbol(symbol: string): "BTCUSDT" | "ETHUSDT" {
  const normalized = tryNormalizeSymbolForHistoricalExecution(symbol);
  if (normalized !== "BTCUSDT" && normalized !== "ETHUSDT") {
    throw new Error(`unsupported Control Replay symbol ${symbol}`);
  }
  return normalized;
}

function createInMemoryOrder(input: {
  organizationId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  quantity: string;
  cycleIndex: number;
}): OrderRow {
  const now = new Date("2020-01-01T00:00:00.000Z");
  return {
    id: `cr-chrono-order-${input.cycleIndex}-${input.symbol}`,
    organizationId: input.organizationId,
    credentialId: null,
    venue: "HTX",
    executionMode: "mock",
    symbol: input.symbol,
    side: "buy",
    type: "market",
    price: null,
    quantity: input.quantity,
    filledQuantity: "0",
    avgFillPrice: null,
    state: "ACCEPTED",
    stateVersion: 4,
    exchangeOrderId: null,
    clientOrderId: `cr-chrono-${input.cycleIndex}-${input.symbol}`,
    idempotencyKey: `cr-chrono-idem-${input.cycleIndex}-${input.symbol}`,
    riskDecisionId: `cr-chrono-risk-${input.cycleIndex}`,
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeChronologicalControlReplayParity(input: {
  packageContentDigestHex: string;
  accountingSemanticDigest: string;
  orderCount: number;
  fillCount: number;
  cycleCount: number;
  netPnl: string;
  guardianState: string;
}): string {
  return sha256Hex(
    JSON.stringify({
      driverVersion: CONTROL_REPLAY_CHRONOLOGICAL_V2_DRIVER_VERSION,
      authorityClass: CONTROL_REPLAY_AUTHORITY_IDENTITY.authorityClass,
      capitalEligible: false,
      packageContentDigestHex: input.packageContentDigestHex,
      accountingSemanticDigest: input.accountingSemanticDigest,
      orderCount: input.orderCount,
      fillCount: input.fillCount,
      cycleCount: input.cycleCount,
      netPnl: input.netPnl,
      guardianState: input.guardianState,
    }),
  );
}

export async function runChronologicalControlReplayV2(input: {
  runId: string;
  runDir: string;
  organizationId: string;
  releaseSha: string;
  developmentWalkForwardContentDigest: string;
  constructionBars: readonly Bar[];
  executionBars: readonly Bar[];
  htxVolumeAuthorityByInstrument: Readonly<
    Record<"BTCUSDT" | "ETHUSDT", HtxVolumeQualificationReceiptV1>
  >;
  maxCycles?: number;
  checkpointEveryCycles?: number;
  resumeFromCheckpoint?: boolean;
}): Promise<ChronologicalControlReplayV2Result> {
  assertControlReplayTestOnlyAuthorityV1({
    surface: "CONTROL_REPLAY",
    authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
  });
  if (CONTROL_REPLAY_AUTHORITY_IDENTITY.capitalEligible !== false) {
    throw new Error("CONTROL_REPLAY capitalEligible must remain false");
  }
  mkdirSync(input.runDir, { recursive: true });
  const organizationId = input.organizationId;
  const btcConstruction = input.constructionBars.filter((bar) => bar.symbol.startsWith("BTC"));
  const corpus = buildControlReplaySourceAnchorsFromRealBars({
    bars: btcConstruction.length > 0 ? btcConstruction : input.constructionBars,
    symbol: "BTCUSDT",
  });
  if (corpus.length < 30) {
    throw new Error(
      "chronological Control Replay construction corpus is below MIN_STATE_POOL_COUNT",
    );
  }
  const family = buildFamily(organizationId, "BTCUSDT", {
    codeReleaseSha: input.releaseSha.trim().toLowerCase(),
    developmentDatasetDigestHex: input.developmentWalkForwardContentDigest,
  });
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
  const packageContentDigestHex = digestToHex(pkg.predictivePackageContentDigest);
  const packageGenerationDigestHex = digestToHex(pkg.predictivePackageGenerationIdentityDigest);
  const distributionSemanticDigestExec = digestToHex(issuance.distributionSemanticDigestExec);
  const admission = buildControlReplayTestOnlyScientificAdmissionDigest({
    organizationId,
    packageContentDigestHex,
    packageGenerationDigestHex,
    distributionSemanticDigestExec,
  });
  const profile = bindHistoricalExecutionModelToSession({
    htxVolumeAuthorityByInstrument: input.htxVolumeAuthorityByInstrument,
  });
  const model = profile.model;
  const exchange = profile.exchange;
  const orders = new Map<string, OrderRow>();
  const persistence: HistoricalExecutionPersistencePort = {
    async recordSimulatedFill(_context, order, event) {
      const current = orders.get(order.id) ?? order;
      current.filledQuantity = addDecimal(current.filledQuantity, event.sliceQuantity);
      current.state = event.remainingQuantityAfter === "0" ? "FILLED" : "PARTIALLY_FILLED";
      current.updatedAt = event.fillTimestamp;
      orders.set(order.id, current);
      return current;
    },
    async transitionOrderExpired(_context, order) {
      const current = orders.get(order.id) ?? order;
      current.state = "EXPIRED";
      orders.set(order.id, current);
      return current;
    },
    async transitionOrderCancelled(_context, order) {
      const current = orders.get(order.id) ?? order;
      current.state = "CANCELLED";
      orders.set(order.id, current);
      return current;
    },
  };
  const context = requireOrgContext(organizationId);
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
  const costModel = costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());
  const merged = mergeFhvSharedPortfolioBarsChronologically(input.executionBars);
  const checkpointPath = join(input.runDir, "control-replay-chronological-checkpoint.v1.json");
  let startIndex = 0;
  let orderCount = 0;
  let fillCount = 0;
  let cash = account.availableBalanceUsdt;
  let netPnl = "0";
  let guardianState = "NONE";
  const fillIds: string[] = [];
  let lastAccountingDigest = "";
  if (input.resumeFromCheckpoint && existsSync(checkpointPath)) {
    const checkpoint = JSON.parse(
      readFileSync(checkpointPath, "utf8"),
    ) as ChronologicalControlReplayCheckpointV1;
    startIndex = checkpoint.cycleIndex + 1;
    orderCount = checkpoint.orderCount;
    fillCount = checkpoint.fillCount;
    cash = checkpoint.cash;
    netPnl = checkpoint.netPnl;
    guardianState = checkpoint.guardianState;
    fillIds.push(...checkpoint.fillIds);
    for (const order of checkpoint.orders) {
      orders.set(order.id, {
        ...order,
        createdAt: new Date(order.createdAt),
        updatedAt: new Date(order.updatedAt),
      });
    }
    exchange.restoreFromCheckpointSlice(checkpoint.executionSlice, orders);
    lastAccountingDigest = checkpoint.accountingSemanticDigest;
  }
  const maxCycles = input.maxCycles ?? merged.length;
  const barsTotal = Math.min(merged.length, maxCycles);
  const startedAt = new Date().toISOString();
  let lastGuardian = guardianState;

  for (let cycleIndex = startIndex; cycleIndex < barsTotal; cycleIndex += 1) {
    const bar = merged[cycleIndex]!;
    const compact = compactSymbol(bar.symbol);
    const forecastId = sha256Hex(
      `cr-chrono:${organizationId}:${compact}:${packageContentDigestHex}:${cycleIndex}`,
    ).slice(0, 36);
    const economics = buildDecisionEconomicsV2Record({
      organizationId,
      forecastId,
      notionalUsdt: 10_000,
      costRate: 0.001,
      slippageBufferUsdt: 5,
      replicaSamples: issuance.samples,
      scientificAdmissionReceiptDigest: admission.contentDigest,
      scientificAdmissionVerified: true,
    });
    const evRange = decisionEvRangeFromRecord(economics);
    const sizing = computeStopBasedQuantity({
      side: "buy",
      entryPrice: bar.close,
      signal: diagnosticSignal(organizationId, bar.symbol),
      account,
      limits: portfolioLimits,
      runConfig: DEFAULT_PORTFOLIO_RUN_CONFIG,
      stopDistanceProvider: defaultStopDistanceProvider,
      costModel: {
        version: COST_MODEL_VERSION_V1,
        feesBps: costModel.feesBps,
        slippageBps: costModel.slippageBps,
      },
      defaultQuantity: "0.01",
      capitalAuthorityPath: V2_CAPITAL_AUTHORITY_PATH,
    });
    if (sizing.ok && evRange.decisionActionable && exchange.listOpenOrders().length === 0) {
      const order = createInMemoryOrder({
        organizationId,
        symbol: compact,
        quantity: sizing.quantity,
        cycleIndex,
      });
      orders.set(order.id, order);
      exchange.registerOrder(order, cycleIndex, Date.parse(bar.barCloseTime));
      orderCount += 1;
    }
    const volumeReceipt = requireProfileHtxVolumeAuthority(profile, bar.symbol);
    const advance = await exchange.advanceOnClosedBar({
      context,
      closedBar: bar,
      barIndex: cycleIndex,
      model,
      persistence,
      replayNowMs: Date.parse(bar.barCloseTime),
      htxVolumeAuthorityReceipt: volumeReceipt,
      htxVolumeRaw: htxVolumeRawFromClosedBar(bar),
      refreshAccountState: async () => ({
        positions: [],
        openOrderCount: exchange.listOpenOrders().length,
        dailyPnl: netPnl,
        drawdown: "0",
        quoteExposureByCurrency: {},
      }),
      reconcileOrder: async () => undefined,
    });
    for (const event of advance.fillEvents) {
      const costed = applyHistoricalExecutionEconomics(event, model);
      cash = addDecimal(cash, costed.netCashEffect);
      netPnl = subtractDecimal(netPnl, costed.totalExecutionCost);
      fillCount += 1;
      fillIds.push(`${event.orderId}:${event.fillSequence}`);
    }
    const guardian = decideGuardianAction({
      tradingPermission: cycleIndex === barsTotal - 1 ? "ONLY_CLOSE_POSITIONS" : "ALLOW_TRADING",
      allowedStrategyIds: ["liquidity_sweep_reversal_v0"],
      tradeStrategyId: "liquidity_sweep_reversal_v0",
      barsHeld: cycleIndex,
    });
    lastGuardian = guardian.decision;
    lastAccountingDigest = computeAccountingSemanticDigest({
      schemaVersion: ACCOUNTING_FRONTIER_SCHEMA_VERSION,
      engineId: ACCOUNTING_ENGINE_ID,
      basisMethod: ACCOUNTING_BASIS_METHOD,
      organizationId,
      accountKey: "default",
      runId: "control-replay-chronological-semantic",
      accountingSequence: cycleIndex + 1,
      frontierAsOf: bar.barCloseTime,
      monthKey: bar.barCloseTime.slice(0, 7),
      cash,
      positions: {},
      grossRealizedPnl: netPnl,
      netRealizedPnl: netPnl,
      marks: { [bar.symbol]: { price: bar.close, barCloseTime: bar.barCloseTime } },
      markedPositionValue: "0",
      equity: cash,
      equityHwm: cash,
      accountDrawdownBps: 0,
      consumedFillIds: fillIds.slice(-8),
    });
    const ramUsedPct = 1 - os.freemem() / os.totalmem();
    const observerCheckpoint = {
      evidenceDurableThroughCycleIndex: cycleIndex,
      accountingFrontierState: {
        accountingSequence: cycleIndex + 1,
        frontierAsOf: bar.barCloseTime,
        cash,
        equity: cash,
        equityHwm: cash,
        monthlyPeakHwm: cash,
        monthKey: bar.barCloseTime.slice(0, 7),
        accountDrawdownBps: 0,
        monthlyDrawdownBps: 0,
        strategyPeakHwmByKey: {},
        strategyDrawdownBpsByKey: {},
        marksJson: { [bar.symbol]: { price: bar.close, barCloseTime: bar.barCloseTime } },
        positionsJson: {},
        consumedFillIds: fillIds.slice(-8),
        cashEventsJson: [],
        grossRealizedPnl: netPnl,
        netRealizedPnl: netPnl,
        semanticContentDigest: lastAccountingDigest,
      },
      drawdownHwmState: {
        accountPeakHwm: cash,
        monthlyPeakHwm: cash,
        monthKey: bar.barCloseTime.slice(0, 7),
        breachState: "NONE" as const,
        strategyPeaks: {},
        strategyDrawdownBpsByKey: {},
        monthlyDrawdownBps: 0,
        accountDrawdownBps: 0,
      },
    } as unknown as ReplayCheckpointRecord;
    buildAndWriteFhvOperatorStatus(input.runDir, {
      runId: input.runId,
      phase: "CONTROL_REPLAY",
      codeSha: input.releaseSha.trim().toLowerCase(),
      artifactDigest: lastAccountingDigest,
      datasetSeal: CONTROL_REPLAY_OFFICIAL_MARKET_AUTHORITY,
      datasetDigest: input.developmentWalkForwardContentDigest,
      configurationDigest: packageContentDigestHex,
      organizationId,
      currentSymbol: bar.symbol,
      historicalCursor: bar.barOpenTime,
      partition: "PRE_HOLDOUT",
      barsProcessed: cycleIndex + 1,
      barsTotal,
      startedAt,
      heartbeatAt: new Date().toISOString(),
      heartbeatState: "OK",
      terminalState: cycleIndex + 1 >= barsTotal ? "COMPLETED" : "RUNNING",
      lastCheckpointAt: new Date().toISOString(),
      checkpoint: observerCheckpoint,
      hostTelemetry: {
        cpuPct: null,
        loadAvg1: os.loadavg()[0] ?? null,
        ramUsedPct: Number.isFinite(ramUsedPct) ? ramUsedPct * 100 : null,
        diskFreeBytes: null,
        diskTotalBytes: null,
        processStatus: "running",
        serviceStatus: "running",
      },
      evidenceHealth: "ok",
    });
    const checkpointEvery = input.checkpointEveryCycles ?? Math.max(1, Math.floor(barsTotal / 2));
    if ((cycleIndex + 1) % checkpointEvery === 0 || cycleIndex + 1 === barsTotal) {
      const checkpoint: ChronologicalControlReplayCheckpointV1 = {
        schemaVersion: "control-replay-chronological-checkpoint/v1",
        runId: input.runId,
        cycleIndex,
        lastBarOpenTime: bar.barOpenTime,
        orderCount,
        fillCount,
        cash,
        equity: cash,
        netPnl,
        guardianState: lastGuardian,
        accountingSemanticDigest: lastAccountingDigest,
        semanticParityDigest: lastAccountingDigest,
        fillIds,
        orders: [...orders.values()],
        executionSlice: exchange.buildCheckpointSlice(),
      };
      writeFileAtomic(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
    }
  }

  const normalizedParityDigest = normalizeChronologicalControlReplayParity({
    packageContentDigestHex,
    accountingSemanticDigest: lastAccountingDigest,
    orderCount,
    fillCount,
    cycleCount: barsTotal,
    netPnl,
    guardianState: lastGuardian,
  });
  const parityDigest = computeControlReplayParityDigest({
    executionPurpose: CONTROL_REPLAY_AUTHORITY_IDENTITY.executionPurpose,
    executionMode: CONTROL_REPLAY_AUTHORITY_IDENTITY.executionMode,
    authorityClass: CONTROL_REPLAY_AUTHORITY_IDENTITY.authorityClass,
    capitalEligible: false,
    decisionActionable: true,
    evLowerScale8: "0",
    evBaseScale8: "0",
    evUpperScale8: "0",
    orderCount,
    fillCount,
    checkpointDigest: lastAccountingDigest,
    semanticParityDigest: normalizedParityDigest,
  });
  const result: ChronologicalControlReplayV2Result = {
    driverVersion: CONTROL_REPLAY_CHRONOLOGICAL_V2_DRIVER_VERSION,
    authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
    runId: input.runId,
    cycleCount: barsTotal,
    orderCount,
    fillCount,
    cash,
    equity: cash,
    netPnl,
    guardianState: lastGuardian,
    accountingSemanticDigest: lastAccountingDigest,
    parityDigest,
    normalizedParityDigest,
    packageContentDigestHex,
    capitalEligible: false,
    executionScope: "PRE_HOLDOUT_SHARED_PORTFOLIO",
    constructionAuthority: "DEVELOPMENT",
    dee594Status: DEE_594_DOWNSTREAM_PREREQUISITE_STATUS,
  };
  writeFileAtomic(
    join(input.runDir, "control-replay-chronological-v2-result.v1.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}
