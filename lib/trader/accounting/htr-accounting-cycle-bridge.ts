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
import { AccountingInvariantError } from "@/lib/trader/accounting/accounting-frontier.types";
import { normalizeAccountingStateDrawdownFields } from "@/lib/trader/accounting/accounting-frontier.types";
import type { HtrPnlReportV1 } from "@/lib/trader/accounting/htr-pnl-report-v1.types";
import { normalizeSymbolForHistoricalExecution } from "@/lib/trader/backtest/historical-execution-profile";
import type {
  ReplayAccountingFrontierState,
  ReplayDrawdownHwmState,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  evaluateHtrGuardianCycle,
  type HtrGuardianCycleResult,
} from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import type { BreachCancellationResultV1 } from "@/lib/trader/execution/execution-service.types";
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
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-constants";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import {
  computePeakEquityDrawdownBps,
  resolveDominantStrategyDrawdown,
  resolveMonthKeyUtc,
  updateDrawdownHighWaterMarks,
} from "@/lib/trader/risk/drawdown-policy-evaluator";
import type { AppendAccountDrawdownCheckpointInput } from "@/lib/trader/risk/account-drawdown-repository-postgres";
import { buildAccountDrawdownCheckpointFromBridgeState } from "@/lib/trader/risk/account-drawdown-repository-postgres";
import type { AppendStrategyDrawdownCheckpointInput } from "@/lib/trader/risk/strategy-drawdown-repository-postgres";
import { buildStrategyDrawdownCheckpointsFromBridgeState } from "@/lib/trader/risk/strategy-drawdown-repository-postgres";
import type {
  AccountDrawdownState,
  DrawdownBreachState,
  StrategyDrawdownState,
} from "@/lib/trader/risk/drawdown-policy.types";
import {
  buildStrategyAttributionKey,
  computeVirtualStrategyAllocations,
} from "@/lib/trader/risk/strategy-attribution";
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
  | "WP20_BREACH_CANCELLATION_EXECUTED"
  | "WP20_DRAWDOWN_PERSISTED"
  | "CHECKPOINT_RESTORED"
  | "TERMINAL_EXPORT";

export type HtrRuntimeCallEvent = {
  kind: HtrRuntimeCallKind;
  at: string;
  cycleIndex?: number;
  detail?: string;
};

const EMPTY_STRATEGY_PEAKS: Readonly<Record<string, string>> = Object.freeze({});
/** Shared empty inventory map for flat-book hot-path reconcile/guardian. */
export const EMPTY_INVENTORY_OPEN_QTY: Readonly<Record<string, string>> = Object.freeze({});

export type HtrAccountingCashEvent = {
  fillId: string;
  netCashEffect: string;
};

export type HtrAccountingCycleBridge = {
  state: AccountingStateV1;
  cashEvents: HtrAccountingCashEvent[];
  callOrder: HtrRuntimeCallEvent[];
  lastGuardianCycle: HtrGuardianCycleResult | null;
  lastBreachCancellation: BreachCancellationResultV1 | null;
  breachCancellationFailed: boolean;
  breachState: HtrGuardianBreachState;
  guardianReason: HtrGuardianExitReasonV1 | null;
  runTerminated: boolean;
  terminationCode: string | null;
  startingCashUsdt: string;
  startingEquityUsdt: string;
  /**
   * Cash at last durable EPOCH_COMMIT (IDHPS). Epoch cashEvents are applied on top of this base.
   * Equals startingCashUsdt until the first durable epoch authority step 10.
   */
  cashLedgerBaseUsdt: string;
  /** Fill IDs consumed after the most recent durable EPOCH_COMMIT (IDHPS). */
  epochConsumedFillIds: string[];
  /** Latest closed-bar mark per symbol for multi-instrument shared-portfolio replay. */
  lastMarkBySymbol: MarksJsonV1;
  /** IDHPS: last full-reconcile fill frontier (mark-only cycles use light checks). */
  lastFullReconcileFillCount?: number;
  lastFullReconcileCash?: string;
};

