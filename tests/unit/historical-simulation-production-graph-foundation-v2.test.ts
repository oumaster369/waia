import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createHistoricalSimulationV2ProductionGraphPrerequisite,
  type HistoricalSimulationV2ProductionGraphPrerequisiteInput,
} from "@/lib/trader/historical-simulation-v2/production-graph-foundation-v2";

const base = {
  sql: vi.fn() as never,
  repoRoot: "/repo", datasetRoot: "/dataset", organizationId: "org", accountId: "account",
  runId: "run", partition: "DEVELOPMENT", symbol: "BTCUSDT", defaultQuantity: "0.01",
} satisfies HistoricalSimulationV2ProductionGraphPrerequisiteInput;

describe("Historical Simulation V2 production graph prerequisite", () => {
  it("accepts only data configuration and exposes a frozen branded graph", () => {
    const graph = createHistoricalSimulationV2ProductionGraphPrerequisite(base);
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.scope)).toBe(true);
    expect(graph.scope).toEqual(expect.objectContaining({ runId: "run", partition: "DEVELOPMENT" }));
  });

  it("has no credential, live connector, Reality, or generic capital graph imports", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/trader/historical-simulation-v2/production-graph-foundation-v2.ts"), "utf8");
    for (const forbidden of ["credential", "htx-connector", "Reality", "paper", "decisionCapitalAuthorityV2", "resolveLedgerProjection", "persistReasonLedger"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("does not admit arbitrary production closures at the type boundary", () => {
    const injected: HistoricalSimulationV2ProductionGraphPrerequisiteInput = {
      ...base,
      // @ts-expect-error production graph never accepts an injected capital implementation
      capital: { resolveLedgerProjection: async () => ({}) },
    };
    expect("capital" in createHistoricalSimulationV2ProductionGraphPrerequisite(injected)).toBe(false);
  });
});
