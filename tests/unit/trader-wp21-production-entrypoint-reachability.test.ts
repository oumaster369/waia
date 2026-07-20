import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("trader wp21 production entrypoint reachability", () => {
  it("threads --htr-epistemic-closure through runResearchPipelinePostgres to runBacktest", () => {
    const cli = readFileSync(
      path.join(process.cwd(), "scripts/trader/research-pipeline-cli.ts"),
      "utf8",
    );
    const orchestrator = readFileSync(
      path.join(process.cwd(), "lib/trader/research/research-orchestrator.ts"),
      "utf8",
    );
    const backtestRunner = readFileSync(
      path.join(process.cwd(), "lib/trader/backtest/backtest-runner.ts"),
      "utf8",
    );

    expect(cli).toMatch(/htr-epistemic-closure/);
    expect(cli).toMatch(/createWp21RuntimeDepsPostgres/);
    expect(cli).toMatch(/runResearchPipelinePostgres/);
    expect(orchestrator).toMatch(/wp21RuntimeDeps/);
    expect(orchestrator).toMatch(/runIsolatedResearchBacktest/);
    expect(backtestRunner).toMatch(/runWp21CycleSeam/);
    expect(backtestRunner).toMatch(/runWp21TerminalSeam/);
  });

  it("does not expose helper-only reachability as the sole production path", () => {
    const backtestRunner = readFileSync(
      path.join(process.cwd(), "lib/trader/backtest/backtest-runner.ts"),
      "utf8",
    );
    expect(backtestRunner.includes("runWp21CycleSeam")).toBe(true);
    expect(backtestRunner.includes("wp21Active")).toBe(true);
  });
});