export type HtrAccountingCycleContext = {
  bridge: HtrAccountingCycleBridge;
  resolveInventoryOpenQtyBySymbol: () => Promise<Record<string, string>>;
  /** Drop cached order-repository inventory after simulated fills mutate open qty. */
  invalidateInventoryCache?: () => void;
  drawdownPersistence?: {
    port: HtrDrawdownPersistencePort;
    session: HtrDrawdownPersistenceSession;
  };
};

export type HtrDrawdownResumeMode = "fresh" | "resumable";

export type HtrDrawdownHydrationErrorCode =
  | "DRAWDOWN_MISSING_ACCOUNT_CHECKPOINT"
  | "DRAWDOWN_MISSING_STRATEGY_CHECKPOINT"
  | "DRAWDOWN_CHECKPOINT_IDENTITY_MISMATCH"
  | "DRAWDOWN_CHECKPOINT_SEQ_GAP"
  | "DRAWDOWN_CHECKPOINT_STALE"
  | "DRAWDOWN_CHECKPOINT_DIVERGENT_RETRY";

export class HtrDrawdownHydrationError extends Error {
  readonly code: HtrDrawdownHydrationErrorCode;

  constructor(code: HtrDrawdownHydrationErrorCode, message: string) {
    super(message);
    this.name = "HtrDrawdownHydrationError";
    this.code = code;
  }
}

export type HtrDrawdownPersistencePort = {
  portfolioId: string;
  resumeMode: HtrDrawdownResumeMode;
  organizationId: string;
  accountKey: string;
  runId: string;
  loadAccountCheckpoint: () => Promise<AccountDrawdownState | null>;
  loadStrategyCheckpoint: (
    strategyId: string,
    strategyVersion: string,
  ) => Promise<(StrategyDrawdownState & { strategyAllocationUsdt: string }) | null>;
  appendAccountCheckpoint: (input: AppendAccountDrawdownCheckpointInput) => Promise<void>;
  appendStrategyCheckpoint: (input: AppendStrategyDrawdownCheckpointInput) => Promise<void>;
  newCheckpointId: (input: {
    kind: "account" | "strategy";
    attrKey?: string;
    seq: number;
  }) => string;
  runInTransaction?: <T>(fn: () => Promise<T>) => Promise<T>;
};

export type HtrDrawdownPersistenceSession = {
  lastAccountSeq: number;
  lastAccountContentDigest: string | null;
  lastStrategySeqByKey: Record<string, number>;
  lastStrategyContentDigestByKey: Record<string, string>;
};

export function createDrawdownPersistenceSession(): HtrDrawdownPersistenceSession {
  return {
    lastAccountSeq: 0,
    lastAccountContentDigest: null,
    lastStrategySeqByKey: {},
    lastStrategyContentDigestByKey: {},
  };
}

function expectedTradeEligibleStrategyKeys(): string[] {
  const allocations = computeVirtualStrategyAllocations();
  const keys: string[] = [];
  for (const [rawKey, allocation] of Object.entries(allocations)) {
    if (compareDecimal(allocation, "0") <= 0) {
      continue;
    }
    const [strategyId, strategyVersion] = rawKey.split("@");
    if (!strategyId || !strategyVersion) {
      continue;
    }
    keys.push(buildStrategyAttributionKey(strategyId, strategyVersion));
  }
  return keys.sort((a, b) => a.localeCompare(b));
}

function assertDrawdownCheckpointIdentity(
  port: HtrDrawdownPersistencePort,
  row: { organizationId: string; accountKey: string; portfolioId: string; runId: string },
): void {
  if (
    row.organizationId !== port.organizationId ||
    row.accountKey !== port.accountKey ||
    row.portfolioId !== port.portfolioId ||
    row.runId !== port.runId
  ) {
    throw new HtrDrawdownHydrationError(
      "DRAWDOWN_CHECKPOINT_IDENTITY_MISMATCH",
      "[htr/drawdown] checkpoint identity mismatch",
    );
  }
}

