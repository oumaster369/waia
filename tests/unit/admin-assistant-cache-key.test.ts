import { describe, expect, it } from "vitest";

import { assistantCacheKey } from "@/lib/trader/admin-console/assistant/cache-key";

const base = {
  question: "сводка",
  entity: "fleet",
  revision: "rev",
  scope: "fleet",
  period: "today",
  mode: "live",
  currency: "USDT",
  promptVersion: "admin-assistant/v1",
  toolPolicyVersion: "admin-tools/v1",
};

describe("admin assistant cache key", () => {
  it("changes when the period, currency, mode, or prompt version changes", () => {
    const first = assistantCacheKey(base);
    expect(assistantCacheKey({ ...base, period: "month" })).not.toBe(first);
    expect(assistantCacheKey({ ...base, currency: "USD" })).not.toBe(first);
    expect(assistantCacheKey({ ...base, mode: "paper" })).not.toBe(first);
    expect(assistantCacheKey({ ...base, promptVersion: "admin-assistant/v2" })).not.toBe(first);
    expect(assistantCacheKey(base)).toBe(first);
  });
});
