import type { Bar } from "@/lib/trader/intelligence/types";
import {
  advanceAccountingFrontier,
  buildHtrPnlReportV1,
  computeAccountingSemanticDigest,
  createInitialAccountingState,
} from "@/lib/trader/accounting";
import {
  assertAccountingReconciliation,
  buildHistoricalRealityReconciliationReport,
} from "@/lib/trader/accounting/accounting-reconciliation";
import type { AccountingReconciliationInput } from "@/lib/trader/accounting/accounting-reconciliation.types";
import type {
  AccountingFillInput,
  AccountingStateV1,
  MarksJsonV1,
} from "@/lib/trader/accounting/accounting-frontier.types";
import type { HtrPnlReportV1 } from "@/lib/trader/accounting/htr-pnl-report-v1.types";
import { normalizeSymbolForHistoricalExecution } from "@/lib/trader/backtest/historical-execution-profile";
import type { ReplayAccountingFrontierState } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  evaluateHtrGuardianCycle,
  type HtrGuardianCycleResult,
} from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import type { HtrGuardianExitReasonV1 } from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import type { HtrGuardianBreachState } from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import type {
  PortfolioAccountState,
  PortfolioSizingLimits,
} from "@/lib/trader/portfolio/portfolio-account.types";
import { PORTFOLIO_RISK_SEMANTICS_VERSION_V1 } from "@/lib/trader/portfolio/portfolio-semantics";
import type { PortfolioRunConfig } from "@/lib/trader/portfolio/portfolio-run-config.types";
import type { StopDistanceProvider } from "@/lib/trader/portfolio/stop-distance-provider.types";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import { toAccountRiskState } from "@/lib/trader/portfolio/to-account-risk-state";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export type HtrRuntimeCallKind =
  | "WP18_INITIAL_STATE"
  | "WP17_FILL_CONSUMED"
  | "WP18_MARK_ATTACHED"
  | "WP19_RECONCILIATION_PASS"
  | "WP19_RECONCILIATION_FAIL"
  | "WP20_GUARDIAN_EVALUATED"
  | "CHECKPOINT_RESTORED"
  | "TERMINAL_EXPORT";

export type HtrRuntimeCallEvent = {
  kind: HtrRuntimeCallKind;
  at: string;
  cycleIndex?: number;
  detail?: string;
};

export type HtrAccountingCashEvent = {
  fillId: string;
  netCashEffect: string;
};

export type HtrAccountingCycleBridge = {
  state: AccountingStateV1;
  cashEvents: HtrAccountingCashEvent[];
  callOrder: HtrRuntimeCallEvent[];
  lastGuardianCycle: HtrGuardianCycleResult | null;
  breachState: HtrGuardianBreachState;
  guardianReason: HtrGuardianExitReasonV1 | null;
  runTerminated: boolean;
  terminationCode: string | null;
  startingCashUsdt: string;
  startingEquityUsdt: string;
};

export type HtrAccountingCycleContext = {
  bridge: HtrAccountingCycleBridge;
  resolveInventoryOpenQtyBySymbol: () => Promise<Record<string, string>>;
};

export class HtrAccountingReconciliationTerminationError extends Error {
  readonly code = "HTR_ACCOUNTING_RECONCILIATION_TERMINATED";

  constructor(message: string) {
    super(message);
    this.name = "HtrAccountingReconciliationTerminationError";
  }
}

function accountingSymbolToPortfolioSymbol(symbol: string): string {
  if (symbol.includes("/")) {
    return symbol;
  }
  if (symbol.endsWith("USDT")) {
    return `${symbol.slice(0, -4)}/USDT`;
  }
  return symbol;
}

function recordRuntimeCall(
  bridge: HtrAccountingCycleBridge,
  kind: HtrRuntimeCallKind,
  input?: { cycleIndex?: number; detail?: string; at?: string },
): void {
  bridge.callOrder.push({
    kind,
    at: input?.at ?? bridge.state.frontierAsOf,
    cycleIndex: input?.cycleIndex,
    detail: input?.detail,
  });
}

export function createHtrAccountingCycleBridge(input: {
  organizationId: string;
  accountKey: string;
  runId: string;
  frontierAsOf?: string;
  startingCashUsdt?: string;
}): HtrAccountingCycleBridge {
  const startingCashUsdt = input.startingCashUsdt ?? HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT;
  const state = createInitialAccountingState({
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    runId: input.runId,
    startingCash: startingCashUsdt,
    frontierAsOf: input.frontierAsOf,
  });
  const bridge: HtrAccountingCycleBridge = {
    state,
    cashEvents: [],
    callOrder: [],
    lastGuardianCycle: null,
    breachState: "NONE",
    guardianReason: null,
    runTerminated: false,
    terminationCode: null,
    startingCashUsdt,
    startingEquityUsdt: startingCashUsdt,
  };
  recordRuntimeCall(bridge, "WP18_INITIAL_STATE", { at: state.frontierAsOf });
  return bridge;
}

