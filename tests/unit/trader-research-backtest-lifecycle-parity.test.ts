import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("research backtest lifecycle parity hook (PR2)", () => {
  it("wires open-qty parity and removes legacy recorder-only forced-flat branch", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/trader/research/research-backtest-runner.ts"),
      "utf8",
    );

    expect(src).toContain("assertLifecycleFillWalkOpenQtyParity");
    expect(src).toContain("strategySignalIds");
    expect(src).not.toMatch(/else if \(lifecycleRecorder\)/);
  });
});
