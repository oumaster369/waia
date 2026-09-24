import { describe, expect, it } from "vitest";

import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";

describe("admin console money", () => {
  it("formats a decimal string with a thin space and does not use a binary float", () => {
    expect(formatAdminMoney("-1234.5", "USDT")).toBe("−1\u202f234,5\u00a0USDT");
    expect(formatAdminMoney("0", "USD")).toBe("0\u00a0USD");
  });
});
