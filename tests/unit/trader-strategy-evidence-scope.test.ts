import { describe, expect, it } from "vitest";

import { LIQUIDITY_SWEEP_REVERSAL_V0, MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { orderMatchesStrategyEvidenceScope } from "@/lib/trader/paper/strategy-evidence-scope";

describe("orderMatchesStrategyEvidenceScope (DEE-337)", () => {
  it("matches registry strategy id on strategySignalId (unit-test shape)", () => {
    expect(
      orderMatchesStrategyEvidenceScope(
        {
          clientOrderId: "client-paper-cycle-dee-337-0-mean_reversion_v0",
          strategySignalId: MEAN_REVERSION_V0,
        },
        MEAN_REVERSION_V0,
      ),
    ).toBe(true);
  });

  it("matches registry strategy id via clientOrderId suffix (production UUID rows)", () => {
    expect(
      orderMatchesStrategyEvidenceScope(
        {
          clientOrderId: "client-paper-cycle-dee-337-0-mean_reversion_v0",
          strategySignalId: "77708bdc-581f-4e61-b9fa-20ae9994e33b",
        },
        MEAN_REVERSION_V0,
      ),
    ).toBe(true);
  });

  it("does not match unrelated strategies", () => {
    expect(
      orderMatchesStrategyEvidenceScope(
        {
          clientOrderId: "client-paper-cycle-dee-337-0-mean_reversion_v0",
          strategySignalId: "uuid-mr",
        },
        LIQUIDITY_SWEEP_REVERSAL_V0,
      ),
    ).toBe(false);
  });
});
