import { describe, expect, it } from "vitest";

import { billingAutomation } from "@/lib/trader/admin-console/billing/billing-automation";

describe("admin console billing automation", () => {
  it("keeps issuance behind an administrator and says notifications are not implemented", () => {
    const view = billingAutomation({
      lastClosedAt: "2026-09-01T00:00:00.000Z",
      lastDraftAt: "2026-09-01T00:01:00.000Z",
      lastIssuedAt: null,
      lastAppliedAt: null,
      settlementRuns: 0,
      lastSuspensionAt: null,
    });
    expect(view.stages).toHaveLength(9);
    expect(view.caption).toContain("подтверждение администратора");
    expect(view.stages[6]?.note).toContain("не реализовано");
    expect(view.stages[4]?.note).toContain("ADR-0008");
  });
});
