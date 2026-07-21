import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/backtest/replay-benchmark-harness", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trader/backtest/replay-benchmark-harness")>();
  return {
    ...actual,
    readGitDirtyTree: () => false,
  };
});

import { runFhvEconomicNonInterferenceQualification } from "@/lib/trader/observability/fhv-economic-non-interference-harness";

describe("DEE-416 FHV economic non-interference integration", () => {
  it("passes PASS-FHV-ECONOMIC-NON-INTERFERENCE for baseline vs instrumented replay", async () => {
    const result = await runFhvEconomicNonInterferenceQualification();

    expect(result.passed).toBe(true);
    expect(result.terminalEvidence).toBe("PASS-FHV-ECONOMIC-NON-INTERFERENCE");
    expect(result.parity.decisionDigest).toBe(true);
    expect(result.parity.orderDigest).toBe(true);
    expect(result.parity.fillDigest).toBe(true);
    expect(result.parity.accountingDigest).toBe(true);
    expect(result.parity.pnlDigest).toBe(true);
    expect(result.parity.terminalState).toBe(true);
    expect(result.baseline.decisionDigest).toBe(result.instrumented.decisionDigest);
    expect(result.baseline.pnlDigest).toBe(result.instrumented.pnlDigest);
  }, 120_000);
});