export function consumeWp17FillIntoAccountingBridge(
  bridge: HtrAccountingCycleBridge,
  input: {
    fill: AccountingFillInput;
    cycleIndex: number;
  },
): void {
  assertBridgeActive(bridge);
  if (bridge.state.consumedFillIds.includes(input.fill.fillId)) {
    throw new HtrAccountingReconciliationTerminationError(
      `[htr/accounting-bridge] duplicate fill consumption ${input.fill.fillId}`,
    );
  }
  bridge.state = advanceAccountingFrontier({
    state: bridge.state,
    fill: input.fill,
    frontierAsOf: input.fill.executedAt,
  });
  bridge.cashEvents.push({
    fillId: input.fill.fillId,
    netCashEffect: input.fill.economics.netCashEffect,
  });
  recordRuntimeCall(bridge, "WP17_FILL_CONSUMED", {
    cycleIndex: input.cycleIndex,
    detail: input.fill.fillId,
    at: input.fill.executedAt,
  });
}

export function attachClosed1mMarkToAccountingBridge(
  bridge: HtrAccountingCycleBridge,
  closedBar: Bar,
  cycleIndex: number,
): void {
  assertBridgeActive(bridge);
  const symbol = normalizeSymbolForHistoricalExecution(closedBar.symbol);
  const marks: MarksJsonV1 = {
    [symbol]: {
      price: closedBar.close,
      barCloseTime: closedBar.barCloseTime,
    },
  };
  bridge.state = advanceAccountingFrontier({
    state: bridge.state,
    marks,
    frontierAsOf: closedBar.barCloseTime,
  });
  recordRuntimeCall(bridge, "WP18_MARK_ATTACHED", {
    cycleIndex,
    detail: symbol,
    at: closedBar.barCloseTime,
  });
}

export function buildHtrReconciliationInput(
  bridge: HtrAccountingCycleBridge,
  extras?: {
    inventoryOpenQtyBySymbol?: Record<string, string>;
    equitySeriesTerminal?: string;
    pnlReport?: HtrPnlReportV1;
  },
): AccountingReconciliationInput {
  const pnlReport =
    extras?.pnlReport ??
    buildHtrPnlReportV1({
      state: bridge.state,
      startingEquityUsdt: bridge.startingEquityUsdt,
      semanticDigest: computeAccountingSemanticDigest(bridge.state),
    });
  return {
    state: bridge.state,
    startingEquityUsdt: bridge.startingEquityUsdt,
    startingCashUsdt: bridge.startingCashUsdt,
    cashEvents: bridge.cashEvents,
    inventoryOpenQtyBySymbol: extras?.inventoryOpenQtyBySymbol,
    equitySeriesTerminal: extras?.equitySeriesTerminal,
    pnlReport,
  };
}

