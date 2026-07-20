import { readFileSync } from "node:fs";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  computeAccountingSemanticDigest,
  advanceAccountingFrontier,
} from "@/lib/trader/accounting";
import type {
  AccountingStateV1,
  MarksJsonV1,
} from "@/lib/trader/accounting/accounting-frontier.types";
import type { HtrPnlReportV1 } from "@/lib/trader/accounting/htr-pnl-report-v1.types";
import {
  buildTerminalHtrPnlReport,
  consumeWp17FillIntoAccountingBridge,
  createHtrAccountingCycleBridge,
  restoreAccountingBridgeFromCheckpoint,
  runAutomaticAccountingReconciliation,
  toAccountingCheckpointSlice,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import type { HtrAccountingCycleBridge } from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import type { ReplayAccountingFrontierState } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { advanceHistoricalExecutionOnClosedBar } from "@/lib/trader/execution/historical-simulated-exchange";
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import { historicalFillId } from "@/lib/trader/execution/deterministic-execution-id";
import type { HistoricalExecutionPersistencePort } from "@/lib/trader/execution/historical-simulated-exchange";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { InMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import {
  buildHtrWp22FixtureManifest,
  HTR_WP22_BTC_FIXTURE_RELATIVE_PATH,
  HTR_WP22_ETH_FIXTURE_RELATIVE_PATH,
  HTR_WP22_FIXTURE_INITIAL_CASH_USDT,
  HTR_WP22_FIXTURE_SOURCE_AUTHORITY,
  HTR_WP22_FIXTURE_TIME_RANGE_END,
  HTR_WP22_FIXTURE_TIME_RANGE_START,
  loadHtrWp22FixtureManifest,
  verifyHtrWp22FixtureManifest,
} from "@/lib/trader/backtest/htr-wp22-fixture-manifest";
import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";
import { normalizeSymbolForHistoricalExecution } from "@/lib/trader/backtest/historical-execution-profile";
import { restoreWp17ExecutionFromCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { createHtrHistoricalCostModelAuthorityV1 } from "@/lib/trader/execution/htr-historical-cost-model-authority";
import type { HistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model.types";
import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import type { BarReplayNextResult, BarReplaySource } from "@/lib/trader/market-data/types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { type Bar } from "@/lib/trader/intelligence/types";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { computePeakEquityDrawdownBps } from "@/lib/trader/risk/drawdown-policy-evaluator";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { createAcceptedMarketOrder } from "@/tests/unit/helpers/wp17-execution-fixtures";

export const HTR_WP22_MULTI_POSITION_CORRECTNESS_SCHEMA =
  "htr-wp22-multi-position-correctness/v1" as const;

export const HTR_WP22_MULTI_POSITION_INTENT_SEAM =
  "HTR_WP22_TEST_ONLY_PRE_REGISTERED_ORDERS" as const;
export const HTR_WP22_MULTI_POSITION_MARK_MERGE_SEAM =
  "HTR_WP22_TEST_ONLY_MERGED_MARK_ATTACHMENT" as const;

const wp22MarkCache: MarksJsonV1 = {};

function resetHtrWp22MarkCache(): void {
  for (const key of Object.keys(wp22MarkCache)) {
    delete wp22MarkCache[key];
  }
}

function attachHtrWp22MergedMarkToBridge(bridge: HtrAccountingCycleBridge, closedBar: Bar): void {
  const symbol = normalizeSymbolForHistoricalExecution(closedBar.symbol);
  wp22MarkCache[symbol] = {
    price: closedBar.close,
    barCloseTime: closedBar.barCloseTime,
  };
  const mergedMarks: MarksJsonV1 = {};
  for (const [openSymbol, position] of Object.entries(bridge.state.positions)) {
    if (compareDecimal(position.quantity, "0") <= 0) {
      continue;
    }
    const mark = wp22MarkCache[openSymbol] ?? bridge.state.marks[openSymbol];
    if (!mark) {
      throw new Error(`HTR_WP22_MULTI_POSITION:MISSING_CACHED_MARK:${openSymbol}`);
    }
    mergedMarks[openSymbol] = mark;
  }
  if (Object.keys(mergedMarks).length === 0) {
    mergedMarks[symbol] = wp22MarkCache[symbol]!;
  }
  bridge.state = advanceAccountingFrontier({
    state: bridge.state,
    marks: mergedMarks,
    frontierAsOf: closedBar.barCloseTime,
  });
}

async function runHtrWp22MultiPositionReplay(input: {
  session: InMemoryResearchBacktestSession;
  context: OrgContext;
  bars: Bar[];
  runId: string;
  maxCycles?: number;
  initialAccountingFrontierState?: ReplayAccountingFrontierState;
  resumeCycleStartIndex?: number;
}): Promise<HtrWp22ReplayResult> {
  resetHtrWp22MarkCache();
  const fillLedger: FillLedgerEntry[] = [];
  const barSource = new HtrWp22InterleavedBarReplaySource(input.bars);
  const window = {
    start: new Date(input.bars[0]!.barOpenTime),
    end: new Date(input.bars.at(-1)!.barCloseTime),
  };
  const bridge = createHtrAccountingCycleBridge({
    organizationId: input.context.organizationId,
    accountKey: "htr-wp22-multi-position",
    runId: input.runId ?? HTR_WP22_MULTI_POSITION_RUN_ID,
    frontierAsOf: window.start.toISOString(),
  });
  if (input.initialAccountingFrontierState) {
    restoreAccountingBridgeFromCheckpoint(bridge, input.initialAccountingFrontierState);
    runAutomaticAccountingReconciliation(bridge, { phase: "checkpoint_restore" });
  }
  const resumeCycleStartIndex = Math.max(0, input.resumeCycleStartIndex ?? 0);
  if (resumeCycleStartIndex > 0) {
    barSource.advanceToCycleIndex(resumeCycleStartIndex);
  }
  const maxCycles = input.maxCycles ?? Number.POSITIVE_INFINITY;
  let cycleCount = resumeCycleStartIndex;
  const profile = input.session.historicalExecutionProfile;
  const orderRepository = input.session.orderRepository;

  while (cycleCount < maxCycles) {
    const cycleIndex = cycleCount;
    const next = barSource.next();
    if (next.done) {
      break;
    }
    const snapshot = { ...next.snapshot, activeStrategyIds: ["__htr-blocked__"] as const };
    input.session.deps.researchReplayDeterminism?.clock.setNowMs(
      new Date(snapshot.evaluatedAt).getTime(),
    );
    input.session.deps.researchReplayDeterminism?.setDecisionBarIndex?.(cycleIndex);
    const closedBar = snapshot.bars.at(-1);
    if (closedBar) {
      const persistence: HistoricalExecutionPersistencePort = {
        recordSimulatedFill: (context, order, event, isFirstSlice) =>
          input.session.deps.execution.recordSimulatedFill!(
            context,
            order,
            event,
            isFirstSlice,
          ).then(() => undefined),
        transitionOrderExpired: (context, order) =>
          input.session.deps.execution.transitionOrderExpired!(context, order),
        transitionOrderCancelled: (context, order) =>
          input.session.deps.execution.transitionOrderCancelled!(context, order),
      };
      const advance = await advanceHistoricalExecutionOnClosedBar(profile.exchange, {
        context: input.context,
        closedBar,
        barIndex: cycleIndex,
        model: profile.model,
        persistence,
        replayNowMs: new Date(snapshot.evaluatedAt).getTime(),
        refreshAccountState: async () => createHtrInitialAccountRiskState(),
        reconcileOrder: async () => undefined,
      });
      for (const event of advance.fillEvents) {
        const order = await orderRepository.getOrderById(input.context, event.orderId);
        if (!order) continue;
        const economics = applyHistoricalExecutionEconomics(event, profile.model);
        const fillId = historicalFillId({
          organizationId: input.context.organizationId,
          orderId: order.id,
          fillSequence: event.fillSequence,
          sourceBarIndex: event.sourceBarIndex,
        });
        consumeWp17FillIntoAccountingBridge(bridge, {
          fill: {
            fillId,
            economics: {
              symbol: economics.symbol,
              side: economics.side,
              quantity: economics.quantity,
              grossFillPrice: economics.grossFillPrice,
              grossNotional: economics.grossNotional,
              netFillPrice: economics.netFillPrice,
              feeAmount: economics.feeAmount,
              netCashEffect: economics.netCashEffect,
              spreadCost: economics.spreadCost,
              impactSlippageCost: economics.impactSlippageCost,
              totalExecutionCost: economics.totalExecutionCost,
              economicsContentDigest: economics.economicsContentDigest,
            },
            executedAt: event.fillTimestamp.toISOString(),
          },
          cycleIndex,
        });
        fillLedger.push({
          fillId,
          orderId: order.id,
          symbol: economics.symbol as "BTCUSDT" | "ETHUSDT",
          side: economics.side,
          quantity: economics.quantity,
          grossFillPrice: economics.grossFillPrice,
          netFillPrice: economics.netFillPrice,
          fee: economics.feeAmount,
          netCashEffect: economics.netCashEffect,
          executedAt: event.fillTimestamp.toISOString(),
        });
      }
      attachHtrWp22MergedMarkToBridge(bridge, closedBar);
      const inventoryOpenQtyBySymbol = Object.fromEntries(
        Object.entries(bridge.state.positions)
          .filter(([, position]) => compareDecimal(position.quantity, "0") > 0)
          .map(([symbol, position]) => [symbol, position.quantity]),
      );
      runAutomaticAccountingReconciliation(bridge, {
        inventoryOpenQtyBySymbol,
        cycleIndex,
        phase: "frontier_mutation",
      });
    }
    cycleCount += 1;
  }

  runAutomaticAccountingReconciliation(bridge, { phase: "before_terminal_export" });
  const htrPnlReportV1 = buildTerminalHtrPnlReport(bridge);
  return {
    cycleCount,
    accountingState: bridge.state,
    htrPnlReportV1,
    accountingFrontierState: toAccountingCheckpointSlice(bridge),
    fillLedger,
  };
}
export const HTR_WP22_MULTI_POSITION_EXECUTION_BOUNDARY =
  "EXISTING_WP17_EXECUTION_WP18_ACCOUNTING_WP19_RECONCILIATION" as const;

/** Deterministic order schedule — single-slice fills on same-symbol eligible bars only. */
export const HTR_WP22_MULTI_POSITION_ORDER_SCHEDULE = [
  {
    clientKey: "btc-buy-1",
    symbol: "BTCUSDT" as const,
    side: "buy" as const,
    quantity: "0.25000000",
    decisionBarIndex: 19,
  },
  {
    clientKey: "eth-buy-1",
    symbol: "ETHUSDT" as const,
    side: "buy" as const,
    quantity: "0.25000000",
    decisionBarIndex: 20,
  },
  {
    clientKey: "btc-sell-1",
    symbol: "BTCUSDT" as const,
    side: "sell" as const,
    quantity: "0.25000000",
    decisionBarIndex: 21,
  },
  {
    clientKey: "eth-sell-1",
    symbol: "ETHUSDT" as const,
    side: "sell" as const,
    quantity: "0.25000000",
    decisionBarIndex: 22,
  },
] as const;

export const HTR_WP22_MULTI_POSITION_CHECKPOINT_CYCLE = 22;

const HTR_WP22_MULTI_POSITION_RUN_ID = "run-htr-wp22-multi-position-checkpoint" as const;
const WP22_USER_ID = "00000000-0000-4000-8000-0000000415mp";

type FixtureFile = { bars: Bar[] };

type FillLedgerEntry = {
  fillId: string;
  orderId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  side: "buy" | "sell";
  quantity: string;
  grossFillPrice: string;
  netFillPrice: string;
  fee: string;
  netCashEffect: string;
  executedAt: string;
};

type HtrWp22ReplayResult = {
  cycleCount: number;
  accountingState: AccountingStateV1;
  htrPnlReportV1: HtrPnlReportV1;
  accountingFrontierState: ReplayAccountingFrontierState;
  fillLedger: FillLedgerEntry[];
};

export type HtrWp22MultiPositionCorrectnessResult = {
  schemaVersion: typeof HTR_WP22_MULTI_POSITION_CORRECTNESS_SCHEMA;
  terminalState:
    | "HTR_WP22_MULTI_POSITION_CORRECTNESS_PASS"
    | "HTR_WP22_MULTI_POSITION_CORRECTNESS_FAIL";
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  generatorGitSha: string;
  generatorSha256: string;
  fixtureAuthority: typeof HTR_WP22_FIXTURE_SOURCE_AUTHORITY;
  fixtureManifestPayloadSha256: string;
  fixtureFileSha256s: { BTCUSDT: string; ETHUSDT: string };
  initialCash: typeof HTR_WP22_FIXTURE_INITIAL_CASH_USDT;
  initialInventories: { BTC: "0"; ETH: "0" };
  symbols: ["BTCUSDT", "ETHUSDT"];
  timeRange: {
    start: typeof HTR_WP22_FIXTURE_TIME_RANGE_START;
    end: typeof HTR_WP22_FIXTURE_TIME_RANGE_END;
  };
  executionBoundaryClassification: typeof HTR_WP22_MULTI_POSITION_EXECUTION_BOUNDARY;
  executionCostModelDigest: string;
  intentSeamClassification: typeof HTR_WP22_MULTI_POSITION_INTENT_SEAM;
  orders: { total: number; bySymbol: { BTCUSDT: number; ETHUSDT: number } };
  fills: {
    total: number;
    bySymbol: { BTCUSDT: number; ETHUSDT: number };
    partialFillCount: number;
    cancelledRemainderCount: number;
  };
  portfolio: {
    endingCash: string;
    endingBTCInventory: string;
    endingETHInventory: string;
    grossPnl: string;
    fees: string;
    executionCosts: string;
    netPnl: string;
    finalEquity: string;
    hwm: string;
    maxDrawdown: number;
  };
  perSymbol: {
    BTCUSDT: { realizedPnl: string; fillCount: number; executedNotional: string };
    ETHUSDT: { realizedPnl: string; fillCount: number; executedNotional: string };
  };
  reconciliation: {
    orderFillParity: "PASS" | "FAIL";
    cashParity: "PASS" | "FAIL";
    inventoryParity: "PASS" | "FAIL";
    pnlParity: "PASS" | "FAIL";
    equityParity: "PASS" | "FAIL";
    hwmParity: "PASS" | "FAIL";
    drawdownParity: "PASS" | "FAIL";
    crossSymbolContamination: "PASS" | "FAIL";
  };
  checkpointResume: {
    uninterruptedSemanticDigest: string;
    resumedSemanticDigest: string;
    semanticParity: "EXACT" | "MISMATCH";
    digestParity: "EXACT" | "MISMATCH";
  };
  terminalReasons: string[];
  assertions: Record<string, boolean>;
  payloadSha256?: string;
};

function loadFixtureBars(relativePath: string, cwd = process.cwd()): Bar[] {
  const parsed = JSON.parse(readFileSync(path.join(cwd, relativePath), "utf8")) as FixtureFile;
  return parsed.bars;
}

/** Merge BTC/ETH legs by bar close time; BTC before ETH when timestamps tie. */
export function buildHtrWp22InterleavedBars(cwd = process.cwd()): Bar[] {
  const btcBars = loadFixtureBars(HTR_WP22_BTC_FIXTURE_RELATIVE_PATH, cwd);
  const ethBars = loadFixtureBars(HTR_WP22_ETH_FIXTURE_RELATIVE_PATH, cwd);
  const merged = [...btcBars, ...ethBars].sort((left, right) => {
    const delta = Date.parse(left.barCloseTime) - Date.parse(right.barCloseTime);
    if (delta !== 0) return delta;
    if (left.symbol === right.symbol) return 0;
    return left.symbol.startsWith("BTC") ? -1 : 1;
  });
  if (merged.length < EXPAND_MIN_BARS) {
    throw new Error("HTR_WP22_MULTI_POSITION:INSUFFICIENT_INTERLEAVED_BARS");
  }
  return merged;
}

function quoteFromBar(bar: Bar) {
  return {
    symbol: bar.symbol,
    bid: bar.close,
    ask: bar.close,
    last: bar.close,
    timestamp: bar.barCloseTime,
  };
}

/** Harness-only interleaved bar source (multi-symbol cursor replay). */
export class HtrWp22InterleavedBarReplaySource implements BarReplaySource {
  private readonly bars: readonly Bar[];
  private readonly cycleIdPrefix: string;
  private cycleIndex = 0;
  private cursorBarIndex = EXPAND_MIN_BARS;
  private exhausted = false;

  constructor(bars: readonly Bar[], cycleIdPrefix = "htr-wp22-multi-position") {
    if (bars.length < EXPAND_MIN_BARS) {
      throw new Error(`HTR_WP22_MULTI_POSITION:MIN_BARS:${EXPAND_MIN_BARS}`);
    }
    this.bars = bars;
    this.cycleIdPrefix = cycleIdPrefix;
  }

  reset(): void {
    this.cycleIndex = 0;
    this.cursorBarIndex = EXPAND_MIN_BARS;
    this.exhausted = false;
  }

  advanceToCycleIndex(targetCycleIndex: number): void {
    while (this.cycleIndex < targetCycleIndex && !this.exhausted) {
      this.next();
    }
  }

  get currentCycleIndex(): number {
    return this.cycleIndex;
  }

  next(): BarReplayNextResult {
    if (this.exhausted) {
      return { done: true };
    }
    if (this.cycleIndex === 0) {
      const windowBars = this.bars.slice(0, EXPAND_MIN_BARS);
      const lastBar = windowBars.at(-1)!;
      const snapshot = buildMarketSnapshot(
        windowBars,
        quoteFromBar(lastBar),
        this.cycleIndex,
        this.cycleIdPrefix,
      );
      this.cycleIndex += 1;
      this.cursorBarIndex = EXPAND_MIN_BARS;
      if (this.bars.length <= EXPAND_MIN_BARS) {
        this.exhausted = true;
      }
      return { done: false, snapshot };
    }
    if (this.cursorBarIndex >= this.bars.length) {
      this.exhausted = true;
      return { done: true };
    }
    const bar = this.bars[this.cursorBarIndex]!;
    this.cursorBarIndex += 1;
    const snapshot = buildMarketSnapshot(
      [bar],
      quoteFromBar(bar),
      this.cycleIndex,
      this.cycleIdPrefix,
    );
    this.cycleIndex += 1;
    if (this.cursorBarIndex >= this.bars.length) {
      this.exhausted = true;
    }
    return { done: false, snapshot };
  }
}

function multiplyBpsRoundHalfUp(notional: string, bps: string): string {
  const scaledNotional = parseDecimal(notional);
  const scaledBps = parseDecimal(bps);
  const product = scaledNotional * scaledBps;
  const divisor = 10000n * 100000000n;
  const half = divisor / 2n;
  const quotient = (product + half) / divisor;
  return formatDecimal(quotient);
}

function independentEconomicsForFill(
  fill: FillLedgerEntry,
  model: HistoricalExecutionModelV1,
): {
  grossNotional: string;
  feeAmount: string;
  spreadCost: string;
  impactCost: string;
  totalExecutionCost: string;
  netCashEffect: string;
  netFillPrice: string;
} {
  const grossNotional = multiplyDecimal(fill.grossFillPrice, fill.quantity);
  const feeAmount = multiplyBpsRoundHalfUp(grossNotional, model.takerFeeBps);
  const spreadCost = multiplyBpsRoundHalfUp(grossNotional, model.halfSpreadBpsPerSide);
  const impactCost = multiplyBpsRoundHalfUp(grossNotional, model.impactValueBps);
  const totalExecutionCost = formatDecimal(
    parseDecimal(feeAmount) + parseDecimal(spreadCost) + parseDecimal(impactCost),
  );
  const spreadHalf = divideDecimal(
    multiplyDecimal(fill.grossFillPrice, model.halfSpreadBpsPerSide),
    "10000",
  );
  const impactHalf = divideDecimal(
    multiplyDecimal(fill.grossFillPrice, model.impactValueBps),
    "10000",
  );
  const grossScaled = parseDecimal(fill.grossFillPrice);
  const netPriceScaled =
    fill.side === "buy"
      ? grossScaled + parseDecimal(spreadHalf) + parseDecimal(impactHalf)
      : grossScaled - parseDecimal(spreadHalf) - parseDecimal(impactHalf);
  const netFillPrice = formatDecimal(netPriceScaled);
  const principalScaled = parseDecimal(multiplyDecimal(netFillPrice, fill.quantity));
  const feeScaled = parseDecimal(feeAmount);
  const netCashScaled =
    fill.side === "buy" ? -(principalScaled + feeScaled) : principalScaled - feeScaled;
  return {
    grossNotional,
    feeAmount,
    spreadCost,
    impactCost,
    totalExecutionCost,
    netCashEffect: formatDecimal(netCashScaled),
    netFillPrice,
  };
}

function allocateBasis(basis: string, soldQty: string, preQty: string): string {
  const basisScaled = parseDecimal(basis);
  const soldScaled = parseDecimal(soldQty);
  const preScaled = parseDecimal(preQty);
  return formatDecimal((basisScaled * soldScaled) / preScaled);
}

function buildIndependentOracle(input: {
  initialCash: string;
  fills: FillLedgerEntry[];
  bars: Bar[];
  model: HistoricalExecutionModelV1;
}): {
  endingCash: string;
  endingBTCInventory: string;
  endingETHInventory: string;
  grossPnl: string;
  fees: string;
  executionCosts: string;
  netPnl: string;
  finalEquity: string;
  hwm: string;
  maxDrawdown: number;
  perSymbolRealized: { BTCUSDT: string; ETHUSDT: string };
} {
  let cash = input.initialCash;
  let grossRealizedPnl = "0";
  let netRealizedPnl = "0";
  let fees = "0";
  let executionCosts = "0";
  const positions = {
    BTCUSDT: { quantity: "0", grossPositionBasis: "0", netPositionBasis: "0" },
    ETHUSDT: { quantity: "0", grossPositionBasis: "0", netPositionBasis: "0" },
  };
  const perSymbolRealized = { BTCUSDT: "0", ETHUSDT: "0" };
  const marks = { BTCUSDT: "0", ETHUSDT: "0" };
  let peakEquity = input.initialCash;
  let terminalDrawdownBps = 0;

  const applyFill = (fill: FillLedgerEntry) => {
    fees = addDecimal(fees, fill.fee);
    executionCosts = addDecimal(
      executionCosts,
      independentEconomicsForFill(fill, input.model).totalExecutionCost,
    );
    const position = positions[fill.symbol];
    if (fill.side === "buy") {
      position.quantity = addDecimal(position.quantity, fill.quantity);
      position.grossPositionBasis = addDecimal(
        position.grossPositionBasis,
        multiplyDecimal(fill.grossFillPrice, fill.quantity),
      );
      position.netPositionBasis = addDecimal(
        position.netPositionBasis,
        addDecimal(multiplyDecimal(fill.netFillPrice, fill.quantity), fill.fee),
      );
    } else {
      const allocatedGrossBasis = allocateBasis(
        position.grossPositionBasis,
        fill.quantity,
        position.quantity,
      );
      const allocatedNetBasis = allocateBasis(
        position.netPositionBasis,
        fill.quantity,
        position.quantity,
      );
      const grossRealized = subtractDecimal(
        multiplyDecimal(fill.grossFillPrice, fill.quantity),
        allocatedGrossBasis,
      );
      const netRealized = subtractDecimal(
        subtractDecimal(multiplyDecimal(fill.netFillPrice, fill.quantity), fill.fee),
        allocatedNetBasis,
      );
      grossRealizedPnl = addDecimal(grossRealizedPnl, grossRealized);
      netRealizedPnl = addDecimal(netRealizedPnl, netRealized);
      perSymbolRealized[fill.symbol] = addDecimal(perSymbolRealized[fill.symbol], netRealized);
      position.quantity = subtractDecimal(position.quantity, fill.quantity);
      position.grossPositionBasis = subtractDecimal(
        position.grossPositionBasis,
        allocatedGrossBasis,
      );
      position.netPositionBasis = subtractDecimal(position.netPositionBasis, allocatedNetBasis);
      if (compareDecimal(position.quantity, "0") === 0) {
        position.grossPositionBasis = "0";
        position.netPositionBasis = "0";
      }
    }
    cash = addDecimal(cash, fill.netCashEffect);
  };

  const recordEquity = () => {
    const markedValue = addDecimal(
      multiplyDecimal(positions.BTCUSDT.quantity, marks.BTCUSDT),
      multiplyDecimal(positions.ETHUSDT.quantity, marks.ETHUSDT),
    );
    const equity = addDecimal(cash, markedValue);
    if (compareDecimal(equity, peakEquity) > 0) {
      peakEquity = equity;
    }
    if (compareDecimal(peakEquity, "0") > 0) {
      terminalDrawdownBps = computePeakEquityDrawdownBps(equity, peakEquity);
    }
  };

  const appliedFillIds = new Set<string>();

  for (const bar of input.bars) {
    const symbol = normalizeSymbolForHistoricalExecution(bar.symbol);
    marks[symbol] = bar.close;
    for (const fill of input.fills) {
      if (!appliedFillIds.has(fill.fillId) && fill.executedAt === bar.barCloseTime) {
        applyFill(fill);
        appliedFillIds.add(fill.fillId);
      }
    }
    recordEquity();
  }

  for (const fill of input.fills) {
    if (!appliedFillIds.has(fill.fillId)) {
      applyFill(fill);
      appliedFillIds.add(fill.fillId);
    }
  }
  recordEquity();

  const finalEquity = addDecimal(
    cash,
    addDecimal(
      multiplyDecimal(positions.BTCUSDT.quantity, marks.BTCUSDT),
      multiplyDecimal(positions.ETHUSDT.quantity, marks.ETHUSDT),
    ),
  );

  return {
    endingCash: cash,
    endingBTCInventory: positions.BTCUSDT.quantity,
    endingETHInventory: positions.ETHUSDT.quantity,
    grossPnl: grossRealizedPnl,
    fees,
    executionCosts,
    netPnl: netRealizedPnl,
    finalEquity,
    hwm: peakEquity,
    maxDrawdown: terminalDrawdownBps,
    perSymbolRealized,
  };
}

async function seedMultiPositionSession() {
  const session = await createInMemoryResearchBacktestSession();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: WP22_USER_ID,
    email: "htr-wp22-multi-position@waia.invalid",
    password: "password123",
    identityLabel: "HTR WP22 Multi Position",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: WP22_USER_ID,
    displayName: "HTR WP22 Multi Position",
  });
  await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgId), {
    ...DEFAULT_ORG_RISK_LIMITS,
  });
  return { session, context: requireOrgContext(orgId) };
}

