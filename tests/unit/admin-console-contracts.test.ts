import { describe, expect, it } from "vitest";

import { adminEnvelope, adminFact } from "@/lib/trader/admin-console/data-state";
import { decodePageCursor, encodePageCursor } from "@/lib/trader/admin-console/cursor";
import { adminRevision } from "@/lib/trader/admin-console/revision";
import {
  periodBounds,
  parseAdminConsoleQuery,
  adminScopeFromQuery,
} from "@/lib/trader/admin-console/scope";
import {
  resetAdminConsoleSchemaProbeForTests,
  probeAdminConsoleSchema,
} from "@/lib/trader/admin-console/schema-probe";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";

describe("admin console contracts", () => {
  it("builds a deterministic revision for the same data", () => {
    const first = adminRevision({ b: 1, a: "2" });
    const second = adminRevision({ a: "2", b: 1 });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("puts the revision of data on the envelope", () => {
    const data = { equity: "1.00" };
    const envelope = adminEnvelope({ data, scope: { kind: "fleet" } });
    expect(envelope.schemaVersion).toBe("admin-console/v1");
    expect(envelope.revision).toBe(adminRevision(data));
    expect(adminFact({ state: "empty", value: null }).reasons).toEqual([]);
  });

  it("round-trips a page cursor and rejects a broken one", () => {
    const encoded = encodePageCursor({ t: "2026-09-23T00:00:00.000Z", id: "order-1" });
    expect(decodePageCursor(encoded)).toEqual({ t: "2026-09-23T00:00:00.000Z", id: "order-1" });
    expect(decodePageCursor("not-a-cursor")).toBeNull();
  });

  it("uses one scope parser for the same query", () => {
    const url = new URL(
      "http://localhost/api/trader/admin/console/search?organization_id=00000000-0000-4000-8000-000000000001&mode=live&period=7d",
    );
    const first = parseAdminConsoleQuery(url);
    const second = parseAdminConsoleQuery(url);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(adminScopeFromQuery(first.query)).toEqual(adminScopeFromQuery(second.query));
    expect(adminScopeFromQuery(first.query)).toEqual({
      kind: "organization",
      organizationId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("keeps today as a half-open range", () => {
    const bounds = periodBounds(
      { period: "today", tz: "UTC" },
      new Date("2026-09-23T15:00:00.000Z"),
    );
    expect(bounds.start < bounds.end).toBe(true);
    expect(bounds.start).toBe("2026-09-23T00:00:00.000Z");
  });

  it("caches a missing schema probe", async () => {
    resetAdminConsoleSchemaProbeForTests();
    let calls = 0;
    const runtime = {
      kind: "postgres",
      db: {
        execute: async () => {
          calls += 1;
          return [{ present: false }];
        },
      },
    } as unknown as WaiaRuntimeDb;
    expect(await probeAdminConsoleSchema(runtime, 1_000)).toBe(false);
    expect(await probeAdminConsoleSchema(runtime, 2_000)).toBe(false);
    expect(calls).toBe(1);
    resetAdminConsoleSchemaProbeForTests();
  });
});
