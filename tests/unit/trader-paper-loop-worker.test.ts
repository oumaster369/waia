import { describe, expect, it, vi } from "vitest";

import { loadPaperLoopConfig } from "@/lib/trader/paper/build-worker-deps";
import { runPaperLoopCycle } from "@/lib/trader/paper/run-paper-loop-cycle";
import type { PaperLoopCycleDeps } from "@/lib/trader/paper/paper-loop-worker.types";

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
});
