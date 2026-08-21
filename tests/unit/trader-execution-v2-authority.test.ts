import { describe, expect, it } from "vitest";

import { deterministicExecutionUuidV2 } from "@/lib/trader/execution/v2/contracts";

describe("Execution V2 deterministic authority identities (DEE-668 / E651-B)", () => {
  it("reconstructs the same canonical UUID across restart", () => {
    const seed = {
      organizationId: "org-a",
      riskAllowanceId: "allowance-a",
      executionPlanContentDigestHex: "a".repeat(64),
    };
    const first = deterministicExecutionUuidV2("attempt", seed);
    const afterRestart = deterministicExecutionUuidV2("attempt", { ...seed });
    expect(afterRestart).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("domain-separates plan, order, attempt, Risk event, and report identities", () => {
    const seed = { authority: "same-seed" };
    const identities = ["plan", "order", "attempt", "risk-event", "report"].map((kind) =>
      deterministicExecutionUuidV2(kind as "plan", seed));
    expect(new Set(identities)).toHaveLength(5);
  });
});