export function runAutomaticAccountingReconciliation(
  bridge: HtrAccountingCycleBridge,
  input: {
    inventoryOpenQtyBySymbol?: Record<string, string>;
    cycleIndex?: number;
    phase?:
      | "frontier_mutation"
      | "checkpoint_restore"
      | "before_guardian"
      | "before_cycle_complete"
      | "before_terminal_export";
  },
): void {
  assertBridgeActive(bridge);
  try {
    assertAccountingReconciliation(
      buildHtrReconciliationInput(bridge, {
        inventoryOpenQtyBySymbol: input.inventoryOpenQtyBySymbol,
      }),
    );
    recordRuntimeCall(bridge, "WP19_RECONCILIATION_PASS", {
      cycleIndex: input.cycleIndex,
      detail: input.phase,
    });
  } catch (error) {
    recordRuntimeCall(bridge, "WP19_RECONCILIATION_FAIL", {
      cycleIndex: input.cycleIndex,
      detail: error instanceof Error ? error.message : String(error),
    });
    terminateBridgeRun(bridge, "RECONCILIATION_FAILURE");
    throw new HtrAccountingReconciliationTerminationError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function evaluateHtrGuardianForBridge(
  bridge: HtrAccountingCycleBridge,
  input: {
    equityUsdt: string;
    missingMark?: boolean;
    cycleIndex: number;
    inventoryOpenQtyBySymbol?: Record<string, string>;
  },
): HtrGuardianCycleResult {
  assertBridgeActive(bridge);
  const reconciliation = buildHtrReconciliationInput(bridge, {
    inventoryOpenQtyBySymbol: input.inventoryOpenQtyBySymbol,
  });
  const cycle = evaluateHtrGuardianCycle({
    reconciliation,
    accountPeakHwm: bridge.state.equityHwm,
    monthlyPeakHwm: bridge.state.equityHwm,
    equityUsdt: input.equityUsdt,
    missingMark: input.missingMark,
  });
  bridge.lastGuardianCycle = cycle;
  bridge.breachState = cycle.breachState;
  bridge.guardianReason = cycle.reason;
  recordRuntimeCall(bridge, "WP20_GUARDIAN_EVALUATED", {
    cycleIndex: input.cycleIndex,
    detail: cycle.breachState,
  });
  return cycle;
}

export function derivePortfolioFromAccountingState(input: {
  state: AccountingStateV1;
  runConfig: PortfolioRunConfig;
  limits: PortfolioSizingLimits;
  stopDistanceProvider: StopDistanceProvider;
}): PortfolioAccountState {
  const positions = Object.entries(input.state.positions)
    .filter(([, position]) => compareDecimal(position.quantity, "0") > 0)
    .map(([symbol, position]) => {
      const portfolioSymbol = accountingSymbolToPortfolioSymbol(symbol);
      const mark = input.state.marks[symbol];
      const markPrice = mark?.price ?? "0";
      const avgCost =
        compareDecimal(position.quantity, "0") > 0
          ? divideDecimal(position.netPositionBasis, position.quantity)
          : "0";
      const unrealizedPnlUsdt = multiplyDecimal(
        subtractDecimal(markPrice, avgCost),
        position.quantity,
      );
      const stop = input.stopDistanceProvider.resolveStopDistance({
        entryPrice: avgCost,
        symbol: portfolioSymbol,
        side: "buy",
        signal: {
          strategySignalId: "portfolio-accounting-bridge",
          strategyId: "mean_reversion_v0",
          strategyVersion: "0",
          organizationId: input.state.organizationId,
          symbol: portfolioSymbol,
          outcome: "NO_SIGNAL",
          reasonCodes: [],
          msvId: "msv-accounting-bridge",
          featureSetId: "fs-accounting-bridge",
          evaluatedAt: input.state.frontierAsOf,
        },
        runConfig: input.runConfig,
      });
      const riskAtStopUsdt = multiplyDecimal(position.quantity, stop.stopDistanceUsdt);
      return {
        symbol: portfolioSymbol,
        quantity: position.quantity,
        avgCost,
        markPrice,
        unrealizedPnlUsdt,
        riskAtStopUsdt,
        stopDistanceUsdt: stop.stopDistanceUsdt,
      };
    });

  let markedPnlUsdt = "0";
  let openRiskUsdt = "0";
  for (const position of positions) {
    markedPnlUsdt = addDecimal(markedPnlUsdt, position.unrealizedPnlUsdt);
    openRiskUsdt = addDecimal(openRiskUsdt, position.riskAtStopUsdt);
  }

  const grossUnrealized = subtractDecimal(
    input.state.markedPositionValue,
    remainingNetPositionBasisFromState(input.state),
  );
  const feesPaidUsdt = subtractDecimal(
    addDecimal(input.state.grossRealizedPnl, grossUnrealized),
    addDecimal(input.state.netRealizedPnl, grossUnrealized),
  );

  return {
    semanticsVersion: PORTFOLIO_RISK_SEMANTICS_VERSION_V1,
    quoteCurrency: "USDT",
    startingBalanceUsdt: input.runConfig.startingBalanceUsdt,
    availableBalanceUsdt: input.state.cash,
    reservedMarginUsdt: "0",
    realizedPnlUsdt: input.state.netRealizedPnl,
    markedPnlUsdt,
    feesPaidUsdt,
    equityUsdt: input.state.equity,
    openRiskUsdt,
    openPositionCount: positions.length,
    maxRiskPerTradePct: input.limits.maxRiskPerTradePct,
    maxPortfolioRiskPct: input.limits.maxPortfolioRiskPct,
    maxConcurrentPositions: input.limits.maxConcurrentPositions,
    positions,
  };
}

function remainingNetPositionBasisFromState(state: AccountingStateV1): string {
  return Object.values(state.positions).reduce(
    (sum, position) => addDecimal(sum, position.netPositionBasis),
    "0",
  );
}

export function deriveAccountRiskStateFromBridge(
  bridge: HtrAccountingCycleBridge,
  input: {
    portfolio?: PortfolioAccountState;
    openOrderCount: number;
  },
): AccountRiskState {
  const portfolio =
    input.portfolio ??
    derivePortfolioFromAccountingState({
      state: bridge.state,
      runConfig: {
        ...DEFAULT_PORTFOLIO_RUN_CONFIG,
        startingBalanceUsdt: bridge.startingCashUsdt,
      },
      limits: {
        maxRiskPerTradePct: "0.10",
        maxPortfolioRiskPct: "0.50",
        maxConcurrentPositions: 10,
        maxNotional: "100000.00",
      },
      stopDistanceProvider: defaultStopDistanceProvider,
    });
  return toAccountRiskState({
    portfolio,
    openOrderCount: input.openOrderCount,
    accountPeakHwm: bridge.state.equityHwm,
    monthlyPeakHwm: bridge.state.equityHwm,
  });
}

export function toAccountingCheckpointSlice(
  bridge: HtrAccountingCycleBridge,
): ReplayAccountingFrontierState {
  return {
    accountingSequence: bridge.state.accountingSequence,
    frontierAsOf: bridge.state.frontierAsOf,
    cash: bridge.state.cash,
    equity: bridge.state.equity,
    equityHwm: bridge.state.equityHwm,
    accountDrawdownBps: bridge.state.accountDrawdownBps,
    marksJson: bridge.state.marks,
    positionsJson: bridge.state.positions,
    consumedFillIds: [...bridge.state.consumedFillIds],
    cashEventsJson: [...bridge.cashEvents],
    grossRealizedPnl: bridge.state.grossRealizedPnl,
    netRealizedPnl: bridge.state.netRealizedPnl,
    semanticContentDigest: computeAccountingSemanticDigest(bridge.state),
  };
}

export function restoreAccountingBridgeFromCheckpoint(
  bridge: HtrAccountingCycleBridge,
  slice: ReplayAccountingFrontierState,
): void {
  const restoredState: AccountingStateV1 = {
    ...bridge.state,
    accountingSequence: slice.accountingSequence,
    frontierAsOf: slice.frontierAsOf,
    cash: slice.cash,
    equity: slice.equity,
    equityHwm: slice.equityHwm,
    accountDrawdownBps: slice.accountDrawdownBps,
    marks: { ...slice.marksJson },
    positions: { ...slice.positionsJson },
    consumedFillIds: [...slice.consumedFillIds],
    grossRealizedPnl: slice.grossRealizedPnl,
    netRealizedPnl: slice.netRealizedPnl,
    markedPositionValue: subtractDecimal(slice.equity, slice.cash),
  };
  const restoredDigest = computeAccountingSemanticDigest(restoredState);
  if (restoredDigest !== slice.semanticContentDigest) {
    terminateBridgeRun(bridge, "CHECKPOINT_ACCOUNTING_DIGEST_MISMATCH");
    throw new HtrAccountingReconciliationTerminationError(
      "[htr/accounting-bridge] checkpoint accounting digest mismatch",
    );
  }
  bridge.state = restoredState;
  bridge.cashEvents = [...slice.cashEventsJson];
  recordRuntimeCall(bridge, "CHECKPOINT_RESTORED", { detail: String(slice.accountingSequence) });
}

export function buildTerminalHtrPnlReport(bridge: HtrAccountingCycleBridge): HtrPnlReportV1 {
  recordRuntimeCall(bridge, "TERMINAL_EXPORT");
  return buildHtrPnlReportV1({
    state: bridge.state,
    startingEquityUsdt: bridge.startingEquityUsdt,
    semanticDigest: computeAccountingSemanticDigest(bridge.state),
  });
}

export function buildTerminalReconciliationReport(
  bridge: HtrAccountingCycleBridge,
): ReturnType<typeof buildHistoricalRealityReconciliationReport> {
  return buildHistoricalRealityReconciliationReport(
    buildHtrReconciliationInput(bridge, { pnlReport: buildTerminalHtrPnlReport(bridge) }),
  );
}

export function assertBridgeActive(bridge: HtrAccountingCycleBridge): void {
  if (bridge.runTerminated) {
    throw new HtrAccountingReconciliationTerminationError(
      `[htr/accounting-bridge] run terminated (${bridge.terminationCode ?? "unknown"})`,
    );
  }
}

export function terminateBridgeRun(bridge: HtrAccountingCycleBridge, code: string): void {
  bridge.runTerminated = true;
  bridge.terminationCode = code;
  bridge.breachState = "STOP_ACCOUNT";
}