export function applyDrawdownCheckpointToBridge(
  bridge: HtrAccountingCycleBridge,
  input: {
    account: AccountDrawdownState;
    strategies: Array<StrategyDrawdownState & { strategyAllocationUsdt: string }>;
  },
): void {
  bridge.state.equityHwm = input.account.accountPeakHwm;
  bridge.state.monthlyPeakHwm = input.account.monthlyPeakHwm;
  bridge.state.monthKey = input.account.monthKey;
  bridge.state.accountDrawdownBps = input.account.accountDrawdownBps;
  bridge.state.monthlyDrawdownBps = input.account.monthlyDrawdownBps;
  bridge.breachState = input.account.breachState;

  const strategyPeakHwmByKey: Record<string, string> = {};
  const strategyDrawdownBpsByKey: Record<string, number> = {};
  for (const row of input.strategies) {
    const key = buildStrategyAttributionKey(row.strategyId, row.strategyVersion);
    strategyPeakHwmByKey[key] = row.strategyPeakHwm;
    strategyDrawdownBpsByKey[key] = row.strategyDrawdownBps;
  }
  bridge.state.strategyPeakHwmByKey = strategyPeakHwmByKey;
  bridge.state.strategyDrawdownBpsByKey = strategyDrawdownBpsByKey;
}

export async function hydrateBridgeDrawdownFromPersistence(
  bridge: HtrAccountingCycleBridge,
  port: HtrDrawdownPersistencePort,
): Promise<void> {
  if (port.resumeMode === "fresh") {
    return;
  }

  const account = await port.loadAccountCheckpoint();
  if (!account) {
    terminateBridgeRun(bridge, "DRAWDOWN_MISSING_ACCOUNT_CHECKPOINT");
    throw new HtrDrawdownHydrationError(
      "DRAWDOWN_MISSING_ACCOUNT_CHECKPOINT",
      "[htr/drawdown] missing account drawdown checkpoint for resumable run",
    );
  }
  assertDrawdownCheckpointIdentity(port, account);

  const expectedKeys = expectedTradeEligibleStrategyKeys();
  const strategies: Array<StrategyDrawdownState & { strategyAllocationUsdt: string }> = [];
  for (const attrKey of expectedKeys) {
    const [strategyId, strategyVersion] = attrKey.split(":");
    if (!strategyId || !strategyVersion) {
      continue;
    }
    const row = await port.loadStrategyCheckpoint(strategyId, strategyVersion);
    if (!row) {
      terminateBridgeRun(bridge, "DRAWDOWN_MISSING_STRATEGY_CHECKPOINT");
      throw new HtrDrawdownHydrationError(
        "DRAWDOWN_MISSING_STRATEGY_CHECKPOINT",
        `[htr/drawdown] missing strategy checkpoint for ${attrKey}`,
      );
    }
    assertDrawdownCheckpointIdentity(port, row);
    if (row.seq !== account.seq) {
      terminateBridgeRun(bridge, "DRAWDOWN_CHECKPOINT_SEQ_GAP");
      throw new HtrDrawdownHydrationError(
        "DRAWDOWN_CHECKPOINT_SEQ_GAP",
        `[htr/drawdown] strategy/account seq mismatch for ${attrKey}`,
      );
    }
    strategies.push(row);
  }

  applyDrawdownCheckpointToBridge(bridge, { account, strategies });
  recordRuntimeCall(bridge, "CHECKPOINT_RESTORED", {
    detail: `drawdown-seq-${account.seq}`,
  });
}

