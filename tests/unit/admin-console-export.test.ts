import { describe, expect, it } from "vitest";

import {
  assertExportWithinLimits,
  escapeCsvCell,
  exportPreamble,
} from "@/lib/trader/admin-console/billing/export-csv";

describe("admin console export", () => {
  it("prefixes formula cells, writes the snapshot header, and rejects an over-limit extract", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("-10.5")).toBe("'-10.5");
    expect(escapeCsvCell("10.5")).toBe("10.5");
    expect(
      exportPreamble({
        generatedAt: "2026-09-23T00:00:00.000Z",
        financeRevision: "abc",
        filters: "none",
        currency: "USDT",
        scope: "fleet",
      })[0],
    ).toContain("generatedAt=");
    expect(() => assertExportWithinLimits(50_001, 0)).toThrow("EXPORT_LIMIT");
  });
});
