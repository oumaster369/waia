import { afterEach, describe, expect, it, vi } from "vitest";

const { runPaperCycleOnceMock } = vi.hoisted(() => ({ runPaperCycleOnceMock: vi.fn() }));

vi.mock("@/lib/trader/paper/paper-cycle-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trader/paper/paper-cycle-runner")>();
  return { ...actual, runPaperCycleOnce: runPaperCycleOnceMock };
});

import { loadPaperLoopConfig } from "@/lib/trader/paper/build-worker-deps";
import { runPaperLoopCycle } from "@/lib/trader/paper/run-paper-loop-cycle";
import type {
  PaperLoopCycleDeps,
  RunPaperLoopCycleInput,
} from "@/lib/trader/paper/paper-loop-worker.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { StartupReconciliationResult } from "@/lib/trader/execution/reconciliation-startup.types";

const ORG_ID = "00000000-0000-4000-8000-000000012004";

function makeSnapshot(): MarketSnapshot {
  return {
    bars: [],
    quote: {} as MarketSnapshot["quote"],
    evaluatedAt: "2026-10-02T00:00:00.000Z",
    cycleIndex: 1,
    cycleId: "paper-freshness-test-cycle",
  };
}

function makeStartupResult() {
  return {
    organizationId: ORG_ID,
    executionMode: "mock" as const,
    runStartedAt: new Date("2026-10-02T00:00:00.000Z"),
    reconciliation: {
      organizationId: ORG_ID,
      runStartedAt: new Date("2026-10-02T00:00:00.000Z"),
      outcomes: [{}],
      counts: {},
    },
    escalation: { organizationId: ORG_ID, escalationsAttempted: 0, outcomes: [] },
  };
}

function makeEnabledInput(
  orderRepository?: Partial<OrderRepository>,
  executionMode: "mock" | "paper" = "paper",
): {
  input: RunPaperLoopCycleInput;
  logger: ReturnType<typeof vi.fn>;
  startupReconciliation: ReturnType<typeof vi.fn>;
} {
  const logger = vi.fn();
  const runStartupReconciliation = vi.fn(async () =>
    makeStartupResult() as unknown as StartupReconciliationResult,
  );
  const repository: Partial<OrderRepository> = {
    listOrders: vi.fn(async () => []),
    listFills: vi.fn(async () => []),
    listOpenOrders: vi.fn(async () => []),
    ...orderRepository,
  };
  const paperCycleDeps = executionMode === "paper"
    ? {
        decisionCapitalAuthorityV2: {} as PaperLoopCycleDeps["paperCycleDeps"]["decisionCapitalAuthorityV2"],
        canonicalOrdinaryCapitalEnvelopeV2: {} as PaperLoopCycleDeps["paperCycleDeps"]["canonicalOrdinaryCapitalEnvelopeV2"],
      }
    : {};
  const input: RunPaperLoopCycleInput = {
    deps: {
      config: {
        enabled: true,
        organizationId: ORG_ID,
        accountKey: "paper-freshness-test",
        defaultQuantity: "0.01",
        startingBalanceUsdt: "100000.00",
        defaultStopDistancePct: "0.02",
        cycleIdPrefix: "paper-freshness-test",
      },
      paperCycleDeps: paperCycleDeps as PaperLoopCycleDeps["paperCycleDeps"],
      orderRepository: repository as OrderRepository,
      poll: {
        fetchSnapshot: vi.fn(async () => makeSnapshot()),
        reset: vi.fn(),
      },
      startupReconciliation: { runStartupReconciliation },
      logger: { log: logger },
    },
  };
  return { input, logger, startupReconciliation: runStartupReconciliation };
}

function submittedCycleResult(): PaperCycleResult {
  return {
    evaluation: { signal: { outcome: "SIGNAL" } } as PaperCycleResult["evaluation"],
    strategyExecutions: [
      {
        signal: { strategyId: "test-strategy" },
        submitBlocked: false,
        execution: { status: "submitted" },
        reconciliation: null,
      },
    ] as unknown as PaperCycleResult["strategyExecutions"],
    submitBlocked: false,
    execution: { status: "submitted" } as PaperCycleResult["execution"],
    reconciliation: null,
  } as PaperCycleResult;
}

describe("paper loop worker config (P5 NEW-8)", () => {
  it("requires enabled flag, org id, and account key", () => {
    expect(
      loadPaperLoopConfig({
        PAPER_LOOP_ENABLED: "1",
        PAPER_LOOP_ORGANIZATION_ID: "00000000-0000-4000-8000-0000000334",
        PAPER_LOOP_ACCOUNT_KEY: "acct-paper-loop",
      }).enabled,
    ).toBe(true);

    expect(
      loadPaperLoopConfig({
        PAPER_LOOP_ENABLED: "1",
        PAPER_LOOP_ORGANIZATION_ID: "00000000-0000-4000-8000-0000000334",
      }).enabled,
    ).toBe(false);
  });

  it("loads M2 portfolio env defaults", () => {
    const config = loadPaperLoopConfig({
      PAPER_LOOP_ENABLED: "1",
      PAPER_LOOP_ORGANIZATION_ID: "00000000-0000-4000-8000-0000000334",
      PAPER_LOOP_ACCOUNT_KEY: "acct-paper-loop",
      PAPER_LOOP_STARTING_BALANCE_USDT: "50000.00",
      PAPER_LOOP_DEFAULT_STOP_DISTANCE_PCT: "0.03",
    });

    expect(config.startingBalanceUsdt).toBe("50000.00");
    expect(config.defaultStopDistancePct).toBe("0.03");
  });
});

