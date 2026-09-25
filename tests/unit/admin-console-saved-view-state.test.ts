import { describe, expect, it } from "vitest";
import { savedViewHref } from "@/lib/trader/admin-console/saved-view-state";
describe("saved view navigation is data, never authority", () => {
  it("restores only allowed filters and removes stale selections and commands", () => {
    expect(
      savedViewHref("orders", {
        query:
          "organization_id=org&exchange_account_id=account&mode=paper&currency=USD&tab=all&status=REJECTED&sel=old&command=kill&url=https://evil.invalid",
      }),
    ).toBe(
      "/admin/orders?organization_id=org&exchange_account_id=account&currency=USD&mode=paper&tab=all&status=REJECTED",
    );
    expect(savedViewHref("accounts", { query: "exchange_account_id=other&mode=live" })).toBe(
      "/admin/accounts?mode=live",
    );
  });
  it("rejects external paths, prototype property names and unsupported stored formats", () => {
    expect(savedViewHref("https://evil.invalid", { query: "" })).toBe(null);
    expect(savedViewHref("__proto__", { query: "" })).toBe(null);
    expect(savedViewHref("orders", { query: {} })).toBe(null);
  });
});