export function compareReplayDrawdownHwmState(
  expected: ReplayDrawdownHwmState,
  actual: ReplayDrawdownHwmState,
): void {
  if (
    expected.accountPeakHwm !== actual.accountPeakHwm ||
    expected.monthlyPeakHwm !== actual.monthlyPeakHwm ||
    expected.monthKey !== actual.monthKey ||
    expected.accountDrawdownBps !== actual.accountDrawdownBps ||
    expected.monthlyDrawdownBps !== actual.monthlyDrawdownBps ||
    expected.breachState !== actual.breachState
  ) {
    throw new HtrDrawdownHydrationError(
      "DRAWDOWN_CHECKPOINT_IDENTITY_MISMATCH",
      "[htr/drawdown] replay drawdown HWM state mismatch",
    );
  }
  const expectedKeys = Object.keys(expected.strategyPeaks).sort();
  const actualKeys = Object.keys(actual.strategyPeaks).sort();
  if (expectedKeys.join("|") !== actualKeys.join("|")) {
    throw new HtrDrawdownHydrationError(
      "DRAWDOWN_CHECKPOINT_IDENTITY_MISMATCH",
      "[htr/drawdown] replay strategy peak key mismatch",
    );
  }
  for (const key of expectedKeys) {
    if (expected.strategyPeaks[key] !== actual.strategyPeaks[key]) {
      throw new HtrDrawdownHydrationError(
        "DRAWDOWN_CHECKPOINT_IDENTITY_MISMATCH",
        `[htr/drawdown] replay strategy peak mismatch for ${key}`,
      );
    }
    if (
      (expected.strategyDrawdownBpsByKey[key] ?? 0) !== (actual.strategyDrawdownBpsByKey[key] ?? 0)
    ) {
      throw new HtrDrawdownHydrationError(
        "DRAWDOWN_CHECKPOINT_IDENTITY_MISMATCH",
        `[htr/drawdown] replay strategy drawdown mismatch for ${key}`,
      );
    }
  }
}

