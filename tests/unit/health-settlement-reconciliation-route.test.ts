import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/settlement-reconciliation/route";

describe("health settlement-reconciliation route", () => {
  it("returns structured health payload", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body).toHaveProperty("open_count");
    expect(body).toHaveProperty("stale_count");
    expect(body).toHaveProperty("orphan_exception_count");
    expect(body).toHaveProperty("ok");
    expect(typeof body.open_count).toBe("number");
    expect(typeof body.orphan_exception_count).toBe("number");
  });
});
