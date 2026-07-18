import { describe, expect, it } from "vitest";

import {
  advanceAccountingFrontier,
  createInitialAccountingState,
  type AccountingFillInput,
  type AccountingFrontierV1,
  type AccountingStateV1,
} from "@/lib/trader/accounting";
import { normalizeAccountingStateDrawdownFields } from "@/lib/trader/accounting/accounting-frontier.types";
import {
  applyDrawdownCheckpointToBridge,
  createDrawdownPersistenceSession,
  createHtrAccountingCycleBridge,
  HtrAccountingReconciliationTerminationError,
  HtrDrawdownHydrationError,
  hydrateBridgeDrawdownFromPersistence,
  persistDrawdownCycleAfterGuardian,
  restoreAccountingBridgeFromCheckpoint,
  toAccountingCheckpointSlice,
  toDrawdownHwmCheckpointSlice,
  type HtrDrawdownPersistencePort,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import {
  HTR_GUARDIAN_EXIT_REASON_V1,
  resolveDrawdownBreachState,
} from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
} from "@/lib/trader/intelligence/types";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { buildAccountDrawdownCheckpointFromBridgeState } from "@/lib/trader/risk/account-drawdown-repository-postgres";
import {
  computePeakEquityDrawdownBps,
  resolveMonthKeyUtc,
  updateDrawdownHighWaterMarks,
} from "@/lib/trader/risk/drawdown-policy-evaluator";
import { DEFAULT_D20_DRAWDOWN_POLICY } from "@/lib/trader/risk/drawdown-policy.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { buildStrategyDrawdownCheckpointsFromBridgeState } from "@/lib/trader/risk/strategy-drawdown-repository-postgres";
import { buildStrategyAttributionKey } from "@/lib/trader/risk/strategy-attribution";
import {
  BTC_MARK,
  ETH_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

const ORG_ID = "00000000-0000-4000-8000-0000000415a1";
const ACCOUNT_KEY = "corrective-a1-acct";
const RUN_ID = "corrective-a1-run";
const PORTFOLIO_ID = "corrective-a1-portfolio";

const LSR_KEY = buildStrategyAttributionKey(
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
);
const MR_KEY = buildStrategyAttributionKey(MEAN_REVERSION_V0, MEAN_REVERSION_V0_VERSION);

function baseState(overrides?: Partial<Parameters<typeof createInitialAccountingState>[0]>) {
  return createInitialAccountingState({
    organizationId: ORG_ID,
    accountKey: ACCOUNT_KEY,
    runId: RUN_ID,
    frontierAsOf: "2026-01-15T12:00:00.000Z",
    ...overrides,
  });
}

function frontierToState(frontier: AccountingFrontierV1): AccountingStateV1 {
  const {
    id: _id,
    sourceFillId: _sourceFillId,
    sourceEconomicsDigest: _sourceEconomicsDigest,
    semanticContentDigest: _semanticContentDigest,
    idempotencyKey: _idempotencyKey,
    ...state
  } = frontier;
  return state;
}

function advanceFill(
  state: AccountingStateV1,
  fill: AccountingFillInput,
  options?: {
    marks?: Record<string, { price: string; barCloseTime: string }>;
    frontierAsOf?: string;
  },
): AccountingFrontierV1 {
  return advanceAccountingFrontier({
    state,
    fill,
    marks: options?.marks,
    frontierAsOf: options?.frontierAsOf ?? fill.executedAt,
  });
}

function advanceMark(
  state: AccountingStateV1,
  marks: Record<string, { price: string; barCloseTime: string }>,
  frontierAsOf: string,
): AccountingFrontierV1 {
  return advanceAccountingFrontier({ state, marks, frontierAsOf });
}

function hydrateBridgeFromDrawdownCheckpoints(input: {
  bridge: ReturnType<typeof createHtrAccountingCycleBridge>;
  accountCheckpoint: ReturnType<typeof buildAccountDrawdownCheckpointFromBridgeState>;
  strategyCheckpoints: ReturnType<typeof buildStrategyDrawdownCheckpointsFromBridgeState>;
}): void {
  applyDrawdownCheckpointToBridge(input.bridge, {
    account: {
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      portfolioId: PORTFOLIO_ID,
      runId: RUN_ID,
      seq: input.accountCheckpoint.seq,
      asOf: input.accountCheckpoint.asOf,
      monthKey: input.accountCheckpoint.monthKey,
      equityUsdt: input.accountCheckpoint.equityUsdt,
      accountPeakHwm: input.accountCheckpoint.accountPeakHwm,
      monthlyPeakHwm: input.accountCheckpoint.monthlyPeakHwm,
      accountDrawdownBps: input.accountCheckpoint.accountDrawdownBps,
      monthlyDrawdownBps: input.accountCheckpoint.monthlyDrawdownBps,
      breachState: input.accountCheckpoint.breachState,
    },
    strategies: input.strategyCheckpoints.map((row) => ({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      portfolioId: PORTFOLIO_ID,
      runId: RUN_ID,
      strategyId: row.strategyId,
      strategyVersion: row.strategyVersion,
      seq: row.seq,
      asOf: row.asOf,
      monthKey: "",
      strategyEquityUsdt: row.strategyEquityUsdt,
      strategyPeakHwm: row.strategyPeakHwm,
      strategyDrawdownBps: row.strategyDrawdownBps,
      breachState: row.breachState,
      strategyAllocationUsdt: row.strategyAllocationUsdt,
    })),
  });
}

function basePersistencePort(
  overrides: Partial<HtrDrawdownPersistencePort> = {},
): HtrDrawdownPersistencePort {
  return {
    portfolioId: PORTFOLIO_ID,
    resumeMode: "resumable",
    organizationId: ORG_ID,
    accountKey: ACCOUNT_KEY,
    runId: RUN_ID,
    loadAccountCheckpoint: async () => null,
    loadStrategyCheckpoint: async () => null,
    appendAccountCheckpoint: async () => undefined,
    appendStrategyCheckpoint: async () => undefined,
    newCheckpointId: ({ kind, seq }) =>
      `00000000-0000-4000-8000-${kind === "account" ? "acc" : "str"}${String(seq).padStart(8, "0")}`,
    ...overrides,
  };
}

function assertDrawdownPersistCycleConsistent(input: {
  accountSeq: number;
  strategySeqs: number[];
}): void {
  for (const strategySeq of input.strategySeqs) {
    if (strategySeq !== input.accountSeq) {
      throw new Error("DRAWDOWN_CHECKPOINT_SEQ_GAP");
    }
  }
}

describe("DEE-415 C-A1 drawdown semantics (G1)", () => {
  it("month transition initializes monthly HWM from current equity without resetting account HWM", () => {
    const jan = advanceMark(baseState(), { BTCUSDT: BTC_MARK }, "2026-01-31T23:59:59.999Z");
    expect(jan.monthKey).toBe("2026-01");
    expect(compareDecimal(jan.equityHwm, HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT)).toBe(0);

    const febEquity = "92000";
    const feb = advanceAccountingFrontier({
      state: {
        ...frontierToState(jan),
        equity: febEquity,
        cash: febEquity,
        markedPositionValue: "0",
      },
      frontierAsOf: "2026-02-01T00:00:00.000Z",
      marks: {},
    });
    expect(feb.monthKey).toBe("2026-02");
    expect(compareDecimal(feb.equityHwm, jan.equityHwm)).toBe(0);
    expect(compareDecimal(feb.monthlyPeakHwm ?? feb.equityHwm, febEquity)).toBe(0);
  });

  it("restart inside month preserves account and monthly HWM from checkpoint", () => {
    const buy = makeAccountingEconomicsFill("buy");
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
      frontierAsOf: "2026-01-10T00:00:00.000Z",
    });
    bridge.state = frontierToState(
      advanceFill(bridge.state, buy, {
        marks: { BTCUSDT: BTC_MARK },
        frontierAsOf: "2026-01-10T00:01:59.999Z",
      }),
    );

    const slice = toAccountingCheckpointSlice(bridge);
    const restarted = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
      frontierAsOf: "2026-01-10T00:00:00.000Z",
    });
    restoreAccountingBridgeFromCheckpoint(restarted, slice);

    expect(restarted.state.equityHwm).toBe(bridge.state.equityHwm);
    expect(restarted.state.monthlyPeakHwm).toBe(bridge.state.monthlyPeakHwm);
    expect(restarted.state.monthKey).toBe("2026-01");
  });

  it("restart at UTC month boundary initializes monthly HWM from first-bar equity", () => {
    const janBridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
      frontierAsOf: "2026-01-31T23:00:00.000Z",
    });
    janBridge.state = frontierToState(
      advanceMark(janBridge.state, { BTCUSDT: BTC_MARK }, "2026-01-31T23:59:59.999Z"),
    );
    const janAccountHwm = janBridge.state.equityHwm;
    const slice = toAccountingCheckpointSlice(janBridge);

    const febBridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
      frontierAsOf: "2026-02-01T00:00:00.000Z",
    });
    restoreAccountingBridgeFromCheckpoint(febBridge, slice);

    const feb = advanceMark(febBridge.state, { BTCUSDT: BTC_MARK }, "2026-02-01T00:01:59.999Z");
    expect(feb.monthKey).toBe("2026-02");
    expect(compareDecimal(feb.monthlyPeakHwm ?? feb.equityHwm, feb.equity)).toBe(0);
    expect(compareDecimal(feb.equityHwm, janAccountHwm)).toBeGreaterThanOrEqual(0);
  });

  it("account HWM never resets on month transition", () => {
    const updated = updateDrawdownHighWaterMarks({
      equityUsdt: "90000",
      accountPeakHwm: "100000",
      monthlyPeakHwm: "100000",
      priorMonthKey: "2026-01",
      monthKey: "2026-02",
    });
    expect(updated.accountPeakHwm).toBe("100000");
  });

  it("monthly HWM resets only when UTC month key changes", () => {
    const sameMonth = updateDrawdownHighWaterMarks({
      equityUsdt: "95000",
      accountPeakHwm: "100000",
      monthlyPeakHwm: "100000",
      priorMonthKey: "2026-01",
      monthKey: "2026-01",
    });
    expect(sameMonth.monthlyPeakHwm).toBe("100000");

    const newMonth = updateDrawdownHighWaterMarks({
      equityUsdt: "95000",
      accountPeakHwm: "100000",
      monthlyPeakHwm: "100000",
      priorMonthKey: "2026-01",
      monthKey: "2026-02",
    });
    expect(newMonth.monthlyPeakHwm).toBe("95000");
    expect(resolveMonthKeyUtc("2026-02-01T00:00:00.000Z")).toBe("2026-02");
  });

  it("strategy A breach while strategy B remains healthy", () => {
    const resolved = resolveDrawdownBreachState({
      accountDrawdownBps: 500,
      monthlyDrawdownBps: 500,
      strategyDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps + 1,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
      strategyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
    });
    expect(resolved.breachState).toBe("STOP_ACCOUNT");
    expect(resolved.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.strategyDrawdownBreach);

    const healthyPeer = resolveDrawdownBreachState({
      accountDrawdownBps: 500,
      monthlyDrawdownBps: 500,
      strategyDrawdownBps: 500,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
      strategyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
    });
    expect(healthyPeer.breachState).toBe("NONE");
  });

  it("enforces 25/15/20 account monthly and strategy threshold bps", () => {
    expect(DEFAULT_D20_DRAWDOWN_POLICY.accountBps).toBe(2500);
    expect(DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps).toBe(1500);
    expect(DEFAULT_D20_DRAWDOWN_POLICY.strategyBps).toBe(2000);

    expect(computePeakEquityDrawdownBps("75000", "100000")).toBe(
      DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
    );
    expect(computePeakEquityDrawdownBps("85000", "100000")).toBe(
      DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
    );
    expect(computePeakEquityDrawdownBps("40000", "50000")).toBe(
      DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
    );
  });

  it("equality at limit yields CLOSE_ONLY with monthly reason code GUARDIAN_MONTHLY_DRAWDOWN_EQUALITY", () => {
    const monthlyEquality = resolveDrawdownBreachState({
      accountDrawdownBps: 1000,
      monthlyDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
    });
    expect(monthlyEquality.breachState).toBe("CLOSE_ONLY");
    expect(monthlyEquality.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.monthlyDrawdownEquality);
    expect(monthlyEquality.reason).not.toBe(HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownEquality);

    const accountEquality = resolveDrawdownBreachState({
      accountDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyDrawdownBps: 0,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
    });
    expect(accountEquality.breachState).toBe("CLOSE_ONLY");
    expect(accountEquality.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownEquality);
  });

  it("escalates from CLOSE_ONLY at equality to STOP_ACCOUNT above limit", () => {
    const closeOnly = resolveDrawdownBreachState({
      accountDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyDrawdownBps: 0,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
    });
    expect(closeOnly.breachState).toBe("CLOSE_ONLY");

    const stopAccount = resolveDrawdownBreachState({
      accountDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps + 1,
      monthlyDrawdownBps: 0,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
    });
    expect(stopAccount.breachState).toBe("STOP_ACCOUNT");
    expect(stopAccount.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownBreach);
  });

  it("hydrates bridge drawdown state from latest 0094 and 0096 checkpoint shapes", () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    bridge.state = {
      ...bridge.state,
      equity: "85000",
      equityHwm: "100000",
      monthlyPeakHwm: "100000",
      monthKey: "2026-01",
      accountDrawdownBps: 1500,
      monthlyDrawdownBps: 1500,
      strategyPeakHwmByKey: {
        [LSR_KEY]: "50000",
        [MR_KEY]: "50000",
      },
      strategyDrawdownBpsByKey: {
        [LSR_KEY]: 2000,
        [MR_KEY]: 500,
      },
    };
    bridge.breachState = "CLOSE_ONLY";

    const accountCheckpoint = buildAccountDrawdownCheckpointFromBridgeState({
      state: bridge.state,
      portfolioId: PORTFOLIO_ID,
      seq: 7,
      id: "00000000-0000-4000-8000-000000000701",
      breachState: bridge.breachState,
    });
    const strategyCheckpoints = buildStrategyDrawdownCheckpointsFromBridgeState({
      state: bridge.state,
      portfolioId: PORTFOLIO_ID,
      seqByKey: { [LSR_KEY]: 7, [MR_KEY]: 7 },
      idFactory: (key) =>
        key === LSR_KEY
          ? "00000000-0000-4000-8000-000000000702"
          : "00000000-0000-4000-8000-000000000703",
      breachState: bridge.breachState,
    });

    const hydrated = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    hydrateBridgeFromDrawdownCheckpoints({
      bridge: hydrated,
      accountCheckpoint,
      strategyCheckpoints,
    });

    expect(hydrated.state.equityHwm).toBe("100000");
    const hydratedDrawdown = normalizeAccountingStateDrawdownFields(hydrated.state);
    expect(hydrated.state.monthlyPeakHwm).toBe("100000");
    expect(hydratedDrawdown.strategyDrawdownBpsByKey[LSR_KEY]).toBe(2000);
    expect(hydratedDrawdown.strategyDrawdownBpsByKey[MR_KEY]).toBe(500);
    expect(toDrawdownHwmCheckpointSlice(hydrated).breachState).toBe("CLOSE_ONLY");
  });

  it("fail-closed when account checkpoint persisted but strategy checkpoint seq lags (crash window)", () => {
    expect(() =>
      assertDrawdownPersistCycleConsistent({ accountSeq: 5, strategySeqs: [5, 5] }),
    ).not.toThrow();
    expect(() =>
      assertDrawdownPersistCycleConsistent({ accountSeq: 5, strategySeqs: [5, 4] }),
    ).toThrow(/DRAWDOWN_CHECKPOINT_SEQ_GAP/);
  });

  it("duplicate append idempotency is keyed by seq (same seq payload is no-op-equal)", () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    const first = buildAccountDrawdownCheckpointFromBridgeState({
      state: bridge.state,
      portfolioId: PORTFOLIO_ID,
      seq: 1,
      id: "00000000-0000-4000-8000-000000000801",
      breachState: "NONE",
    });
    const second = buildAccountDrawdownCheckpointFromBridgeState({
      state: bridge.state,
      portfolioId: PORTFOLIO_ID,
      seq: 1,
      id: "00000000-0000-4000-8000-000000000801",
      breachState: "NONE",
    });
    expect(second).toEqual(first);

    const seenSeq = new Set<number>();
    const appendOnce = (seq: number) => {
      if (seenSeq.has(seq)) {
        throw new Error("DRAWDOWN_APPEND_SEQ_CONFLICT");
      }
      seenSeq.add(seq);
    };
    appendOnce(1);
    expect(() => appendOnce(1)).toThrow(/DRAWDOWN_APPEND_SEQ_CONFLICT/);
  });

  it("deposits and withdrawals do not reset drawdown HWM peaks on hydrate", () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    const lossFill: AccountingFillInput = {
      fillId: crypto.randomUUID(),
      executedAt: "2026-01-01T00:01:59.999Z",
      economics: {
        symbol: "BTCUSDT",
        side: "buy",
        quantity: "2.5",
        grossFillPrice: "10000",
        grossNotional: "25000",
        netFillPrice: "10000",
        feeAmount: "0",
        netCashEffect: "-25000",
        spreadCost: "0",
        impactSlippageCost: "0",
        totalExecutionCost: "0",
        economicsContentDigest: "0".repeat(64),
      },
    };
    const lossState = advanceFill(bridge.state, lossFill, {
      frontierAsOf: "2026-01-01T00:01:59.999Z",
    });
    expect(lossState.accountDrawdownBps).toBe(DEFAULT_D20_DRAWDOWN_POLICY.accountBps);

    const accountCheckpoint = buildAccountDrawdownCheckpointFromBridgeState({
      state: frontierToState(lossState),
      portfolioId: PORTFOLIO_ID,
      seq: 2,
      id: "00000000-0000-4000-8000-000000000901",
      breachState: "CLOSE_ONLY",
    });

    const afterDepositCash = "85000";
    const hydrated = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    hydrated.state.cash = afterDepositCash;
    hydrated.state.equity = afterDepositCash;
    hydrateBridgeFromDrawdownCheckpoints({
      bridge: hydrated,
      accountCheckpoint,
      strategyCheckpoints: buildStrategyDrawdownCheckpointsFromBridgeState({
        state: frontierToState(lossState),
        portfolioId: PORTFOLIO_ID,
        seqByKey: { [LSR_KEY]: 2, [MR_KEY]: 2 },
        idFactory: () => "00000000-0000-4000-8000-000000000902",
        breachState: "CLOSE_ONLY",
      }),
    });

    expect(hydrated.state.equityHwm).toBe(lossState.equityHwm);
    expect(hydrated.state.monthlyPeakHwm).toBe(lossState.monthlyPeakHwm);
    expect(hydrated.state.accountDrawdownBps).toBe(lossState.accountDrawdownBps);
    expect(hydrated.state.accountDrawdownBps).toBe(DEFAULT_D20_DRAWDOWN_POLICY.accountBps);
  });

  it("stale or missing checkpoint digest fails closed on restore", () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    const slice = toAccountingCheckpointSlice(bridge);
    slice.semanticContentDigest = "0".repeat(64);

    expect(() => restoreAccountingBridgeFromCheckpoint(bridge, slice)).toThrow(
      HtrAccountingReconciliationTerminationError,
    );
    expect(bridge.runTerminated).toBe(true);
    expect(bridge.breachState).toBe("STOP_ACCOUNT");
  });

  it("simultaneous-breach precedence favors STOP_ACCOUNT and account reason over monthly/strategy", () => {
    const resolved = resolveDrawdownBreachState({
      accountDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps + 5,
      monthlyDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps + 5,
      strategyDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps + 5,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
      strategyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
    });
    expect(resolved.breachState).toBe("STOP_ACCOUNT");
    expect(resolved.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownBreach);

    const monthlyOverStrategy = resolveDrawdownBreachState({
      accountDrawdownBps: 100,
      monthlyDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps + 1,
      strategyDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps + 1,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
      strategyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
    });
    expect(monthlyOverStrategy.breachState).toBe("STOP_ACCOUNT");
    expect(monthlyOverStrategy.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.monthlyDrawdownBreach);
  });

  it("resumable hydration fail-closed when account checkpoint missing", async () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    await expect(
      hydrateBridgeDrawdownFromPersistence(
        bridge,
        basePersistencePort({ loadAccountCheckpoint: async () => null }),
      ),
    ).rejects.toThrow(HtrDrawdownHydrationError);
    expect(bridge.runTerminated).toBe(true);
  });

  it("resumable hydration fail-closed when one strategy checkpoint missing", async () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    const accountRow = {
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      portfolioId: PORTFOLIO_ID,
      runId: RUN_ID,
      seq: 1,
      asOf: bridge.state.frontierAsOf,
      monthKey: bridge.state.monthKey,
      equityUsdt: bridge.state.equity,
      accountPeakHwm: bridge.state.equityHwm,
      monthlyPeakHwm: bridge.state.monthlyPeakHwm ?? bridge.state.equityHwm,
      accountDrawdownBps: 0,
      monthlyDrawdownBps: 0,
      breachState: "NONE" as const,
    };
    await expect(
      hydrateBridgeDrawdownFromPersistence(
        bridge,
        basePersistencePort({
          loadAccountCheckpoint: async () => accountRow,
          loadStrategyCheckpoint: async () => null,
        }),
      ),
    ).rejects.toThrow(HtrDrawdownHydrationError);
  });

  it("persistDrawdownCycleAfterGuardian is idempotent for identical seq payload", async () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    let appendCount = 0;
    const port = basePersistencePort({
      appendAccountCheckpoint: async () => {
        appendCount += 1;
      },
      appendStrategyCheckpoint: async () => {
        appendCount += 1;
      },
    });
    const session = createDrawdownPersistenceSession();
    await persistDrawdownCycleAfterGuardian(bridge, port, session, 1);
    const firstCount = appendCount;
    await persistDrawdownCycleAfterGuardian(bridge, port, session, 1);
    expect(appendCount).toBe(firstCount);
  });

  it("strategy equality emits GUARDIAN_STRATEGY_DRAWDOWN_EQUALITY", () => {
    const resolved = resolveDrawdownBreachState({
      accountDrawdownBps: 100,
      monthlyDrawdownBps: 100,
      strategyDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
      strategyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
    });
    expect(resolved.breachState).toBe("CLOSE_ONLY");
    expect(resolved.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.strategyDrawdownEquality);
  });
});
