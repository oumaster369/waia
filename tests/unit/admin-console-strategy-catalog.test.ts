import { describe, expect, it } from "vitest";

import { mergeStrategyCatalog } from "@/lib/trader/admin-console/research/strategy-catalog";

describe("admin console strategy catalog", () => {
  it("keeps a trade-only version visible and does not invent a percent return", () => {
    const rows = mergeStrategyCatalog([{ strategyId: "unknown-strategy", version: "9" }]);
    const extra = rows.find((row) => row.strategyId === "unknown-strategy");
    expect(extra?.source).toBe("trades");
    expect(extra?.reason).toContain("отсутствует в реестре");
    expect(rows.every((row) => row.returnPct.reason === "RETURN_METHOD_NOT_RATIFIED")).toBe(true);
  });
});