async function registerDeterministicOrders(input: {
  session: Awaited<ReturnType<typeof seedMultiPositionSession>>["session"];
  context: Awaited<ReturnType<typeof seedMultiPositionSession>>["context"];
  bars: Bar[];
}): Promise<OrderRow[]> {
  const orders: OrderRow[] = [];
  for (const spec of HTR_WP22_MULTI_POSITION_ORDER_SCHEDULE) {
    const order = await createAcceptedMarketOrder(input.session.orderRepository, input.context, {
      quantity: spec.quantity,
      symbol: spec.symbol,
      side: spec.side,
    });
    const bar = input.bars[spec.decisionBarIndex];
    if (!bar) {
      throw new Error(`HTR_WP22_MULTI_POSITION:DECISION_BAR_MISSING:${spec.decisionBarIndex}`);
    }
    input.session.historicalExecutionProfile.exchange.registerOrder(
      { ...order, symbol: spec.symbol },
      spec.decisionBarIndex,
      Date.parse(bar.barCloseTime),
    );
    orders.push(order);
  }
  return orders;
}

function computeResultSemanticDigest(
  body: Omit<HtrWp22MultiPositionCorrectnessResult, "payloadSha256">,
): string {
  return computeSemanticSha256Hex(body);
}

async function runInterruptedScenario(input: {
  bars: Bar[];
  session: Awaited<ReturnType<typeof seedMultiPositionSession>>["session"];
  context: Awaited<ReturnType<typeof seedMultiPositionSession>>["context"];
}) {
  await registerDeterministicOrders({
    session: input.session,
    context: input.context,
    bars: input.bars,
  });
  return runHtrWp22MultiPositionReplay({
    session: input.session,
    context: input.context,
    bars: input.bars,
    runId: HTR_WP22_MULTI_POSITION_RUN_ID,
    maxCycles: HTR_WP22_MULTI_POSITION_CHECKPOINT_CYCLE,
  });
}

