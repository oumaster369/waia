import { describe, expect, it } from "vitest";

import { assistantEnabled } from "@/lib/trader/admin-console/assistant/guard";

describe("admin assistant provider unavailable", () => {
  it("stays disabled unless the flag is explicitly on", () => {
    expect(assistantEnabled({})).toBe(false);
    expect(assistantEnabled({ WAIA_ADMIN_ASSISTANT_ENABLED: "false" })).toBe(false);
    expect(assistantEnabled({ WAIA_ADMIN_ASSISTANT_ENABLED: "on" })).toBe(true);
  });
});
