import { describe, expect, it } from "vitest";

import { orderMode } from "@/lib/trader/admin-console/modes/order-mode";

describe("order mode", () => {
  it("does not treat a historical order as live just because execution_mode is live", () => {
    expect(orderMode({ historicalRunId: "hist", executionMode: "paper" })).toBe("history");
  });
});
