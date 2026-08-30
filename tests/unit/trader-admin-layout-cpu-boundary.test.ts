import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("trader admin layout authorization boundary", () => {
  it("uses the authoritative permission check without provisioning trader runtime during SSR", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(trader)/admin/layout.tsx"),
      "utf8",
    );

    expect(source).toContain("getOptionalSessionUserId");
    expect(source).toContain("assertAdminPermission");
    expect(source).toContain('"admin.audit.read"');
    expect(source).not.toContain("hasTraderAccessForUser");
    expect(source).not.toContain("ensureTraderRuntimeForUser");
  });
});
