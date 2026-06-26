import { describe, expect, it } from "vitest";

import { normalizeSettlementNetwork } from "@/lib/waia-core/payment-watcher/normalize-network";

describe("normalizeSettlementNetwork", () => {
  it("normalizes aliases to TRC-20", () => {
    expect(normalizeSettlementNetwork("TRC-20")).toBe("TRC-20");
    expect(normalizeSettlementNetwork("TRC20")).toBe("TRC-20");
    expect(normalizeSettlementNetwork("tron-trc20")).toBe("TRC-20");
  });

  it("rejects unknown networks", () => {
    expect(normalizeSettlementNetwork("ERC-20")).toBeNull();
  });
});
