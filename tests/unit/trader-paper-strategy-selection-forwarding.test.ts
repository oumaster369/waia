import { describe, expect, it, vi } from "vitest";

import { declareResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { FixtureBarReplaySource } from "@/lib/trader/market-data/fixture-bar-replay-source";
import type { BarPollSource, BarReplaySource, MarketSnapshot } from "@/lib/trader/market-data/types";
import { runFixturePaperCycles, runPollPaperCycles } from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORGANIZATION_ID = "00000000-0000-4000-8000-0000000260";
const ACCOUNT_ID = "selection-forwarding-account";

function researchAuthority() {
  return declareResearchNonCapitalInformationAuthorityV2({
    organizationId: ORGANIZATION_ID,
    reason: "PAPER_STRATEGY_SELECTION_FORWARDING_TEST",
  });
}

function blockedSnapshot(snapshot: MarketSnapshot): MarketSnapshot {
  return { ...snapshot, activeStrategyIds: ["__htr-blocked__"] };
}

function dependencies(): {
  deps: PaperCycleDeps;
  submitOrder: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
} {
  const submitOrder = vi.fn(async () => ({ status: "rejected" as const, reason: "must_not_execute" }));
  const reconcile = vi.fn(async () => {
    throw new Error("reconciliation must not run without an order");
  });
  return {
    deps: {
      execution: { submitOrder } as unknown as PaperCycleDeps["execution"],
      reconciliation: { reconcile },
    },
    submitOrder,
    reconcile,
  };
}

function fixtureWithBlockedActiveStrategy(): BarReplaySource {
  const fixture = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "strategy-selection" });
  return {
    reset: () => fixture.reset(),
    next: () => {
      const next = fixture.next();
      return next.done ? next : { done: false, snapshot: blockedSnapshot(next.snapshot) };
    },
  };
}

describe("paper strategy selection forwarding", () => {
  it("forwards explicit evaluator selection through fixture cycles while active IDs still block execution", async () => {
    const { deps, submitOrder, reconcile } = dependencies();
    const replay = fixtureWithBlockedActiveStrategy();

    const { results } = await runFixturePaperCycles({
      deps,
      context: requireOrgContext(ORGANIZATION_ID),
      n: 1,
      replay,
      strategySignalIds: [MEAN_REVERSION_V0],
      accountKey: ACCOUNT_ID,
      defaultQuantity: "0.01",
      accountState: {
        positions: [],
        openOrderCount: 0,
        dailyPnl: "0",
        drawdown: "0",
        quoteExposureByCurrency: {},
      },
      informationSufficiencyAuthority: researchAuthority(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.evaluation.signals.map((signal) => signal.strategyId)).toEqual([
      MEAN_REVERSION_V0,
    ]);
    expect(results[0]!.strategyExecutions).toHaveLength(0);
    expect(submitOrder).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("forwards explicit evaluator selection through poll cycles while active IDs still block execution", async () => {
    const { deps, submitOrder, reconcile } = dependencies();
    const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "strategy-poll-selection" });
    const poll: BarPollSource = {
      reset: () => replay.reset(),
      fetchSnapshot: async () => {
        const next = replay.next();
        if (next.done) throw new Error("fixture unexpectedly exhausted");
        return blockedSnapshot(next.snapshot);
      },
    };

    const { results } = await runPollPaperCycles({
      deps,
      context: requireOrgContext(ORGANIZATION_ID),
      n: 1,
      poll,
      strategySignalIds: [MEAN_REVERSION_V0],
      accountKey: ACCOUNT_ID,
      defaultQuantity: "0.01",
      accountState: {
        positions: [],
        openOrderCount: 0,
        dailyPnl: "0",
        drawdown: "0",
        quoteExposureByCurrency: {},
      },
      informationSufficiencyAuthority: researchAuthority(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.evaluation.signals.map((signal) => signal.strategyId)).toEqual([
      MEAN_REVERSION_V0,
    ]);
    expect(results[0]!.strategyExecutions).toHaveLength(0);
    expect(submitOrder).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
});
