import { describe, expect, it } from "vitest";
import { sectionForPath } from "@/components/trader/admin-console/navigation/sections";

describe("admin console section routing", () => {
  it.each(["/admin/account-observation", "/admin/account-observation/stream"])(
    "keeps %s in the Accounts section",
    (pathname) => {
      expect(sectionForPath(pathname).id).toBe("accounts");
    },
  );

  it("keeps unrelated pages in their existing sections", () => {
    expect(sectionForPath("/admin/accounts").id).toBe("accounts");
    expect(sectionForPath("/admin/research").id).toBe("research");
    expect(sectionForPath("/admin").id).toBe("overview");
  });
});
