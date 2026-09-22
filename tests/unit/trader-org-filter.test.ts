import { describe, expect, it } from "vitest";

import { filterOrganizationsByTraderEntitlement } from "@/lib/waia-core/permissions/trader-org-filter";

describe("trader organization filter", () => {
  it("drops organizations that never enabled trader", () => {
    const organizations = [
      { id: "org-trader", name: "Trader", kind: "personal" },
      { id: "org-other", name: "Other", kind: "personal" },
    ];
    expect(filterOrganizationsByTraderEntitlement(organizations, new Set(["org-trader"]))).toEqual([
      organizations[0],
    ]);
  });
});
