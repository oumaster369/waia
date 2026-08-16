import { describe, expect, it } from "vitest";

import { dateOnlyToIso, datetimeLocalToIso } from "@/lib/treasury-admin/datetime-local";

describe("DEE-616 datetime conversion", () => {
  it("rejects empty or malformed local values", () => {
    expect(datetimeLocalToIso("")).toBeNull();
    expect(datetimeLocalToIso("not-a-date")).toBeNull();
    expect(dateOnlyToIso("")).toBeNull();
    expect(dateOnlyToIso("08/02/2026")).toBeNull();
  });

  it("emits ISO-8601 from a valid datetime-local value", () => {
    const iso = datetimeLocalToIso("2026-08-02T00:00:00");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
