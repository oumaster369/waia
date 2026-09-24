import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { orderVisibleInMode } from "@/lib/trader/admin-console/sql/order-mode-filter";

const dialect = new PgDialect();

describe("order mode SQL filter", () => {
  it("keeps the all sentinel as text and off the execution-mode enum", () => {
    const query = dialect.sqlToQuery(orderVisibleInMode("all", false));
    expect(query.sql).toContain("execution_mode::text");
    expect(query.sql).not.toMatch(/execution_mode\s*=\s*\$\d+\b(?!::text)/);
    expect(query.params).toEqual(["all", "all", "all", "all"]);
  });

  it("qualifies historical columns when the order is joined", () => {
    const query = dialect.sqlToQuery(orderVisibleInMode("live", true));
    expect(query.sql).toContain("o.historical_run_id");
    expect(query.sql).toContain("o.execution_mode::text");
    expect(query.params.every((value) => value === "live")).toBe(true);
  });
});
