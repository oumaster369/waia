import { describe, expect, it } from "vitest";

import { consoleListFromBody } from "@/components/trader/admin-console/data/console-list";

describe("console list refresh", () => {
  it("replaces the page with the latest items and keeps a reason when the list is missing", () => {
    expect(consoleListFromBody({ data: { items: [{ id: "a" }] } })).toEqual({
      ok: true,
      items: [{ id: "a" }],
    });
    const first = consoleListFromBody({ data: { items: [{ id: "a" }] } });
    const second = consoleListFromBody({ data: { items: [{ id: "a" }, { id: "b" }] } });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.items.map((row) => row.id)).toEqual(["a", "b"]);
    expect(first.items).not.toEqual(second.items);
    expect(
      consoleListFromBody({ data: { reasons: ["ADMIN_CONSOLE_SCHEMA_NOT_APPLIED"] } }),
    ).toEqual({
      ok: false,
      reason: "ADMIN_CONSOLE_SCHEMA_NOT_APPLIED",
    });
    expect(consoleListFromBody({})).toEqual({ ok: false, reason: "POSTGRES_REQUIRED" });
  });
});
