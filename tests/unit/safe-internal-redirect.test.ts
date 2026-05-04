import { describe, expect, it } from "vitest";

import { safeInternalRedirectPath } from "@/lib/landing/safe-internal-redirect";

describe("safeInternalRedirectPath", () => {
  it("allows /dashboard and deep paths under same origin semantics", () => {
    expect(safeInternalRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeInternalRedirectPath("/dashboard/settings")).toBe("/dashboard/settings");
  });

  it("rejects protocol-relative, schemes, windows paths, traversal, whitespace", () => {
    expect(safeInternalRedirectPath("//evil.example/phish")).toBeNull();
    expect(safeInternalRedirectPath("https://evil/phish")).toBeNull();
    expect(safeInternalRedirectPath("mailto:x@test")).toBeNull();
    expect(safeInternalRedirectPath("\\evil")).toBeNull();
    expect(safeInternalRedirectPath("/good/../bad")).toBeNull();
    expect(safeInternalRedirectPath(" /dashboard")).toBeNull();
    expect(safeInternalRedirectPath("/dash ")).toBeNull();
    expect(safeInternalRedirectPath("\t/dashboard")).toBeNull();
  });
});
