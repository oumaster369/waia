import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Historical Simulation V2 current-bar authority chronology", () => {
  it("advances modeled execution before sealing the later-cycle Forecast/DEE-659 authority", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2.ts",
    ), "utf8");
    const producer = source.slice(
      source.indexOf("async function produceHistoricalSimulationNextCycleV2"),
      source.indexOf("export async function runHistoricalSimulationNextCyclePostgresV2"),
    );
    const advanceAt = producer.indexOf("const currentBarAdvance = await advance(cycleId)");
    const finalizeAt = producer.indexOf("await input.finalizeSourceAuthority?.(currentAccounting)");
    expect(advanceAt).toBeGreaterThan(0);
    expect(finalizeAt).toBeGreaterThan(advanceAt);

    const entrypoint = source.slice(
      source.indexOf("export async function runHistoricalSimulationNextCyclePostgresV2"),
    );
    expect(entrypoint).toContain("prepareHistoricalProductionNextCycleAuthorityV2");
    expect(entrypoint).toContain("finalizeSourceAuthority = async (accounting)");
    expect(entrypoint).toContain("accountingFrontierId: accounting.id");
    expect(entrypoint).toContain(
      "accountingFrontierContentDigestHex: accounting.semanticContentDigest",
    );
  });
});
