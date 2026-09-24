import { describe, expect, it } from "vitest";

import { parseAggregate } from "@/lib/trader/admin-console/assistant/aggregate";

describe("admin assistant aggregate", () => {
  it("accepts a whitelisted query and rejects an unknown dimension before any SQL", () => {
    expect(
      parseAggregate({ dataset: "orders", dimension: "symbol", measure: "count", limit: 20 }).ok,
    ).toBe(true);
    expect(
      parseAggregate({ dataset: "orders", dimension: "password", measure: "count", limit: 20 }),
    ).toEqual({ ok: false, reason: "UNKNOWN_DIMENSION" });
  });
});
