import ts from "typescript";
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

// Structural owner coverage: one continuation reconstruction is shared with
// reconciliation; a selected old-N read must not replay unrelated runtime state.
it("keeps exactly one full reconstruction on the actual owner call chain", () => {
  const root = "lib/trader/historical-simulation-v2/";
  const owner = readFileSync(resolve(process.cwd(), root + "atomic-cycle-repository-postgres-v2.ts"), "utf8");
  const repository = readFileSync(resolve(process.cwd(), root + "production-reconciliation-repository-postgres-v1.ts"), "utf8");
  const parse = (name: string, source: string) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const calls = (node: ts.Node): number => {
    let count = ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === "restoreHistoricalSimulationProductionRuntimeStateV2" ? 1 : 0;
    node.forEachChild((child) => { count += calls(child); });
    return count;
  };
  const parsed = parse("owner.ts", owner);
  expect(calls(parsed) + calls(parse("repository.ts", repository))).toBe(1);
  const producer = parsed.statements.find((statement) => ts.isFunctionDeclaration(statement) &&
    statement.name?.text === "produceHistoricalSimulationNextCycleV2");
  expect(producer).toBeDefined();
  expect(calls(producer!)).toBe(0);
  expect(owner).toContain("reconciliation.validateCursor(previousCursor, false, previousRuntime)");
  expect(owner).toMatch(/previousCursor,\s*previousRuntime,\s*codeSha/);
});
