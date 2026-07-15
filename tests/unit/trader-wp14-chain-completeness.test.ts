import { describe, expect, it } from "vitest";
import { HtrWp14DecisionChainIncompleteError } from "@/lib/trader/intelligence/forecast-decision/errors";

describe("trader wp14 chain completeness", () => {
  it("uses HTR_WP14_DECISION_CHAIN_INCOMPLETE code", () => {
    const error = new HtrWp14DecisionChainIncompleteError("incomplete");
    expect(error.code).toBe("HTR_WP14_DECISION_CHAIN_INCOMPLETE");
  });
});
