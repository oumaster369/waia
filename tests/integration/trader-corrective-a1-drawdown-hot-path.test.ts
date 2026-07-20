import { describe, expect, it } from "vitest";

import {
  compareReplayResumeIdentity,
  ReplayCheckpointError,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  attachClosed1mMarkToAccountingBridge,
  consumeWp17FillIntoAccountingBridge,
  createDrawdownPersistenceSession,
  createHtrAccountingCycleBridge,
  persistDrawdownCycleAfterGuardian,
  restoreAccountingBridgeFromCheckpoint,
  toAccountingCheckpointSlice,
  toDrawdownHwmCheckpointSlice,
  type HtrDrawdownPersistencePort,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import { normalizeAccountingStateDrawdownFields } from "@/lib/trader/accounting/accounting-frontier.types";
import {
  advanceAccountingFrontier,
  computeAccountingSemanticDigest,
} from "@/lib/trader/accounting";
import { buildAccountDrawdownCheckpointFromBridgeState } from "@/lib/trader/risk/account-drawdown-repository-postgres";
import { buildStrategyDrawdownCheckpointsFromBridgeState } from "@/lib/trader/risk/strategy-drawdown-repository-postgres";
import { buildStrategyAttributionKey } from "@/lib/trader/risk/strategy-attribution";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
} from "@/lib/trader/intelligence/types";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import {
  BTC_MARK,
  ETH_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";
import { makeWp17Bar } from "@/tests/unit/helpers/wp17-execution-fixtures";

const ORG_ID = "00000000-0000-4000-8000-0000000415a2";
const ACCOUNT_KEY = "corrective-a1-hot-path";
const RUN_ID = "corrective-a1-hot-run";
const PORTFOLIO_ID = "corrective-a1-hot-portfolio";

const LSR_KEY = buildStrategyAttributionKey(
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
);
const MR_KEY = buildStrategyAttributionKey(MEAN_REVERSION_V0, MEAN_REVERSION_V0_VERSION);

function appendDrawdownCheckpointsFromBridge(
  bridge: ReturnType<typeof createHtrAccountingCycleBridge>,
) {
  const seq = bridge.state.accountingSequence;
  const account = buildAccountDrawdownCheckpointFromBridgeState({
    state: bridge.state,
    portfolioId: PORTFOLIO_ID,
    seq,
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    breachState: bridge.breachState,
  });
  const strategies = buildStrategyDrawdownCheckpointsFromBridgeState({
    state: bridge.state,
    portfolioId: PORTFOLIO_ID,
    seqByKey: { [LSR_KEY]: seq, [MR_KEY]: seq },
    idFactory: (key) =>
      key === LSR_KEY
        ? `00000000-0000-4000-8000-${String(seq + 100).padStart(12, "0")}`
        : `00000000-0000-4000-8000-${String(seq + 200).padStart(12, "0")}`,
    breachState: bridge.breachState,
  });
  return { account, strategies };
}

describe("DEE-415 C-A1 drawdown hot-path integration (G1)", () => {
  it("month-boundary replay resets monthly HWM while account HWM persists", () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
      frontierAsOf: "2026-01-31T23:00:00.000Z",
    });

    consumeWp17FillIntoAccountingBridge(bridge, {
      cycleIndex: 1,
      fill: makeAccountingEconomicsFill("buy", {
        fillTimestamp: new Date("2026-01-31T23:01:59.999Z"),
      }),
    });
    attachClosed1mMarkToAccountingBridge(
      bridge,
      makeWp17Bar(1, {
        barCloseTime: "2026-01-31T23:01:59.999Z",
        close: "50000",
      }),
      1,
    );
    const janAccountHwm = bridge.state.equityHwm;
    const janMonthlyHwm = bridge.state.monthlyPeakHwm;
    expect(bridge.state.monthKey).toBe("2026-01");

    attachClosed1mMarkToAccountingBridge(
      bridge,
      makeWp17Bar(2, {
        symbol: "BTCUSDT",
        barCloseTime: "2026-02-01T00:01:59.999Z",
        close: "45000",
      }),
      2,
    );
    expect(bridge.state.monthKey).toBe("2026-02");
    expect(compareDecimal(bridge.state.equityHwm, janAccountHwm)).toBeGreaterThanOrEqual(0);
    expect(
      compareDecimal(
        normalizeAccountingStateDrawdownFields(bridge.state).monthlyPeakHwm,
        bridge.state.equity,
      ),
    ).toBe(0);
    expect(bridge.state.monthlyPeakHwm).not.toBe(janMonthlyHwm);
  });

  it("shared BTC/ETH portfolio tracks one account equity and per-strategy peaks", () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });

    consumeWp17FillIntoAccountingBridge(bridge, {
      cycleIndex: 1,
      fill: makeAccountingEconomicsFill("buy", {
        fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
      }),
    });
    attachClosed1mMarkToAccountingBridge(
      bridge,
      makeWp17Bar(2, {
        symbol: "BTCUSDT",
        barCloseTime: "2026-01-01T00:01:59.999Z",
        close: "50000",
      }),
      2,
    );
    consumeWp17FillIntoAccountingBridge(bridge, {
      cycleIndex: 3,
      fill: makeAccountingEconomicsFill("buy", {
        symbol: "ETHUSDT",
        grossFillPrice: "3000",
        sliceQuantity: "1.00000000",
        fillTimestamp: new Date("2026-01-01T00:02:59.999Z"),
      }),
    });
    bridge.state = advanceAccountingFrontier({
      state: bridge.state,
      marks: { BTCUSDT: BTC_MARK, ETHUSDT: ETH_MARK },
      frontierAsOf: "2026-01-01T00:02:59.999Z",
    });

    expect(Object.keys(bridge.state.positions)).toEqual(
      expect.arrayContaining(["BTCUSDT", "ETHUSDT"]),
    );
    expect(compareDecimal(bridge.state.equity, bridge.state.cash)).toBe(1);
    const drawdownState = normalizeAccountingStateDrawdownFields(bridge.state);
    expect(drawdownState.strategyPeakHwmByKey[LSR_KEY]).toBeDefined();
    expect(drawdownState.strategyPeakHwmByKey[MR_KEY]).toBeDefined();
  });

  it("fees and unrealized PnL are counted once in mark-to-market drawdown", () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    const buy = makeAccountingEconomicsFill("buy", {
      fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
    });
    consumeWp17FillIntoAccountingBridge(bridge, { cycleIndex: 1, fill: buy });
    attachClosed1mMarkToAccountingBridge(
      bridge,
      makeWp17Bar(1, {
        barCloseTime: "2026-01-01T00:01:59.999Z",
        close: "50000",
      }),
      1,
    );

    const feeIncludedEquity = bridge.state.equity;
    const markedValue = bridge.state.markedPositionValue;
    expect(compareDecimal(feeIncludedEquity, bridge.state.cash)).toBe(1);
    expect(compareDecimal(markedValue, "0")).toBe(1);
    expect(bridge.state.accountDrawdownBps).toBe(0);

    attachClosed1mMarkToAccountingBridge(
      bridge,
      makeWp17Bar(2, {
        barCloseTime: "2026-01-01T00:02:59.999Z",
        close: "40000",
      }),
      2,
    );
    expect(bridge.state.accountDrawdownBps).toBeGreaterThan(0);
    expect(compareDecimal(bridge.state.equity, bridge.state.cash)).toBe(1);
  });

  it("append ordering persists account checkpoint before strategy checkpoints at same seq", async () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    consumeWp17FillIntoAccountingBridge(bridge, {
      cycleIndex: 1,
      fill: makeAccountingEconomicsFill("buy"),
    });
    attachClosed1mMarkToAccountingBridge(bridge, makeWp17Bar(1), 1);

    const appended: string[] = [];
    const port: HtrDrawdownPersistencePort = {
      portfolioId: PORTFOLIO_ID,
      resumeMode: "fresh",
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
      loadAccountCheckpoint: async () => null,
      loadStrategyCheckpoint: async () => null,
      appendAccountCheckpoint: async () => {
        appended.push("account");
      },
      appendStrategyCheckpoint: async (row) => {
        appended.push(`strategy:${row.strategyId}`);
      },
      newCheckpointId: ({ kind, seq }) =>
        `00000000-0000-4000-8000-${kind}${String(seq).padStart(11, "0")}`,
    };
    const session = createDrawdownPersistenceSession();
    await persistDrawdownCycleAfterGuardian(bridge, port, session, 1);

    expect(appended[0]).toBe("account");
    expect(appended.slice(1).every((entry) => entry.startsWith("strategy:"))).toBe(true);
  });

  it("resume from checkpoint identity rejects mismatched run metadata fail-closed", () => {
    const bridge = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    consumeWp17FillIntoAccountingBridge(bridge, {
      cycleIndex: 1,
      fill: makeAccountingEconomicsFill("buy"),
    });
    attachClosed1mMarkToAccountingBridge(bridge, makeWp17Bar(1), 1);

    const slice = toAccountingCheckpointSlice(bridge);
    const drawdownSlice = toDrawdownHwmCheckpointSlice(bridge);
    const restarted = createHtrAccountingCycleBridge({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    restoreAccountingBridgeFromCheckpoint(restarted, slice);

    expect(restarted.state.equityHwm).toBe(drawdownSlice.accountPeakHwm);
    expect(restarted.state.monthlyPeakHwm).toBe(drawdownSlice.monthlyPeakHwm);
    expect(restarted.state.monthKey).toBe(drawdownSlice.monthKey);
    expect(computeAccountingSemanticDigest(restarted.state)).toBe(slice.semanticContentDigest);

    expect(() =>
      compareReplayResumeIdentity(
        { backtestRunId: RUN_ID, datasetContentDigest: "digest-a", codeSha: "sha-a" },
        { backtestRunId: "other-run", datasetContentDigest: "digest-a", codeSha: "sha-a" },
      ),
    ).toThrow(ReplayCheckpointError);
  });
});