describe("runPaperLoopCycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runPaperCycleOnceMock.mockReset();
  });

  it("returns noop when disabled", async () => {
    const deps: PaperLoopCycleDeps = {
      config: {
        enabled: false,
        organizationId: "",
        accountKey: "",
        defaultQuantity: "0.01",
        startingBalanceUsdt: "100000.00",
        defaultStopDistancePct: "0.02",
        cycleIdPrefix: "test",
      },
      paperCycleDeps: {} as PaperLoopCycleDeps["paperCycleDeps"],
      orderRepository: {} as PaperLoopCycleDeps["orderRepository"],
      poll: {} as PaperLoopCycleDeps["poll"],
      startupReconciliation: {} as PaperLoopCycleDeps["startupReconciliation"],
      logger: { log: vi.fn() },
    };

    const report = await runPaperLoopCycle({ deps });

    expect(report.outcome).toBe("noop_disabled");
    expect(report.strategySubmittedCount).toBe(0);
  });

  it.each(["portfolio", "open_orders"] as const)(
    "blocks before paper evaluation when the initial %s read fails",
    async (failedRead) => {
      const error = Object.assign(new Error("private database details"), { name: "DatabaseError" });
      const { input, logger, startupReconciliation } = makeEnabledInput(
        failedRead === "portfolio"
          ? { listOrders: vi.fn(async () => { throw error; }) }
          : { listOpenOrders: vi.fn(async () => { throw error; }) },
      );
      runPaperCycleOnceMock.mockResolvedValue(submittedCycleResult());
      const telemetry: string[] = [];

      const report = await runPaperLoopCycle({ ...input, telemetrySink: (line) => telemetry.push(line) });

      expect(report.outcome).toBe("blocked");
      expect(report.reason).toBe("account_state_unavailable");
      expect(report.accountStateStatus).toBe("unavailable");
      expect(report.accountStateErrorClass).toBe("DatabaseError");
      expect(report.startupReconciledOrders).toBe(1);
      expect(startupReconciliation).toHaveBeenCalledTimes(1);
      expect(runPaperCycleOnceMock).not.toHaveBeenCalled();
      expect(telemetry).toEqual([]);
      expect(logger).toHaveBeenCalledWith(expect.objectContaining({
        phase: "account_state_unavailable",
        reason: "account_state_unavailable",
        errorClass: "DatabaseError",
      }));
      expect(JSON.stringify({ report, logs: logger.mock.calls })).not.toContain("private database details");
    },
  );

  it("preserves a completed submit when the post-cycle account refresh fails", async () => {
    let portfolioReads = 0;
    const listOrders = vi.fn(async () => {
      portfolioReads += 1;
      if (portfolioReads === 2) {
        throw Object.assign(new Error("private post-refresh details"), { name: "DatabaseError" });
      }
      return [];
    });
    const { input, logger } = makeEnabledInput({ listOrders });
    runPaperCycleOnceMock.mockResolvedValue(submittedCycleResult());
    const telemetry: string[] = [];

    const report = await runPaperLoopCycle({ ...input, telemetrySink: (line) => telemetry.push(line) });

    expect(runPaperCycleOnceMock).toHaveBeenCalledTimes(1);
    expect(report.outcome).toBe("submitted");
    expect(report.stateRefreshed).toBe(false);
    expect(report.accountStateStatus).toBe("stale");
    expect(report.accountStateErrorClass).toBe("DatabaseError");
    expect(telemetry).toHaveLength(1);
    expect(JSON.parse(telemetry[0]!)).toMatchObject({
      execution_mode: "paper",
      state_refreshed: false,
      account_state_status: "stale",
      error_class: "DatabaseError",
    });
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({
      phase: "cycle_complete",
      outcome: "submitted",
      stateRefreshed: false,
      accountStateStatus: "stale",
      errorClass: "DatabaseError",
    }));
    expect(JSON.stringify({ report, telemetry, logs: logger.mock.calls })).not.toContain("private post-refresh details");
  });

  it.each(["paper", "mock"] as const)(
    "reports current account state and the actual %s mode after a successful refresh",
    async (executionMode) => {
      const { input, logger } = makeEnabledInput(undefined, executionMode);
      runPaperCycleOnceMock.mockResolvedValue(submittedCycleResult());
      const telemetry: string[] = [];

      const report = await runPaperLoopCycle({ ...input, telemetrySink: (line) => telemetry.push(line) });

      expect(report.outcome).toBe("submitted");
      expect(report.stateRefreshed).toBe(true);
      expect(report.accountStateStatus).toBe("current");
      expect(report.accountStateErrorClass).toBeUndefined();
      expect(JSON.parse(telemetry[0]!)).toMatchObject({
        execution_mode: executionMode,
        state_refreshed: true,
        account_state_status: "current",
      });
      expect(logger).toHaveBeenCalledWith(expect.objectContaining({
        phase: "cycle_complete",
        stateRefreshed: true,
        accountStateStatus: "current",
      }));
    },
  );
});