export async function persistDrawdownCycleAfterGuardian(
  bridge: HtrAccountingCycleBridge,
  port: HtrDrawdownPersistencePort,
  session: HtrDrawdownPersistenceSession,
  cycleIndex: number,
): Promise<void> {
  assertBridgeActive(bridge);
  const seq = bridge.state.accountingSequence;
  const accountInput = buildAccountDrawdownCheckpointFromBridgeState({
    state: bridge.state,
    portfolioId: port.portfolioId,
    seq,
    id: port.newCheckpointId({ kind: "account", seq }),
    breachState: bridge.breachState,
  });
  const accountDigest = JSON.stringify({
    seq: accountInput.seq,
    accountPeakHwm: accountInput.accountPeakHwm,
    monthlyPeakHwm: accountInput.monthlyPeakHwm,
    monthKey: accountInput.monthKey,
    accountDrawdownBps: accountInput.accountDrawdownBps,
    monthlyDrawdownBps: accountInput.monthlyDrawdownBps,
    breachState: accountInput.breachState,
  });

  if (session.lastAccountSeq === seq && session.lastAccountContentDigest === accountDigest) {
    return;
  }
  if (session.lastAccountSeq === seq && session.lastAccountContentDigest !== accountDigest) {
    terminateBridgeRun(bridge, "DRAWDOWN_CHECKPOINT_DIVERGENT_RETRY");
    throw new HtrDrawdownHydrationError(
      "DRAWDOWN_CHECKPOINT_DIVERGENT_RETRY",
      "[htr/drawdown] divergent retry at same seq",
    );
  }

  const strategyInputs = buildStrategyDrawdownCheckpointsFromBridgeState({
    state: bridge.state,
    portfolioId: port.portfolioId,
    seqByKey: Object.fromEntries(expectedTradeEligibleStrategyKeys().map((key) => [key, seq])),
    idFactory: (attrKey) => port.newCheckpointId({ kind: "strategy", attrKey, seq }),
    breachState: bridge.breachState,
  }).sort((a, b) =>
    buildStrategyAttributionKey(a.strategyId, a.strategyVersion).localeCompare(
      buildStrategyAttributionKey(b.strategyId, b.strategyVersion),
    ),
  );

  const persist = async (): Promise<void> => {
    await port.appendAccountCheckpoint(accountInput);
    for (const strategyInput of strategyInputs) {
      await port.appendStrategyCheckpoint(strategyInput);
    }
  };

  if (port.runInTransaction) {
    await port.runInTransaction(persist);
  } else {
    await persist();
  }

  session.lastAccountSeq = seq;
  session.lastAccountContentDigest = accountDigest;
  for (const strategyInput of strategyInputs) {
    const key = buildStrategyAttributionKey(
      strategyInput.strategyId,
      strategyInput.strategyVersion,
    );
    session.lastStrategySeqByKey[key] = seq;
    session.lastStrategyContentDigestByKey[key] = JSON.stringify({
      seq: strategyInput.seq,
      strategyPeakHwm: strategyInput.strategyPeakHwm,
      strategyDrawdownBps: strategyInput.strategyDrawdownBps,
    });
  }
  recordRuntimeCall(bridge, "WP20_DRAWDOWN_PERSISTED", {
    cycleIndex,
    detail: `drawdown-persist-seq-${seq}`,
  });
}

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
    lastBreachCancellation: null,
    breachCancellationFailed: false,
    breachState: "NONE",
    guardianReason: null,
    runTerminated: false,
    terminationCode: null,
    startingCashUsdt,
    startingEquityUsdt: startingCashUsdt,
    cashLedgerBaseUsdt: startingCashUsdt,
    epochConsumedFillIds: [],
    lastMarkBySymbol: {},
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
  const normalizedFill: AccountingFillInput = {
    ...input.fill,
    economics: {
      ...input.fill.economics,
      symbol: normalizeSymbolForHistoricalExecution(input.fill.economics.symbol),
    },
  };
  bridge.state = advanceAccountingFrontier({
    state: bridge.state,
    fill: normalizedFill,
    frontierAsOf: normalizedFill.executedAt,
    skipSemanticDigest: true,
  });
  bridge.cashEvents.push({
    fillId: input.fill.fillId,
    netCashEffect: input.fill.economics.netCashEffect,
  });
  bridge.epochConsumedFillIds.push(input.fill.fillId);
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
  bridge.lastMarkBySymbol[symbol] = {
    price: closedBar.close,
    barCloseTime: closedBar.barCloseTime,
  };
  const mergedMarks: MarksJsonV1 = {};
  let openPositionCount = 0;
  for (const [openSymbol, position] of Object.entries(bridge.state.positions)) {
    if (compareDecimal(position.quantity, "0") <= 0) {
      continue;
    }
    openPositionCount += 1;
    const mark = bridge.lastMarkBySymbol[openSymbol] ?? bridge.state.marks[openSymbol];
    if (!mark) {
      throw new AccountingInvariantError(`[accounting] missing mark for open symbol ${openSymbol}`);
    }
    mergedMarks[openSymbol] = mark;
  }
  if (openPositionCount === 0) {
    // Flat book: bump sequence/frontier without full mark recompute.
    // Mutate in place — sole bridge owner; avoid shallow-copying the full state each bar.
    // Still apply UTC month-boundary monthly HWM reset (C-A1 / drawdown semantics).
    const mark = bridge.lastMarkBySymbol[symbol]!;
    const state = bridge.state;
    if (state.marks[symbol] !== mark) {
      state.marks = { [symbol]: mark };
    }
    // ISO frontiers are `YYYY-MM-DDTHH:mm:ss.sssZ` — month key is the YYYY-MM prefix.
    const monthKey = resolveMonthKeyUtc(closedBar.barCloseTime);
    if (monthKey !== state.monthKey) {
      const hwm = updateDrawdownHighWaterMarks({
        equityUsdt: state.equity,
        accountPeakHwm: state.equityHwm,
        monthlyPeakHwm: state.monthlyPeakHwm ?? state.equityHwm,
        priorMonthKey: state.monthKey,
        monthKey,
      });
      state.equityHwm = hwm.accountPeakHwm;
      state.monthlyPeakHwm = hwm.monthlyPeakHwm;
      state.monthKey = monthKey;
      state.accountDrawdownBps = computePeakEquityDrawdownBps(state.equity, hwm.accountPeakHwm);
      state.monthlyDrawdownBps = computePeakEquityDrawdownBps(state.equity, hwm.monthlyPeakHwm);
    }
    state.frontierAsOf = closedBar.barCloseTime;
    state.accountingSequence += 1;
    // IDHPS: flat-book marks dominate; skip callOrder push (open-book still records).
  } else {
    bridge.state = advanceAccountingFrontier({
      state: bridge.state,
      marks: mergedMarks,
      frontierAsOf: closedBar.barCloseTime,
      skipSemanticDigest: true,
    });
    recordRuntimeCall(bridge, "WP18_MARK_ATTACHED", {
      cycleIndex,
      detail: symbol,
      at: closedBar.barCloseTime,
    });
  }
}