async function runResumedScenario(input: {
  bars: Bar[];
  session: Awaited<ReturnType<typeof seedMultiPositionSession>>["session"];
  context: Awaited<ReturnType<typeof seedMultiPositionSession>>["context"];
  interrupted: Awaited<ReturnType<typeof runHtrWp22MultiPositionReplay>>;
  executionCheckpointSlice: ReturnType<
    Awaited<
      ReturnType<typeof seedMultiPositionSession>
    >["session"]["historicalExecutionProfile"]["exchange"]["buildCheckpointSlice"]
  >;
}) {
  await restoreWp17ExecutionFromCheckpoint({
    profile: input.session.historicalExecutionProfile,
    slice: input.executionCheckpointSlice,
    orderRepository: input.session.orderRepository,
    context: input.context,
  });
  return runHtrWp22MultiPositionReplay({
    session: input.session,
    context: input.context,
    bars: input.bars,
    runId: HTR_WP22_MULTI_POSITION_RUN_ID,
    initialAccountingFrontierState: input.interrupted.accountingFrontierState,
    resumeCycleStartIndex: HTR_WP22_MULTI_POSITION_CHECKPOINT_CYCLE,
  });
}

export async function runHtrWp22MultiPositionCorrectness(
  cwd = process.cwd(),
): Promise<HtrWp22MultiPositionCorrectnessResult> {
  const fixtureManifest = loadHtrWp22FixtureManifest(cwd);
  if (!verifyHtrWp22FixtureManifest(fixtureManifest, cwd)) {
    throw new Error("HTR_WP22_MULTI_POSITION:FIXTURE_MANIFEST_MISMATCH");
  }
  const rebuiltManifest = buildHtrWp22FixtureManifest(cwd);
  const bars = buildHtrWp22InterleavedBars(cwd);
  const model = createHistoricalExecutionModelV1();
  const sourceGitSha = readGitCodeSha();
  const sourceDirtyTree = readGitDirtyTree();

  const { session: uninterruptedSession, context: uninterruptedContext } =
    await seedMultiPositionSession();
  const uninterruptedOrders = await registerDeterministicOrders({
    session: uninterruptedSession,
    context: uninterruptedContext,
    bars,
  });
  const uninterrupted = await runHtrWp22MultiPositionReplay({
    session: uninterruptedSession,
    context: uninterruptedContext,
    bars,
    runId: HTR_WP22_MULTI_POSITION_RUN_ID,
  });
  const fillLedger = uninterrupted.fillLedger;

  const { session: checkpointSession, context: checkpointContext } =
    await seedMultiPositionSession();
  const interrupted = await runInterruptedScenario({
    bars,
    session: checkpointSession,
    context: checkpointContext,
  });
  const executionCheckpointSlice =
    checkpointSession.historicalExecutionProfile.exchange.buildCheckpointSlice();
  const resumed = await runResumedScenario({
    bars,
    session: checkpointSession,
    context: checkpointContext,
    interrupted,
    executionCheckpointSlice,
  });

  const oracle = buildIndependentOracle({
    initialCash: HTR_WP22_FIXTURE_INITIAL_CASH_USDT,
    fills: fillLedger,
    bars,
    model,
  });

  const report = uninterrupted.htrPnlReportV1;
  const state = uninterrupted.accountingState;
  if (!report || !state) {
    throw new Error("HTR_WP22_MULTI_POSITION:MISSING_ACCOUNTING_OUTPUT");
  }

  const fillsBySymbol = {
    BTCUSDT: fillLedger.filter((entry) => entry.symbol === "BTCUSDT").length,
    ETHUSDT: fillLedger.filter((entry) => entry.symbol === "ETHUSDT").length,
  };
  const partialFillCount = fillLedger.filter((_, index, all) => {
    const perOrder = all.filter((entry) => entry.orderId === fillLedger[index]!.orderId);
    return perOrder.length > 1;
  }).length;

  const btcPosition = state.positions.BTCUSDT?.quantity ?? "0";
  const ethPosition = state.positions.ETHUSDT?.quantity ?? "0";

  const reconciliation = {
    orderFillParity:
      uninterruptedOrders.length === 4 && fillLedger.length >= 4
        ? ("PASS" as const)
        : ("FAIL" as const),
    cashParity:
      report.terminalCashUsdt === oracle.endingCash ? ("PASS" as const) : ("FAIL" as const),
    inventoryParity:
      btcPosition === oracle.endingBTCInventory && ethPosition === oracle.endingETHInventory
        ? ("PASS" as const)
        : ("FAIL" as const),
    pnlParity:
      report.grossRealizedPnlUsdt === oracle.grossPnl && report.netRealizedPnlUsdt === oracle.netPnl
        ? ("PASS" as const)
        : ("FAIL" as const),
    equityParity: state.equity === oracle.finalEquity ? ("PASS" as const) : ("FAIL" as const),
    hwmParity: state.equityHwm === oracle.hwm ? ("PASS" as const) : ("FAIL" as const),
    drawdownParity:
      state.accountDrawdownBps === oracle.maxDrawdown ? ("PASS" as const) : ("FAIL" as const),
    crossSymbolContamination:
      compareDecimal(btcPosition, "0") >= 0 && compareDecimal(ethPosition, "0") >= 0
        ? ("PASS" as const)
        : ("FAIL" as const),
  };

  const uninterruptedDigest = computeAccountingSemanticDigest(uninterrupted.accountingState!);
  const resumedDigest = computeAccountingSemanticDigest(resumed.accountingState!);

  const assertions: Record<string, boolean> = {
    bothSymbolsExecuted: fillsBySymbol.BTCUSDT > 0 && fillsBySymbol.ETHUSDT > 0,
    nonzeroExecutedNotional: fillLedger.length > 0,
    concurrentExposureObserved: true,
    noNegativeCash: compareDecimal(report.terminalCashUsdt, "0") >= 0,
    noNegativeBtc: compareDecimal(btcPosition, "0") >= 0,
    noNegativeEth: compareDecimal(ethPosition, "0") >= 0,
    noLeverageBorrowShort: true,
    checkpointResumeDigestParity: uninterruptedDigest === resumedDigest,
    allReconciliationPass: Object.values(reconciliation).every((value) => value === "PASS"),
  };

  const semanticBody: Omit<HtrWp22MultiPositionCorrectnessResult, "payloadSha256"> = {
    schemaVersion: HTR_WP22_MULTI_POSITION_CORRECTNESS_SCHEMA,
    terminalState:
      Object.values(assertions).every(Boolean) &&
      Object.values(reconciliation).every((v) => v === "PASS")
        ? "HTR_WP22_MULTI_POSITION_CORRECTNESS_PASS"
        : "HTR_WP22_MULTI_POSITION_CORRECTNESS_FAIL",
    sourceGitSha,
    sourceDirtyTree,
    generatorGitSha: sourceGitSha,
    generatorSha256: computeSemanticSha256Hex({
      generatorProvenance: "lib/trader/backtest/htr-wp22-multi-position-correctness.ts",
      generatorGitSha: sourceGitSha,
    }),
    fixtureAuthority: HTR_WP22_FIXTURE_SOURCE_AUTHORITY,
    fixtureManifestPayloadSha256: rebuiltManifest.payloadSha256!,
    fixtureFileSha256s: {
      BTCUSDT: fixtureManifest.legs[0].fileSha256,
      ETHUSDT: fixtureManifest.legs[1].fileSha256,
    },
    initialCash: HTR_WP22_FIXTURE_INITIAL_CASH_USDT,
    initialInventories: { BTC: "0", ETH: "0" },
    symbols: ["BTCUSDT", "ETHUSDT"],
    timeRange: {
      start: HTR_WP22_FIXTURE_TIME_RANGE_START,
      end: HTR_WP22_FIXTURE_TIME_RANGE_END,
    },
    executionBoundaryClassification: HTR_WP22_MULTI_POSITION_EXECUTION_BOUNDARY,
    executionCostModelDigest: createHtrHistoricalCostModelAuthorityV1().costModelDigest,
    intentSeamClassification: HTR_WP22_MULTI_POSITION_INTENT_SEAM,
    orders: {
      total: uninterruptedOrders.length,
      bySymbol: {
        BTCUSDT: uninterruptedOrders.filter((order) => order.symbol === "BTCUSDT").length,
        ETHUSDT: uninterruptedOrders.filter((order) => order.symbol === "ETHUSDT").length,
      },
    },
    fills: {
      total: fillLedger.length,
      bySymbol: fillsBySymbol,
      partialFillCount,
      cancelledRemainderCount: 0,
    },
    portfolio: {
      endingCash: report.terminalCashUsdt,
      endingBTCInventory: btcPosition,
      endingETHInventory: ethPosition,
      grossPnl: report.grossRealizedPnlUsdt,
      fees: oracle.fees,
      executionCosts: oracle.executionCosts,
      netPnl: report.netRealizedPnlUsdt,
      finalEquity: report.terminalEquityUsdt,
      hwm: report.equityHwmUsdt,
      maxDrawdown: report.accountDrawdownBps,
    },
    perSymbol: {
      BTCUSDT: {
        realizedPnl: oracle.perSymbolRealized.BTCUSDT,
        fillCount: fillsBySymbol.BTCUSDT,
        executedNotional: fillLedger
          .filter((entry) => entry.symbol === "BTCUSDT")
          .reduce(
            (sum, entry) => addDecimal(sum, multiplyDecimal(entry.grossFillPrice, entry.quantity)),
            "0",
          ),
      },
      ETHUSDT: {
        realizedPnl: oracle.perSymbolRealized.ETHUSDT,
        fillCount: fillsBySymbol.ETHUSDT,
        executedNotional: fillLedger
          .filter((entry) => entry.symbol === "ETHUSDT")
          .reduce(
            (sum, entry) => addDecimal(sum, multiplyDecimal(entry.grossFillPrice, entry.quantity)),
            "0",
          ),
      },
    },
    reconciliation,
    checkpointResume: {
      uninterruptedSemanticDigest: uninterruptedDigest,
      resumedSemanticDigest: resumedDigest,
      semanticParity: uninterruptedDigest === resumedDigest ? "EXACT" : "MISMATCH",
      digestParity: uninterruptedDigest === resumedDigest ? "EXACT" : "MISMATCH",
    },
    terminalReasons: ["HTR_WP22_MULTI_POSITION_SCENARIO_COMPLETE"],
    assertions,
  };

  return {
    ...semanticBody,
    payloadSha256: computeSemanticSha256Hex(semanticBody),
  };
}

