import { describe, expect, it } from "vitest";

import { readAdminRelease } from "@/lib/trader/admin-console/release";

describe("admin console release reader", () => {
  it("treats a 40-hex SHA as unverified and anything else as unset", () => {
    expect(readAdminRelease({})).toEqual({
      state: "unavailable",
      reason: "WAIA_RELEASE_SHA_NOT_SET",
    });
    expect(readAdminRelease({ WAIA_RELEASE_SHA: "abcd" })).toEqual({
      state: "unavailable",
      reason: "WAIA_RELEASE_SHA_NOT_SET",
    });
    expect(readAdminRelease({ WAIA_RELEASE_SHA: "AB".repeat(20) })).toMatchObject({
      state: "value",
      sha: "ab".repeat(20),
      verified: false,
      reason: "RELEASE_SHA_UNVERIFIED",
    });
  });
});