export function buildHtrReconciliationInput(
  bridge: HtrAccountingCycleBridge,
  extras?: {
    inventoryOpenQtyBySymbol?: Record<string, string>;
    equitySeriesTerminal?: string;
    pnlReport?: HtrPnlReportV1;
    /**
     * When true, assemble the full PnL report + accounting semantic digest.
     * Hot-path automatic reconcile (default) uses terminal cash/equity only — digest
     * meaning is unchanged at terminal export / checkpoint capture.
     */
    includeFullPnlReport?: boolean;
  },
): AccountingReconciliationInput {
  const pnlReport =
    extras?.pnlReport ??
    (extras?.includeFullPnlReport
      ? buildHtrPnlReportV1({
          state: bridge.state,
          startingEquityUsdt: bridge.startingEquityUsdt,
          semanticDigest: computeAccountingSemanticDigest(bridge.state),
        })
      : {
          // IDHPS hot path: avoid SHA-256 + full PnL assembly on every reconcile phase.
          terminalEquityUsdt: bridge.state.equity,
          terminalCashUsdt: bridge.state.cash,
        });
  return {
    state: bridge.state,
    startingEquityUsdt: bridge.startingEquityUsdt,
    // Epoch-bounded cashEvents reconcile against the post-EPOCH_COMMIT cash base (IDHPS).
    startingCashUsdt: bridge.cashLedgerBaseUsdt,
    cashEvents: bridge.cashEvents,
    cashEventIntegrityFillIds: bridge.epochConsumedFillIds,
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
    const fillCount = bridge.epochConsumedFillIds.length;
    const markOnlyCycle =
      input.phase !== "before_terminal_export" &&
      input.phase !== "checkpoint_restore" &&
      fillCount === (bridge.lastFullReconcileFillCount ?? -1) &&
      bridge.state.cash === (bridge.lastFullReconcileCash ?? "");

    if (markOnlyCycle) {
      // Light check: cash/equity conservation + inventory parity (phases preserved).
      if (compareDecimal(bridge.state.markedPositionValue, "0") === 0) {
        if (compareDecimal(bridge.state.equity, bridge.state.cash) !== 0) {
          throw new Error(
            `equity ${bridge.state.equity} != cash ${bridge.state.cash} (flat marked value)`,
          );
        }
      } else {
        const expectedEquity = addDecimal(bridge.state.cash, bridge.state.markedPositionValue);
        if (compareDecimal(bridge.state.equity, expectedEquity) !== 0) {
          throw new Error(
            `equity ${bridge.state.equity} != cash ${bridge.state.cash} + marked ${bridge.state.markedPositionValue}`,
          );
        }
      }
      const inventory = input.inventoryOpenQtyBySymbol;
      if (inventory) {
        for (const symbol in inventory) {
          const expectedQty = inventory[symbol]!;
          const actualQty = bridge.state.positions[symbol]?.quantity ?? "0";
          if (compareDecimal(actualQty, expectedQty) !== 0) {
            throw new Error(
              `inventory mismatch for ${symbol}: expected ${expectedQty}, actual ${actualQty}`,
            );
          }
        }
      }
      // IDHPS: light checks keep three phases but skip callOrder push (GC); full reconciles record.
    } else {
      assertAccountingReconciliation(
        buildHtrReconciliationInput(bridge, {
          inventoryOpenQtyBySymbol: input.inventoryOpenQtyBySymbol,
        }),
      );
      bridge.lastFullReconcileFillCount = fillCount;
      bridge.lastFullReconcileCash = bridge.state.cash;
      recordRuntimeCall(bridge, "WP19_RECONCILIATION_PASS", {
        cycleIndex: input.cycleIndex,
        detail: input.phase,
      });
    }
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
  // Hot path: read drawdown fields without spreading the full accounting state.
  const accountPeakHwm = bridge.state.equityHwm;
  const monthlyPeakHwm = bridge.state.monthlyPeakHwm ?? bridge.state.equityHwm;
  const strategyDrawdownBpsByKey = bridge.state.strategyDrawdownBpsByKey;
  let dominantStrategy: ReturnType<typeof resolveDominantStrategyDrawdown> = {};
  if (strategyDrawdownBpsByKey) {
    for (const _key in strategyDrawdownBpsByKey) {
      dominantStrategy = resolveDominantStrategyDrawdown({
        strategyDrawdownBpsByKey,
        strategyPeakHwmByKey: bridge.state.strategyPeakHwmByKey ?? EMPTY_STRATEGY_PEAKS,
      });
      break;
    }
  }
  const cycle = evaluateHtrGuardianCycle({
    accountPeakHwm,
    monthlyPeakHwm,
    equityUsdt: input.equityUsdt,
    strategyDrawdownBps: dominantStrategy.strategyDrawdownBps,
    strategyEquityUsdt: dominantStrategy.strategyEquityUsdt,
    strategyPeakHwm: dominantStrategy.strategyPeakHwm,
    missingMark: input.missingMark,
    // before_guardian phase already asserted; avoid duplicate full reconcile + input assembly.
    skipReconciliationAssert: true,
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

export function recordBreachCancellationOnBridge(
  bridge: HtrAccountingCycleBridge,
  result: BreachCancellationResultV1,
  cycleIndex: number,
): void {
  assertBridgeActive(bridge);
  bridge.lastBreachCancellation = result;
  bridge.breachCancellationFailed = result.breachCancellationFailed;
  recordRuntimeCall(bridge, "WP20_BREACH_CANCELLATION_EXECUTED", {
    cycleIndex,
    detail: result.breachCancellationFailed
      ? `failed:${result.failedOrderIds.join(",")}`
      : `cancelled:${result.cancelledOrderIds.join(",")}`,
  });
}

export function getHtrGuardianCycleForCancellation(
  bridge: HtrAccountingCycleBridge,
): HtrGuardianCycleResult | null {
  return bridge.lastGuardianCycle;
}

export function derivePortfolioFromAccountingState(input: {
  state: AccountingStateV1;
  runConfig: PortfolioRunConfig;
  limits: PortfolioSizingLimits;
  stopDistanceProvider: StopDistanceProvider;
  /** Optional cycle marks (portfolio path) when accounting marks are not yet attached. */
  markPrices?: Readonly<Record<string, string>>;
}): PortfolioAccountState {
  const positions = Object.entries(input.state.positions)
    .filter(([, position]) => compareDecimal(position.quantity, "0") > 0)
    .map(([symbol, position]) => {
      const portfolioSymbol = accountingSymbolToPortfolioSymbol(symbol);
      const mark = input.state.marks[symbol];
      const markPrice =
        input.markPrices?.[portfolioSymbol] ?? input.markPrices?.[symbol] ?? mark?.price ?? "0";
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
    monthlyPeakHwm: normalizeAccountingStateDrawdownFields(bridge.state).monthlyPeakHwm,
  });
}

export function toAccountingCheckpointSlice(
  bridge: HtrAccountingCycleBridge,
): ReplayAccountingFrontierState {
  const drawdownState = normalizeAccountingStateDrawdownFields(bridge.state);
  return {
    accountingSequence: drawdownState.accountingSequence,
    frontierAsOf: drawdownState.frontierAsOf,
    cash: drawdownState.cash,
    equity: drawdownState.equity,
    equityHwm: drawdownState.equityHwm,
    monthlyPeakHwm: drawdownState.monthlyPeakHwm,
    monthKey: drawdownState.monthKey,
    accountDrawdownBps: drawdownState.accountDrawdownBps,
    monthlyDrawdownBps: drawdownState.monthlyDrawdownBps,
    strategyPeakHwmByKey: { ...drawdownState.strategyPeakHwmByKey },
    strategyDrawdownBpsByKey: { ...drawdownState.strategyDrawdownBpsByKey },
    marksJson: bridge.state.marks,
    positionsJson: bridge.state.positions,
    consumedFillIds: [...bridge.state.consumedFillIds],
    cashEventsJson: [...bridge.cashEvents],
    cashLedgerBaseUsdt: bridge.cashLedgerBaseUsdt,
    grossRealizedPnl: bridge.state.grossRealizedPnl,
    netRealizedPnl: bridge.state.netRealizedPnl,
    semanticContentDigest: computeAccountingSemanticDigest(bridge.state),
  };
}

export function toDrawdownHwmCheckpointSlice(
  bridge: HtrAccountingCycleBridge,
): ReplayDrawdownHwmState {
  const drawdownState = normalizeAccountingStateDrawdownFields(bridge.state);
  return {
    accountPeakHwm: drawdownState.equityHwm,
    monthlyPeakHwm: drawdownState.monthlyPeakHwm,
    monthKey: drawdownState.monthKey,
    breachState: bridge.breachState,
    strategyPeaks: { ...drawdownState.strategyPeakHwmByKey },
    strategyDrawdownBpsByKey: { ...drawdownState.strategyDrawdownBpsByKey },
    monthlyDrawdownBps: drawdownState.monthlyDrawdownBps,
    accountDrawdownBps: drawdownState.accountDrawdownBps,
  };
}

export type DrawdownCheckpointPersistenceContext = {
  portfolioId: string;
  nextAccountSeq: number;
  nextStrategySeqByKey: Record<string, number>;
  accountCheckpointId: string;
  strategyCheckpointIdFactory: (attrKey: string) => string;
  appendAccount: (input: AppendAccountDrawdownCheckpointInput) => Promise<void>;
  appendStrategy: (input: AppendStrategyDrawdownCheckpointInput) => Promise<void>;
};

export async function persistDrawdownCheckpointsFromBridge(
  bridge: HtrAccountingCycleBridge,
  context: DrawdownCheckpointPersistenceContext,
): Promise<void> {
  await context.appendAccount(
    buildAccountDrawdownCheckpointFromBridgeState({
      state: bridge.state,
      portfolioId: context.portfolioId,
      seq: context.nextAccountSeq,
      id: context.accountCheckpointId,
      breachState: bridge.breachState,
    }),
  );
  const strategyCheckpoints = buildStrategyDrawdownCheckpointsFromBridgeState({
    state: bridge.state,
    portfolioId: context.portfolioId,
    seqByKey: context.nextStrategySeqByKey,
    idFactory: context.strategyCheckpointIdFactory,
    breachState: bridge.breachState,
  });
  for (const checkpoint of strategyCheckpoints) {
    await context.appendStrategy(checkpoint);
  }
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
    monthlyPeakHwm: slice.monthlyPeakHwm,
    monthKey: slice.monthKey,
    accountDrawdownBps: slice.accountDrawdownBps,
    monthlyDrawdownBps: slice.monthlyDrawdownBps,
    strategyPeakHwmByKey: { ...slice.strategyPeakHwmByKey },
    strategyDrawdownBpsByKey: { ...slice.strategyDrawdownBpsByKey },
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
  bridge.lastMarkBySymbol = { ...slice.marksJson };
  bridge.cashEvents = [...slice.cashEventsJson];
  bridge.cashLedgerBaseUsdt = slice.cashLedgerBaseUsdt ?? bridge.startingCashUsdt;
  bridge.epochConsumedFillIds = slice.cashEventsJson.map((event) => event.fillId);
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
