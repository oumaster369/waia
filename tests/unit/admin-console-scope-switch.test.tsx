import { describe, expect, it } from "vitest";

import { adminQueryKey, responseMatchesScope } from "@/components/trader/admin-console/data/scope";

describe("admin console scope switch", () => {
  it("changes the query key with the scope and rejects a response from the previous scope", () => {
    const fleet = adminQueryKey({
      path: "/overview",
      scope: { kind: "fleet" },
      period: "today",
      mode: "live",
      currency: "USDT",
    });
    const client = adminQueryKey({
      path: "/overview",
      scope: { kind: "client", organizationId: "org-1" },
      period: "today",
      mode: "live",
      currency: "USDT",
    });
    expect(fleet).not.toEqual(client);
    expect(
      responseMatchesScope({ kind: "fleet" }, { kind: "client", organizationId: "org-1" }),
    ).toBe(false);
  });
});
