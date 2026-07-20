import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as pgSchema from "@/db/schema.postgres";

describe("trader wp13 intelligence records schema", () => {
  it("defines three pgTable contracts and migration files", () => {
    expect(pgSchema.traderIntelligenceCycleEnvelope).toBeDefined();
    expect(pgSchema.traderIntelligenceHypothesisRecord).toBeDefined();
    expect(pgSchema.traderIntelligenceConvictionRecord).toBeDefined();
    const sql = readFileSync("db/migrations_postgres/0080_trader_intelligence_conviction_record.sql", "utf8");
    expect(sql).toContain("conviction_scope");
    expect(sql).not.toContain("AGGREGATE");
  });
});
