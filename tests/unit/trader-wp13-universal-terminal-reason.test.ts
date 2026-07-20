import { describe, expect, it } from "vitest";
import { resolveUniversalTerminalReason, universalTerminalReasonCodes } from "@/lib/trader/intelligence/terminal-reason/universal-terminal-reason";

describe("trader wp13 universal terminal reason", () => {
  it("covers required taxonomy", () => {
    expect(universalTerminalReasonCodes).toContain("NO_HYPOTHESIS");
    expect(universalTerminalReasonCodes).toContain("ALLOW_TRADING");
  });

  it("resolves exactly one universal reason", () => {
    expect(
      resolveUniversalTerminalReason({
        opportunityAuthorized: true,
        tradingPermission: "ALLOW_TRADING",
      }),
    ).toBe("ALLOW_TRADING");
    expect(
      resolveUniversalTerminalReason({ insufficientBars: true }),
    ).toBe("INSUFFICIENT_BARS");
  });
});
