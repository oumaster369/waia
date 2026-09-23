import { describe, expect, it } from "vitest";

import {
  parseAdminConsoleUrl,
  writeAdminConsoleUrl,
} from "@/components/trader/admin-console/data/url-state";

describe("admin console url state", () => {
  it("keeps the tab, selection and scope in the query string", () => {
    const state = parseAdminConsoleUrl("?tab=working&sel=order:1&scope=org-1");
    expect(state).toEqual({ tab: "working", sel: "order:1", scope: "org-1" });
    expect(writeAdminConsoleUrl("/admin/orders", state)).toBe(
      "/admin/orders?tab=working&sel=order%3A1&scope=org-1",
    );
  });
});
