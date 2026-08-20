import { describe, expect, it } from "vitest";

import { executionPayoffFunctionalV2 } from "@/lib/trader/intelligence/decision-economics/execution-payoff-functional-v2";
import {
  DEE649_TEST_DIGEST_A,
  dee649Sample13d,
  dee649TestAnchor,
  dee649TestPolicy,
} from "@/tests/unit/helpers/dee649-decision-economics-fixtures";

function evaluate(overrides: Partial<Parameters<typeof executionPayoffFunctionalV2>[0]> = {}) {
  return executionPayoffFunctionalV2({
    sample13d: dee649Sample13d(),
    primaryHorizonMinutes: 30,
    anchorAuthority: dee649TestAnchor(),
    policy: dee649TestPolicy(),
    exactQuantity: "1",
    availableCashUsdt: "200",
    cashAuthorityReceiptDigestHex: DEE649_TEST_DIGEST_A,
    ...overrides,
  });
}

describe("DEE-649 C2 ExecutionPayoffFunctionalV2", () => {
  it("preserves negative outcomes and applies a separate conservative per-side stress", () => {
    const policy = dee649TestPolicy({
      entryCosts: {
        feeBps: "1",
        spreadBps: "2",
        impactBps: "3",
        slippageBps: "4",
        conservativeStressBps: "5",
      },
      exitCosts: {
        feeBps: "6",
        spreadBps: "7",
        impactBps: "8",
        slippageBps: "9",
        conservativeStressBps: "10",
      },
    });
    const result = evaluate({
      policy,
      sample13d: dee649Sample13d({ exitPrices: [90, 90, 90] }),
    });

    expect(result.status).toBe("ECONOMICALLY_ADMISSIBLE");
    expect(result.basePayoff).toBeLessThan(0);
    expect(result.lowerPayoff).toBeLessThan(result.basePayoff);
    expect(result.lowerPayoffUsdt).not.toBe("0");
    expect(result.basePayoffUsdt).toBe("-10.37");
    expect(result.lowerPayoffUsdt).toBe("-10.51");
    expect(result.entrySlices[0]?.costs).toMatchObject({
      feeUsdt: expect.any(String),
      spreadUsdt: expect.any(String),
      impactUsdt: expect.any(String),
      slippageUsdt: expect.any(String),
      conservativeStressUsdt: expect.any(String),
    });
  });

  it("keeps an underfilled entry remainder as CASH and never tops up a later slice", () => {
    const result = evaluate({
      sample13d: dee649Sample13d({ entryVolumes: [2, 100, 100] }),
    });

    expect(result.status).toBe("ECONOMICALLY_ADMISSIBLE");
    expect(result.entrySlices.map((slice) => slice.targetQuantity)).toEqual(["0.5", "0.5"]);
    expect(result.entrySlices.map((slice) => slice.filledQuantity)).toEqual(["0.2", "0.5"]);
    expect(result.filledEntryQuantity).toBe("0.7");
    expect(result.unfilledEntryQuantityRetainedAsCash).toBe("0.3");
    expect(result.residualInventoryQuantity).toBe("0");
  });

  it("limits entry by sealed available CASH without borrowing or later top-up", () => {
    const result = evaluate({ availableCashUsdt: "60" });

    expect(result.entrySlices.map((slice) => slice.filledQuantity)).toEqual(["0.5", "0.1"]);
    expect(result.filledEntryQuantity).toBe("0.6");
    expect(result.unfilledEntryQuantityRetainedAsCash).toBe("0.4");
  });

  it("floors capacity and weighted slice quantities to the sealed quantity step", () => {
    const policy = dee649TestPolicy({
      entrySliceWeights: ["0.33", "0.67"],
      exitSliceWeights: ["0.33", "0.67"],
    });
    const result = evaluate({
      policy,
      sample13d: dee649Sample13d({ entryVolumes: [3.9, 100, 100] }),
    });

    expect(result.entrySlices.map((slice) => slice.targetQuantity)).toEqual(["0.3", "0.7"]);
    expect(result.entrySlices[0]).toMatchObject({
      capacityQuantity: "0.3",
      filledQuantity: "0.3",
    });
    expect(result.filledEntryQuantity).toBe("1");
  });

  it("does not fabricate fills below sealed quantity/notional minimums", () => {
    const policy = dee649TestPolicy({ minimumNotionalUsdt: "60" });
    const result = evaluate({ policy });

    expect(result.filledEntryQuantity).toBe("0");
    expect(result.unfilledEntryQuantityRetainedAsCash).toBe("1");
    expect(result.basePayoffUsdt).toBe("0");
  });

  it("makes a size inadmissible when mandatory post-horizon slices leave inventory", () => {
    const result = evaluate({
      sample13d: dee649Sample13d({ exitVolumes: [2, 2, 100] }),
    });

    expect(result.status).toBe("ECONOMICALLY_INADMISSIBLE");
    expect(result.reasonCodes).toContain("POST_EXIT_RESIDUAL_INVENTORY");
    expect(result.residualInventoryQuantity).toBe("0.6");
  });

  it("uses entry/exit price and qualified capacity components but treats R_h as trigger mark", () => {
    const base = evaluate();
    const higherExit = evaluate({
      sample13d: dee649Sample13d({ exitPrices: [110, 110, 110] }),
    });
    const lowerEntryCapacity = evaluate({
      sample13d: dee649Sample13d({ entryVolumes: [2, 100, 100] }),
    });
    const differentHorizonMark = evaluate({
      sample13d: dee649Sample13d({ horizonPrice: 80 }),
    });

    expect(higherExit.basePayoff).toBeGreaterThan(base.basePayoff);
    expect(lowerEntryCapacity.filledEntryQuantity).not.toBe(base.filledEntryQuantity);
    expect(differentHorizonMark.basePayoff).toBe(base.basePayoff);
    expect(differentHorizonMark.horizonTriggerMarkPrice).toBe("80");
    expect(differentHorizonMark.contentDigestHex).not.toBe(base.contentDigestHex);
  });

  it("makes every selected entry/exit return and volume component economically material", () => {
    const baseline = evaluate();
    for (const entryPrices of [
      [110, 100, 100],
      [100, 110, 100],
    ] as const) {
      expect(evaluate({ sample13d: dee649Sample13d({ entryPrices }) }).basePayoff).not.toBe(
        baseline.basePayoff,
      );
    }
    for (const exitPrices of [
      [90, 100, 100],
      [100, 90, 100],
    ] as const) {
      expect(evaluate({ sample13d: dee649Sample13d({ exitPrices }) }).basePayoff).not.toBe(
        baseline.basePayoff,
      );
    }
    for (const entryVolumes of [
      [2, 100, 100],
      [100, 2, 100],
    ] as const) {
      expect(
        evaluate({ sample13d: dee649Sample13d({ entryVolumes }) }).filledEntryQuantity,
      ).not.toBe(baseline.filledEntryQuantity);
    }
    for (const exitVolumes of [
      [2, 100, 100],
      [100, 2, 100],
    ] as const) {
      expect(evaluate({ sample13d: dee649Sample13d({ exitVolumes }) }).status).toBe(
        "ECONOMICALLY_INADMISSIBLE",
      );
    }
  });

  it("fails closed on missing authority, anchor mismatch, malformed sample or off-step size", () => {
    const policy = dee649TestPolicy();
    expect(
      evaluate({
        policy: { ...policy, liquidityCapacityAuthorityReceiptDigestHex: "" },
      }).reasonCodes,
    ).toContain("LIQUIDITY_CAPACITY_AUTHORITY_MISSING");
    expect(
      evaluate({
        anchorAuthority: { ...dee649TestAnchor(), qualifiedAnchorClosePrice: "99" },
      }).reasonCodes,
    ).toContain("ANCHOR_AUTHORITY_MISMATCH");
    expect(evaluate({ sample13d: [0] }).reasonCodes).toContain("FORECAST_SAMPLE_INVALID");
    expect(evaluate({ exactQuantity: "0.15" }).reasonCodes).toContain("ECONOMIC_SIZE_SET_INVALID");
  });

  it("is deterministic for identical inputs", () => {
    expect(evaluate()).toEqual(evaluate());
  });
});