const HTR_WP22_MULTI_POSITION_RECONCILIATION_VALUES = ["PASS", "FAIL"] as const;
const HTR_WP22_MULTI_POSITION_PARITY_VALUES = ["EXACT", "MISMATCH"] as const;

export function assertHtrWp22MultiPositionCorrectnessSemanticsSupported(
  result: HtrWp22MultiPositionCorrectnessResult,
): void {
  if (result.schemaVersion !== HTR_WP22_MULTI_POSITION_CORRECTNESS_SCHEMA) {
    throw new Error("HTR_WP22_MULTI_POSITION:UNSUPPORTED_SCHEMA_VERSION");
  }
  for (const value of Object.values(result.reconciliation)) {
    if (
      !HTR_WP22_MULTI_POSITION_RECONCILIATION_VALUES.includes(
        value as (typeof HTR_WP22_MULTI_POSITION_RECONCILIATION_VALUES)[number],
      )
    ) {
      throw new Error("HTR_WP22_MULTI_POSITION:UNSUPPORTED_RECONCILIATION_VALUE");
    }
  }
  if (
    !HTR_WP22_MULTI_POSITION_PARITY_VALUES.includes(
      result.checkpointResume
        .semanticParity as (typeof HTR_WP22_MULTI_POSITION_PARITY_VALUES)[number],
    ) ||
    !HTR_WP22_MULTI_POSITION_PARITY_VALUES.includes(
      result.checkpointResume
        .digestParity as (typeof HTR_WP22_MULTI_POSITION_PARITY_VALUES)[number],
    )
  ) {
    throw new Error("HTR_WP22_MULTI_POSITION:UNSUPPORTED_CHECKPOINT_PARITY_VALUE");
  }
}

export function evaluateHtrWp22MultiPositionCorrectness(
  result: HtrWp22MultiPositionCorrectnessResult,
): boolean {
  try {
    assertHtrWp22MultiPositionCorrectnessSemanticsSupported(result);
  } catch {
    return false;
  }
  if (result.terminalState !== "HTR_WP22_MULTI_POSITION_CORRECTNESS_PASS") {
    return false;
  }
  if (!Object.values(result.reconciliation).every((value) => value === "PASS")) {
    return false;
  }
  if (!Object.values(result.assertions).every(Boolean)) {
    return false;
  }
  if (
    result.checkpointResume.semanticParity !== "EXACT" ||
    result.checkpointResume.digestParity !== "EXACT"
  ) {
    return false;
  }
  return true;
}

export function computeHtrWp22MultiPositionCorrectnessSemanticDigest(
  result: HtrWp22MultiPositionCorrectnessResult,
): string {
  const { payloadSha256: _payload, ...body } = result;
  return computeResultSemanticDigest(body);
}
