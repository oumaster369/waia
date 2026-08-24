import { describe, expect, it } from "vitest";

import {
  formatPublicDateTime,
  formatPublicMoney,
  formatPublicMonth,
  formatPublicRunway,
  formatPublicShare,
} from "@/lib/landing/public-format";

describe("public transparency formatting", () => {
  it("formats micros exactly without floating-point money conversion", () => {
    expect(formatPublicMoney("42000000000", "USD")).toBe("42,000 USD");
    expect(formatPublicMoney("-1250000", "EUR")).toBe("−1.25 EUR");
    expect(formatPublicMoney("1", "USD")).toBe("0.000001 USD");
    expect(formatPublicMoney("1000000000000000000000001", "USD")).toBe(
      "1,000,000,000,000,000,000.000001 USD",
    );
  });

  it("does not invent display values for missing or invalid public facts", () => {
    expect(formatPublicMoney(null, "USD")).toBe("Not yet published");
    expect(formatPublicMoney("1000000", null)).toBe("Not yet published");
    expect(formatPublicMoney("1.2", "USD")).toBe("Not yet published");
    expect(formatPublicDateTime("not-a-date")).toBe("Not yet published");
    expect(formatPublicRunway(null, 0)).toBe("Not yet published");
    expect(formatPublicShare(null)).toBe("Not yet published");
    expect(formatPublicShare("1000001")).toBe("Not yet published");
  });

  it("formats the server-owned million-part contribution share exactly", () => {
    expect(formatPublicShare("1000000")).toBe("100%");
    expect(formatPublicShare("666666")).toBe("66.6666%");
    expect(formatPublicShare("333333")).toBe("33.3333%");
    expect(formatPublicShare("1")).toBe("0.0001%");
  });

  it("formats public UTC dates, months, and minute-precision runway", () => {
    expect(formatPublicDateTime("2026-08-23T11:24:32.000Z")).toMatch(/^Aug 23, 2026, 11:24 UTC$/);
    expect(formatPublicMonth("2026-08")).toBe("August 2026");
    expect(formatPublicMonth("current")).toBe("current");
    expect(formatPublicRunway("2026-08-25T12:30:00.000Z", Date.parse("2026-08-23T11:00:00Z"))).toBe(
      "2d 1h",
    );
    expect(formatPublicRunway("2026-08-23T11:01:01.000Z", Date.parse("2026-08-23T11:00:00Z"))).toBe(
      "2m",
    );
    expect(formatPublicRunway("2026-08-23T10:59:59.000Z", Date.parse("2026-08-23T11:00:00Z"))).toBe(
      "Runway elapsed",
    );
  });
});
