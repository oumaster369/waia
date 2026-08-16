/**
 * Chronological Control Replay V2 driver (DEE-538 tooling).
 *
 * Walks qualified pre-holdout bars through historical time using the canonical
 * Decision Economics V2 (DEE-529 TEST_ONLY per-symbol intents) → Portfolio →
 * Risk → historical execution → Accounting → Guardian path.
 * Does not call runFullHistoricalBacktest / StrategySignal V1.
 *
 * CONTROL_REPLAY_TEST_ONLY_AUTHORITY_V1 remains capitalEligible=false.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

import {
  advanceAccountingFrontier,
  computeAccountingSemanticDigest,
  createInitialAccountingState,
} from "@/lib/trader/accounting";
import type {
  AccountingStateV1,
  MarksJsonV1,
} from "@/lib/trader/accounting/accounting-frontier.types";
import { derivePortfolioFromAccountingState } from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import {
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
  serializeCheckpoint,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  bindHistoricalExecutionModelToSession,
  htxVolumeRawFromClosedBar,
  requireProfileHtxVolumeAuthority,
} from "@/lib/trader/backtest/historical-execution-profile";
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import {
  COST_MODEL_VERSION_V1,
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import type { HistoricalExecutionCheckpointSlice } from "@/lib/trader/execution/historical-execution-model.types";
import type { SimulatedFillEvent } from "@/lib/trader/execution/historical-execution-model.types";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { HistoricalExecutionPersistencePort } from "@/lib/trader/execution/historical-simulated-exchange";
import { evaluateHtrGuardianCycle } from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import {
  buildDecisionEconomicsV2Record,
  decisionEvRangeFromRecord,
} from "@/lib/trader/intelligence/decision-economics/decision-economics-v2-service";
import type { Bar, StrategySignal } from "@/lib/trader/intelligence/types";
import { mergeFhvSharedPortfolioBarsChronologically } from "@/lib/trader/market-data/fhv-shared-portfolio-bar-replay-source";
import { FHV_SYMBOL_CODE_TO_INSTRUMENT } from "@/lib/trader/market-data/fhv-partition-boundaries";
import type { HtxVolumeQualificationReceiptV1 } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { CONTROL_REPLAY_OFFICIAL_MARKET_AUTHORITY } from "@/lib/trader/observability/control-replay-preholdout-source-corpus-v1";
import {
  CONTROL_REPLAY_AUTHORITY_IDENTITY,
  assertControlReplayTestOnlyAuthorityV1,
} from "@/lib/trader/observability/control-replay-test-authority";
import {
  CONTROL_REPLAY_TEST_ONLY_INTENT_SCHEMA,
  assertForecastSymbolMatchesMarket,
  buildControlReplayTestOnlyIntent,
  compactControlReplaySymbol,
} from "@/lib/trader/observability/control-replay-test-only-intent-v1";
import { createControlReplayTestOnlyRiskEngine } from "@/lib/trader/observability/control-replay-test-only-risk-engine-v1";
import { computeControlReplayParityDigest } from "@/lib/trader/observability/fhv-control-replay-parity-digest";
import { buildAndWriteFhvOperatorStatus } from "@/lib/trader/observability/fhv-status-writer";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { computeStopBasedQuantity } from "@/lib/trader/portfolio/stop-based-sizing";
import { toAccountRiskState } from "@/lib/trader/portfolio/to-account-risk-state";
import { V2_CAPITAL_AUTHORITY_PATH } from "@/lib/trader/risk/authority-chain";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { addDecimal, compareDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export const CONTROL_REPLAY_CHRONOLOGICAL_V2_DRIVER_VERSION =
  "control-replay-chronological-v2-driver/v1" as const;

export const DEE_594_DOWNSTREAM_PREREQUISITE_STATUS = "NOT_SATISFIED_BY_DEE_537" as const;

const TEST_ONLY_REPLICA_SAMPLES: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> = [
  [
    [0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  [
    [0, 0, 0, 0.015, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0.012, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  [
    [0, 0, 0, 0.018, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0.011, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
];

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function accountingParityDigest(state: AccountingStateV1): string {
  return computeAccountingSemanticDigest({
    ...state,
    runId: "control-replay-normalized-parity",
  });
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
  accountingState: AccountingStateV1;
  interrupted: boolean;
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
  scientificAdmissionReceiptDigest: string;
  capitalEligible: false;
  executionScope: "PRE_HOLDOUT_SHARED_PORTFOLIO";
  constructionAuthority: "DEVELOPMENT";
  interrupted: boolean;
  dee594Status: typeof DEE_594_DOWNSTREAM_PREREQUISITE_STATUS;
}>;

function diagnosticSignal(
  organizationId: string,
  symbol: string,
  evaluatedAt: string,
  side: "buy" | "sell",
): StrategySignal {
  return {
    strategySignalId: "cr-chrono-diagnostic-signal",
    strategyId: "liquidity_sweep_reversal_v0",
    strategyVersion: "0.0.0",
    organizationId,
    symbol,
    outcome: "SIGNAL",
    side,
    confidence: "0.99",
    expectedEdge: "9999",
    maxRisk: "0.000001",
    reasonCodes: ["CONTROL_REPLAY_LEGACY_DIAGNOSTIC_ONLY"],
    msvId: "cr-chrono-msv",
    featureSetId: "cr-chrono-features",
    evaluatedAt,
  };
}

function compactSymbol(symbol: string): "BTCUSDT" | "ETHUSDT" {
  return compactControlReplaySymbol(symbol);
}

function createInMemoryOrder(input: {
  organizationId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  quantity: string;
  cycleIndex: number;
  createdAt: Date;
  side?: "buy" | "sell";
}): OrderRow {
  const now = input.createdAt;
  return {
    id: `cr-chrono-order-${input.cycleIndex}-${input.symbol}-${input.side ?? "buy"}`,
    organizationId: input.organizationId,
    credentialId: null,
    venue: "HTX",
    executionMode: "mock",
    symbol: input.symbol,
    side: input.side ?? "buy",
    type: "market",
    price: null,
    quantity: input.quantity,
    filledQuantity: "0",
    avgFillPrice: null,
    state: "ACCEPTED",
    stateVersion: 4,
    exchangeOrderId: null,
    clientOrderId: `cr-chrono-${input.cycleIndex}-${input.symbol}`,
    idempotencyKey: `cr-chrono-idem-${input.cycleIndex}-${input.symbol}-${input.side ?? "buy"}`,
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

function assertDevelopmentDigestNotCombined(input: {
  developmentContentDigest?: string;
  developmentWalkForwardContentDigest: string;
}): void {
  if (
    input.developmentContentDigest &&
    input.developmentContentDigest === input.developmentWalkForwardContentDigest
  ) {
    throw new Error(
      "TYPED_DATASET_IDENTITY_SUBSTITUTION: developmentContentDigest must not equal developmentWalkForwardContentDigest",
    );
  }
}

async function* iterateExecutionBars(input: {
  executionBars?: readonly Bar[];
  executionBarStream?: AsyncIterable<Bar>;
}): AsyncGenerator<Bar, void, void> {
  if (input.executionBarStream && input.executionBars) {
    throw new Error("CONTROL_REPLAY_BAR_SOURCE_AMBIGUOUS");
  }
  if (input.executionBarStream) {
    for await (const bar of input.executionBarStream) {
      yield bar;
    }
    return;
  }
  if (!input.executionBars) {
    throw new Error("CONTROL_REPLAY_EXECUTION_BARS_REQUIRED");
  }
  for (const bar of mergeFhvSharedPortfolioBarsChronologically(input.executionBars)) {
    yield bar;
  }
}

export async function runChronologicalControlReplayV2(input: {
  runId: string;
  runDir: string;
  organizationId: string;
  releaseSha: string;
  developmentContentDigest?: string;
  developmentWalkForwardContentDigest: string;
  constructionBars?: readonly Bar[];
  executionBars?: readonly Bar[];
  executionBarStream?: AsyncIterable<Bar>;
  htxVolumeAuthorityByInstrument: Readonly<
    Record<"BTCUSDT" | "ETHUSDT", HtxVolumeQualificationReceiptV1>
  >;
  maxCycles?: number;
  checkpointEveryCycles?: number;
  resumeFromCheckpoint?: boolean;
  interruptAfterCycles?: number;
  economicReplayStartUtc?: string;
  riskScenario?: "allow" | "clamp" | "veto";
}): Promise<ChronologicalControlReplayV2Result> {
  assertControlReplayTestOnlyAuthorityV1({
    surface: "CONTROL_REPLAY",
    authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
  });
  if (CONTROL_REPLAY_AUTHORITY_IDENTITY.capitalEligible !== false) {
    throw new Error("CONTROL_REPLAY capitalEligible must remain false");
  }
  assertDevelopmentDigestNotCombined(input);
  mkdirSync(input.runDir, { recursive: true });
  const organizationId = input.organizationId;
  const btcIntent = buildControlReplayTestOnlyIntent({ symbol: "BTCUSDT" });
  const ethIntent = buildControlReplayTestOnlyIntent({ symbol: "ETHUSDT" });
  const intents = { BTCUSDT: btcIntent, ETHUSDT: ethIntent } as const;
  const packageContentDigestHex = sha256Hex(
    JSON.stringify({
      schemaVersion: CONTROL_REPLAY_TEST_ONLY_INTENT_SCHEMA,
      btc: btcIntent.identityDigest,
      eth: ethIntent.identityDigest,
    }),
  );
  const scientificAdmissionReceiptDigest = sha256Hex(
    JSON.stringify({
      schemaVersion: CONTROL_REPLAY_TEST_ONLY_INTENT_SCHEMA,
      authorityClass: "TEST_ONLY",
      capitalEligible: false,
      packageContentDigestHex,
    }),
  );
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
  const costModel = costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());
  const checkpointPath = join(input.runDir, "control-replay-chronological-checkpoint.v1.json");
  let startIndex = 0;
  let orderCount = 0;
  let fillCount = 0;
  const fillIds: string[] = [];
  let accounting = createInitialAccountingState({
    organizationId,
    accountKey: "default",
    runId: input.runId,
  });
  let lastMarks: MarksJsonV1 = { ...accounting.marks };
  let lastGuardian = "NONE";
  let replayNowMs = 1_700_000_000_000;
  const riskEngine = createControlReplayTestOnlyRiskEngine({
    vetoAll: input.riskScenario === "veto",
    clampMaxNotional: input.riskScenario === "clamp" ? "1.00" : undefined,
    nowMs: () => replayNowMs,
  });
  if (input.resumeFromCheckpoint && existsSync(checkpointPath)) {
    const checkpoint = JSON.parse(
      readFileSync(checkpointPath, "utf8"),
    ) as ChronologicalControlReplayCheckpointV1;
    startIndex = checkpoint.cycleIndex + 1;
    orderCount = checkpoint.orderCount;
    fillCount = checkpoint.fillCount;
    lastGuardian = checkpoint.guardianState;
    fillIds.push(...checkpoint.fillIds);
    accounting = checkpoint.accountingState;
    lastMarks = { ...checkpoint.accountingState.marks };
    for (const order of checkpoint.orders) {
      orders.set(order.id, {
        ...order,
        createdAt: new Date(order.createdAt),
        updatedAt: new Date(order.updatedAt),
      });
    }
    exchange.restoreFromCheckpointSlice(checkpoint.executionSlice, orders);
  }

  const startedAt = new Date().toISOString();
  const economicStartMs = input.economicReplayStartUtc
    ? Date.parse(input.economicReplayStartUtc)
    : null;
  let cycleIndex = -1;
  let lastProcessedIndex = startIndex - 1;
  let lastBar: Bar | null = null;
  let interrupted = false;
  let lastAccountingDigest = computeAccountingSemanticDigest(accounting);

  const writeObserver = (bar: Bar, processedCount: number, terminalState: string): void => {
    const ramUsedPct = 1 - os.freemem() / os.totalmem();
    const observerCheckpoint = serializeCheckpoint({
      schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
      backtestRunId: input.runId,
      datasetContentDigest:
        input.developmentContentDigest ?? input.developmentWalkForwardContentDigest,
      datasetId: "control-replay-preholdout",
      codeSha: input.releaseSha.trim().toLowerCase(),
      activePhase: "none",
      dbDurableThroughPhase: "none",
      evidenceDurableThroughCycleIndex: processedCount - 1,
      safeResumeThroughCycleIndex: processedCount - 1,
      evidenceRunDir: input.runDir,
      evidenceChainDigest: lastAccountingDigest,
      evidenceTerminalState: interrupted
        ? "STREAMING_EVIDENCE_SEALED_PARTIAL"
        : "STREAMING_EVIDENCE_OK",
      dbConnectionMode: null,
      replayTerminalState:
        terminalState === "COMPLETED" ? "REPLAY_RUN_OK" : "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      executionState: exchange.buildCheckpointSlice(),
      accountingFrontierState: {
        accountingSequence: accounting.accountingSequence,
        frontierAsOf: accounting.frontierAsOf,
        cash: accounting.cash,
        equity: accounting.equity,
        equityHwm: accounting.equityHwm,
        monthlyPeakHwm: accounting.monthlyPeakHwm ?? accounting.equityHwm,
        monthKey: accounting.monthKey,
        accountDrawdownBps: accounting.accountDrawdownBps,
        monthlyDrawdownBps: accounting.monthlyDrawdownBps ?? 0,
        strategyPeakHwmByKey: accounting.strategyPeakHwmByKey ?? {},
        strategyDrawdownBpsByKey: accounting.strategyDrawdownBpsByKey ?? {},
        marksJson: accounting.marks,
        positionsJson: accounting.positions,
        consumedFillIds: accounting.consumedFillIds,
        cashEventsJson: [],
        grossRealizedPnl: accounting.grossRealizedPnl,
        netRealizedPnl: accounting.netRealizedPnl,
        semanticContentDigest: lastAccountingDigest,
        cumulativeOrdersCount: orderCount,
        cumulativeFillsCount: fillCount,
      },
      drawdownHwmState: {
        accountPeakHwm: accounting.equityHwm,
        monthlyPeakHwm: accounting.monthlyPeakHwm ?? accounting.equityHwm,
        monthKey: accounting.monthKey,
        breachState: lastGuardian as "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT",
        strategyPeaks: {},
        strategyDrawdownBpsByKey: accounting.strategyDrawdownBpsByKey ?? {},
        monthlyDrawdownBps: accounting.monthlyDrawdownBps ?? 0,
        accountDrawdownBps: accounting.accountDrawdownBps,
      },
    });
    buildAndWriteFhvOperatorStatus(input.runDir, {
      runId: input.runId,
      phase: "CONTROL_REPLAY",
      codeSha: input.releaseSha.trim().toLowerCase(),
      artifactDigest: lastAccountingDigest,
      datasetSeal: CONTROL_REPLAY_OFFICIAL_MARKET_AUTHORITY,
      datasetDigest: input.developmentContentDigest ?? input.developmentWalkForwardContentDigest,
      configurationDigest: packageContentDigestHex,
      organizationId,
      currentSymbol: bar.symbol,
      historicalCursor: bar.barOpenTime,
      partition: "PRE_HOLDOUT",
      barsProcessed: processedCount,
      barsTotal: input.maxCycles,
      startedAt,
      heartbeatAt: new Date().toISOString(),
      heartbeatState: "OK",
      terminalState,
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
  };

  const persistDriverCheckpoint = (bar: Bar, processedIndex: number, isInterrupted: boolean) => {
    const checkpoint: ChronologicalControlReplayCheckpointV1 = {
      schemaVersion: "control-replay-chronological-checkpoint/v1",
      runId: input.runId,
      cycleIndex: processedIndex,
      lastBarOpenTime: bar.barOpenTime,
      orderCount,
      fillCount,
      cash: accounting.cash,
      equity: accounting.equity,
      netPnl: accounting.netRealizedPnl,
      guardianState: lastGuardian,
      accountingSemanticDigest: lastAccountingDigest,
      semanticParityDigest: lastAccountingDigest,
      fillIds,
      orders: [...orders.values()],
      executionSlice: exchange.buildCheckpointSlice(),
      accountingState: accounting,
      interrupted: isInterrupted,
    };
    writeFileAtomic(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  };

  for await (const bar of iterateExecutionBars(input)) {
    if (economicStartMs !== null && Date.parse(bar.barOpenTime) < economicStartMs) {
      continue;
    }
    cycleIndex += 1;
    if (cycleIndex < startIndex) {
      continue;
    }
    if (input.maxCycles !== undefined && cycleIndex >= input.maxCycles) {
      break;
    }
    if (input.interruptAfterCycles !== undefined && cycleIndex >= input.interruptAfterCycles) {
      interrupted = true;
      break;
    }

    const compact = compactSymbol(bar.symbol);
    replayNowMs = Date.parse(bar.barCloseTime);
    const intent = intents[compact];
    assertForecastSymbolMatchesMarket({
      forecastSymbol: intent.symbol,
      marketSymbol: bar.symbol,
    });
    const instrument = FHV_SYMBOL_CODE_TO_INSTRUMENT[compact];
    const guardian = evaluateHtrGuardianCycle({
      skipReconciliationAssert: true,
      accountPeakHwm: accounting.equityHwm,
      monthlyPeakHwm: accounting.monthlyPeakHwm ?? accounting.equityHwm,
      equityUsdt: accounting.equity,
    });
    lastGuardian = guardian.breachState;
    const portfolio = derivePortfolioFromAccountingState({
      state: accounting,
      runConfig: DEFAULT_PORTFOLIO_RUN_CONFIG,
      limits: portfolioLimits,
      stopDistanceProvider: defaultStopDistanceProvider,
      markPrices: { [instrument]: bar.close, [compact]: bar.close },
    });
    const economics = buildDecisionEconomicsV2Record({
      organizationId,
      forecastId: intent.identityDigest,
      notionalUsdt: 10_000,
      costRate: 0.001,
      slippageBufferUsdt: 5,
      replicaSamples: TEST_ONLY_REPLICA_SAMPLES,
      scientificAdmissionReceiptDigest,
      scientificAdmissionVerified: false,
    });
    const evRange = decisionEvRangeFromRecord(economics);
    void evRange;
    const openCount = exchange.listOpenOrders().length;
    if (guardian.allowNewExposure && openCount === 0) {
      const sizing = computeStopBasedQuantity({
        side: intent.side,
        entryPrice: bar.close,
        signal: diagnosticSignal(organizationId, instrument, bar.barCloseTime, intent.side),
        account: portfolio,
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
      if (sizing.ok) {
        const risk = await riskEngine.evaluateOrderRequest({
          context,
          order: {
            clientOrderId: `cr-chrono-${cycleIndex}-${compact}`,
            symbol: instrument,
            side: intent.side,
            type: "market",
            quantity: sizing.quantity,
          },
          referencePrice: bar.close,
          accountKey: "default",
          accountState: toAccountRiskState({
            portfolio,
            openOrderCount: openCount,
            accountPeakHwm: accounting.equityHwm,
            monthlyPeakHwm: accounting.monthlyPeakHwm ?? accounting.equityHwm,
          }),
        });
        const outcome = risk.decision.outcome;
        if (outcome === "APPROVE" || outcome === "RESIZE") {
          const quantity =
            outcome === "RESIZE" && risk.decision.resize?.quantity
              ? risk.decision.resize.quantity
              : sizing.quantity;
          const order = createInMemoryOrder({
            organizationId,
            symbol: compact,
            quantity,
            cycleIndex,
            createdAt: new Date(bar.barCloseTime),
            side: intent.side,
          });
          orders.set(order.id, order);
          exchange.registerOrder(order, cycleIndex, Date.parse(bar.barCloseTime));
          orderCount += 1;
        }
      }
    }

    const volumeReceipt = requireProfileHtxVolumeAuthority(profile, bar.symbol);
    const accountRisk = toAccountRiskState({
      portfolio,
      openOrderCount: exchange.listOpenOrders().length,
      accountPeakHwm: accounting.equityHwm,
      monthlyPeakHwm: accounting.monthlyPeakHwm ?? accounting.equityHwm,
    });
    const advance = await exchange.advanceOnClosedBar({
      context,
      closedBar: bar,
      barIndex: cycleIndex,
      model,
      persistence,
      replayNowMs: Date.parse(bar.barCloseTime),
      htxVolumeAuthorityReceipt: volumeReceipt,
      htxVolumeRaw: htxVolumeRawFromClosedBar(bar),
      refreshAccountState: async () => accountRisk,
      reconcileOrder: async () => undefined,
    });
    for (const event of advance.fillEvents) {
      const costed = applyHistoricalExecutionEconomics(event, model);
      const fillId = `${event.orderId}:${event.fillSequence}`;
      const frontier = advanceAccountingFrontier({
        state: accounting,
        fill: {
          fillId,
          economics: costed,
          executedAt: bar.barCloseTime,
        },
        frontierAsOf: bar.barCloseTime,
      });
      accounting = frontier;
      fillCount += 1;
      fillIds.push(fillId);
    }
    lastMarks = {
      ...lastMarks,
      [compact]: { price: bar.close, barCloseTime: bar.barCloseTime },
      [instrument]: { price: bar.close, barCloseTime: bar.barCloseTime },
    };
    const marked = advanceAccountingFrontier({
      state: accounting,
      marks: lastMarks,
      frontierAsOf: bar.barCloseTime,
    });
    accounting = marked;
    lastAccountingDigest = marked.semanticContentDigest;
    lastProcessedIndex = cycleIndex;
    lastBar = bar;
    const processedCount = cycleIndex + 1;
    const checkpointEvery = input.checkpointEveryCycles ?? 10;
    const atCheckpoint = processedCount % checkpointEvery === 0;
    writeObserver(bar, processedCount, "RUNNING");
    if (atCheckpoint) {
      persistDriverCheckpoint(bar, cycleIndex, false);
    }
  }

  if (interrupted) {
    if (!lastBar && startIndex > 0) {
      throw new Error("CONTROL_REPLAY_INTERRUPT_WITHOUT_PROGRESS");
    }
    if (lastBar) {
      persistDriverCheckpoint(lastBar, lastProcessedIndex, true);
      writeObserver(lastBar, lastProcessedIndex + 1, "INTERRUPTED");
    }
  } else if (lastBar) {
    for (const [symbol, position] of Object.entries(accounting.positions)) {
      if (compareDecimal(position.quantity, "0") <= 0) {
        continue;
      }
      const mark = accounting.marks[symbol];
      if (!mark) {
        throw new Error(`CONTROL_REPLAY_FLATTEN_MISSING_MARK:${symbol}`);
      }
      const flattenEvent: SimulatedFillEvent = {
        orderId: `cr-chrono-flatten-${symbol}`,
        organizationId,
        symbol,
        side: "sell",
        fillSequence: fillCount + 1,
        sourceBarIndex: lastProcessedIndex,
        sourceBar: lastBar,
        grossFillPrice: mark.price,
        sliceQuantity: position.quantity,
        remainingQuantityAfter: "0",
        acceptedAt: new Date(lastBar.barCloseTime),
        fillTimestamp: new Date(lastBar.barCloseTime),
        submitLatencyMs: 0,
        cancelLatencyMs: null,
      };
      const costed = applyHistoricalExecutionEconomics(flattenEvent, model);
      const fillId = `${flattenEvent.orderId}:flatten`;
      const frontier = advanceAccountingFrontier({
        state: accounting,
        fill: {
          fillId,
          economics: costed,
          executedAt: lastBar.barCloseTime,
        },
        marks: accounting.marks,
        frontierAsOf: lastBar.barCloseTime,
      });
      accounting = frontier;
      fillCount += 1;
      fillIds.push(fillId);
      lastAccountingDigest = frontier.semanticContentDigest;
    }
    const residual = Object.values(accounting.positions).some(
      (position) => compareDecimal(position.quantity, "0") > 0,
    );
    if (residual) {
      throw new Error("CONTROL_REPLAY_RESIDUAL_INVENTORY");
    }
    persistDriverCheckpoint(lastBar, lastProcessedIndex, false);
    writeObserver(lastBar, lastProcessedIndex + 1, "COMPLETED");
  }

  const cycleCount = lastProcessedIndex >= 0 ? lastProcessedIndex + 1 : 0;
  const normalizedParityDigest = normalizeChronologicalControlReplayParity({
    packageContentDigestHex,
    accountingSemanticDigest: accountingParityDigest(accounting),
    orderCount,
    fillCount,
    cycleCount,
    netPnl: accounting.netRealizedPnl,
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
    cycleCount,
    orderCount,
    fillCount,
    cash: accounting.cash,
    equity: accounting.equity,
    netPnl: accounting.netRealizedPnl,
    guardianState: lastGuardian,
    accountingSemanticDigest: lastAccountingDigest,
    parityDigest,
    normalizedParityDigest,
    packageContentDigestHex,
    scientificAdmissionReceiptDigest,
    capitalEligible: false,
    executionScope: "PRE_HOLDOUT_SHARED_PORTFOLIO",
    constructionAuthority: "DEVELOPMENT",
    interrupted,
    dee594Status: DEE_594_DOWNSTREAM_PREREQUISITE_STATUS,
  };
  writeFileAtomic(
    join(input.runDir, "control-replay-chronological-v2-result.v1.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}
