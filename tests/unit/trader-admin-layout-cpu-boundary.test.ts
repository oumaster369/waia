import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("trader admin layout authorization boundary", () => {
  it("adds admin admission without session provisioning or trader bootstrap", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(trader)/admin/layout.tsx"),
      "utf8",
    );

    // DEE-949 requires authenticated page admission in addition to API checks.
    // Keep the original CPU boundary: no provisioning or trading initialization.
    expect(source).toContain('dynamic = "force-dynamic"');
    expect(source).toContain("authorizeAdminRoute(");
    expect(source).toContain('"admin.audit.read"');
    expect(source).toContain('if (!userId) redirect("/")');
    expect(source).toContain("if (!auth.ok) notFound()");
    expect(source).toContain("await deps.disposeRuntimeDb(runtime)");
    expect(source).not.toContain("getOptionalSessionUserId");
    expect(source).not.toContain("assertAdminPermission");
    expect(source).not.toContain("getWaiaRuntimeDb");
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
