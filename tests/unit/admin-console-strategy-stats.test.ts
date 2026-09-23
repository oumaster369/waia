import { describe, expect, it } from "vitest";

import {
  researchConditionDifferences,
  researchProgress,
  strategyTradeStats,
} from "@/lib/trader/admin-console/research/strategy-stats";
import { compareDecimal } from "@/lib/trader/risk/numeric";

describe("admin console strategy stats", () => {
  it("hides a win rate with no trades, a profit factor with no losses, and any percent return", () => {
    expect(strategyTradeStats([]).winRate).toBeNull();
    const noLoss = strategyTradeStats(["10", "5"]);
    expect(noLoss.profitFactor).toBeNull();
    expect(noLoss.returnPct.reason).toBe("RETURN_METHOD_NOT_RATIFIED");
    const mixed = strategyTradeStats(["10", "-5"]);
    expect(compareDecimal(mixed.profitFactor ?? "0", "2")).toBe(0);
  });

  it("uses a cycle ratio only when the qualified total is positive and names differing run conditions", () => {
    expect(researchProgress(3, 0)).toEqual({ kind: "count", value: 3 });
    expect(researchProgress(1, 4).kind).toBe("ratio");
    expect(
      researchConditionDifferences(
        { dataset: "a", period: "2024", costs: "v1", version: "1", model: "m" },
        { dataset: "b", period: "2024", costs: "v1", version: "1", model: "m" },
      ),
    ).toEqual(["dataset"]);
  });
});
