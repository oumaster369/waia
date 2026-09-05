import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TAG = "0197_historical_modeled_reality_stage_v2";
const migration = readFileSync(join(process.cwd(), "db/migrations_postgres", `${TAG}.sql`), "utf8");

describe("DEE-920 historical modeled Reality stage migration", () => {
  it("adds only the explicit modeled Reality stage to the existing atomic stage guard", () => {
    expect(migration).toContain("DROP CONSTRAINT historical_sim_atomic_stage_kind");
    expect(migration).toContain("'HISTORICAL_MODELED_REALITY'");
    expect(migration).toContain("'ACCOUNTING','GUARDIAN','KNOWLEDGE','LEARNING'");
    expect(migration).not.toContain("reality-projection/v2");
    expect(migration).not.toMatch(/trader_reality_v2/i);
  });
});
