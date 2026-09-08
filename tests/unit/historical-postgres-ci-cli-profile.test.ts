import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotTechnicalPreparationObserverV2 } from
  "@/lib/trader/historical-simulation-v2/technical-preparation-observer-v2";

afterEach(() => vi.unstubAllEnvs());

describe("historical PostgreSQL CI execution profile", () => {
  it("admits real preparation diagnostics under the actual CI step environment", () => {
    const workflow = readFileSync(".github/workflows/postgres-integration.yml", "utf8");
    const start = workflow.indexOf("      - name: DEE-651 TEST_ONLY Decision");
    expect(start).toBeGreaterThan(0);
    const step = workflow.slice(start).split("\n  historical-postgres17:")[0]!;
    const cliFlag = step.match(/^\s+WAIA_TRADER_CLI:\s*"([^"]+)"\s*$/m)?.[1];
    vi.stubEnv("WAIA_TRADER_CLI", cliFlag);
    const onProgress = vi.fn();
    // Exercise the same production guard reached by the full graph's
    // finalization observer, not a replacement/mocked admission function.
    expect(snapshotTechnicalPreparationObserverV2({ onProgress })).toEqual({
      signal: undefined, onProgress,
    });
    expect(step).toContain("tests/integration/postgres-historical-production-first-cycle-v2.test.ts");
    expect(step).toContain('FHV_TEST_ONLY_EXECUTION_V2_AUTHORITY: "1"');
  });

  it("still refuses observers when Node CLI mode is absent", () => {
    vi.stubEnv("WAIA_TRADER_CLI", undefined);
    expect(() => snapshotTechnicalPreparationObserverV2({ onProgress: () => {} }))
      .toThrow("TECHNICAL_PREPARATION_OBSERVER_NODE_CLI_REQUIRED");
  });
});
