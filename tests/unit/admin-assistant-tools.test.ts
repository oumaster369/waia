import { describe, expect, it } from "vitest";

import {
  holdoutRead,
  limitToolRows,
  ADMIN_TOOLS,
} from "@/lib/trader/admin-console/assistant/tools";

describe("admin assistant tools", () => {
  it("caps a tool result at 50 rows and refuses holdout", () => {
    const limited = limitToolRows(Array.from({ length: 51 }, (_, index) => index));
    expect(limited.data).toHaveLength(50);
    expect(limited.truncated).toBe(true);
    expect(limited.total).toBe(51);
    expect(holdoutRead()).toEqual({ state: "unavailable", reason: "HOLDOUT_PROTECTED" });
    expect(ADMIN_TOOLS).not.toContain("place_order");
  });
});
