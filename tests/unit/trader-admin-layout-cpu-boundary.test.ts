import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("trader admin layout authorization boundary", () => {
  it("keeps the presentation shell static and leaves authorization to fail-closed APIs", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(trader)/admin/layout.tsx"),
      "utf8",
    );

    expect(source).toContain("Static presentation shell only");
    expect(source).toContain("/api/trader/admin/**");
    expect(source).not.toContain("getOptionalSessionUserId");
    expect(source).not.toContain("assertAdminPermission");
    expect(source).not.toContain("getWaiaRuntimeDb");
    expect(source).not.toContain("redirect(");
    expect(source).not.toContain("hasTraderAccessForUser");
    expect(source).not.toContain("ensureTraderRuntimeForUser");
  });

  it("keeps the shared trader shell free of session and entitlement work", () => {
    const source = readFileSync(join(process.cwd(), "app/(trader)/layout.tsx"), "utf8");

    expect(source).toContain("Deliberately static observer shell");
    expect(source).not.toContain("getOptionalSessionUserId");
    expect(source).not.toContain("hasTraderAccessForUser");
    expect(source).not.toContain("redirect(");
  });

  it("does not force the client-only trader dashboard through Worker SSR", () => {
    const source = readFileSync(join(process.cwd(), "app/(trader)/trader/page.tsx"), "utf8");

    expect(source).toContain("<TraderWorkspace />");
    expect(source).not.toContain('dynamic = "force-dynamic"');
    expect(source).not.toContain("getOptionalSessionUserId");
  });
});
