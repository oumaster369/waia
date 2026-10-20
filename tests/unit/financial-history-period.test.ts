import { describe, expect, it } from "vitest";
import { financialHistoryPeriodFromDates } from "@/components/trader/account-observation/financial-history-period";
import { assertFinancialHistoryResponse } from "@/lib/trader/account-observation/financial-history";
import { binding, historyPage } from "../helpers/financial-history-ui-fixture";

describe("financial history UTC periods", () => {
  it("uses inclusive UTC calendar days across a DST boundary and leap day", () => {
    expect(financialHistoryPeriodFromDates("2026-03-08", "2026-03-09")).toEqual({
      windowStartMs: Date.parse("2026-03-08T00:00:00Z"),
      windowEndMs: Date.parse("2026-03-10T00:00:00Z"),
    });
    const leap = financialHistoryPeriodFromDates("2024-02-29", "2024-02-29");
    expect(leap.windowEndMs! - leap.windowStartMs!).toBe(86_400_000);
  });
  it("supports all saved history and either open bound", () => {
    expect(financialHistoryPeriodFromDates("", "")).toEqual({
      windowStartMs: null,
      windowEndMs: null,
    });
    expect(financialHistoryPeriodFromDates("1970-01-01", "")).toEqual({
      windowStartMs: 0,
      windowEndMs: null,
    });
    expect(financialHistoryPeriodFromDates("", "1970-01-01")).toEqual({
      windowStartMs: null,
      windowEndMs: 86_400_000,
    });
  });
  it.each([
    ["2026-02-29", ""],
    ["2026-04-31", ""],
    ["2026-3-01", ""],
    ["1969-12-31", ""],
    ["2026-03-10", "2026-03-08"],
    ["", "invalid"],
  ])("rejects invalid dates or reversed days %s .. %s", (start, end) => {
    expect(() => financialHistoryPeriodFromDates(start, end)).toThrow();
  });
  it("enforces half-open bill boundaries and overlapping original coverage windows", () => {
    const page = historyPage();
    const request = {
      binding,
      pageSize: 20,
      cursor: null,
      filters: { windowStartMs: 1000, windowEndMs: 2000 },
    };
    Object.assign(page.records[0].provenance, { windowStartMs: 0, windowEndMs: 3000 });
    for (const timestamp of [1000, 1999]) {
      page.records[0].bill.createdTimeMs = timestamp;
      expect(() => assertFinancialHistoryResponse(request, page)).not.toThrow();
    }
    for (const timestamp of [999, 2000]) {
      page.records[0].bill.createdTimeMs = timestamp;
      expect(() => assertFinancialHistoryResponse(request, page)).toThrow(
        "FINANCIAL_HISTORY_RESPONSE_FILTER",
      );
    }
    page.records = [];
    for (const [start, end] of [
      [0, 1000],
      [2000, 3000],
    ]) {
      Object.assign(page.coverage[0].provenance, { windowStartMs: start, windowEndMs: end });
      expect(() => assertFinancialHistoryResponse(request, page)).toThrow(
        "FINANCIAL_HISTORY_RESPONSE_FILTER",
      );
    }
    Object.assign(page.coverage[0].provenance, { windowStartMs: 500, windowEndMs: 1500 });
    expect(() => assertFinancialHistoryResponse(request, page)).not.toThrow();
    expect(page.coverage[0].provenance.windowStartMs).toBe(500);
    expect(page.coverage[0].completeness).toBe("UNKNOWN");
  });
});
