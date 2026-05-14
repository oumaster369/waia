import { describe, expect, it } from "vitest";

import { oauthErrorQueryMessage } from "@/lib/landing/oauth-error-copy";

describe("oauthErrorQueryMessage", () => {
  it("maps known oauth_error codes", () => {
    expect(oauthErrorQueryMessage("OAUTH_DENIED")).toMatch(/cancelled/i);
    expect(oauthErrorQueryMessage("OAUTH_INVALID_STATE")).toMatch(/expired/i);
    expect(oauthErrorQueryMessage("OAUTH_CONFIG")).toMatch(/available/i);
    expect(oauthErrorQueryMessage("OAUTH_TOKEN")).toMatch(/couldn/i);
  });

  it("returns null for empty code", () => {
    expect(oauthErrorQueryMessage(null)).toBeNull();
    expect(oauthErrorQueryMessage("")).toBeNull();
  });

  it("returns a generic message for unknown codes", () => {
    expect(oauthErrorQueryMessage("UNKNOWN")).toMatch(/didn/i);
  });
});
