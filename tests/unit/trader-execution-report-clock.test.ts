import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("execution report observed clock", () => {
  it("stamps observedAtUtc from clock_timestamp after the attempt read", () => {
    const source = readFileSync("lib/trader/execution/v2/recovery-postgres.ts", "utf8");
    const start = source.indexOf("async function appendReportsInTransaction");
    const end = source.indexOf("async function appendReports(", start);
    const body = source.slice(start, end);
    expect(body).toContain("date_trunc('milliseconds', clock_timestamp()) as durable_at");
    expect(body).not.toContain("transaction_timestamp()");
    expect(body).toContain("observedAtUtc");
  });
});
