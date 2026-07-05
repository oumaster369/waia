import { describe, expect, it } from "vitest";

import { deriveEvidenceFromMetrics } from "@/lib/trader/discovery/evidence-ledger";

describe("evidence ledger (M8)", () => {
  it("derives epistemic evidence without PnL fields", () => {
    const records = deriveEvidenceFromMetrics(
      {
        organizationId: "org-1",
        campaignId: "camp-1",
        candidateRef: "cand-1",
        sourceRunDigest: "run-digest",
        observedRegimeLabels: ["RANGE", "CHOP"],
        satisfiesMultiRegimeCoverage: false,
        blindConsumed: true,
        walkForwardWindowCount: 2,
        closedTradeCount: 6,
        builderGitSha: "abc123",
        metricsSchemaVersion: "waia.trader.metrics.v1",
      },
      () => "evidence-1",
    );

    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(["FOR", "AGAINST", "NEUTRAL"]).toContain(record.direction);
      expect(JSON.stringify(record)).not.toMatch(/pnl|profit|fitness/i);
    }
    const regimeRecord = records.find((r) => r.dimension === "regime_coverage");
    expect(regimeRecord?.rationaleJson).toContain("epistemic_not_success_probability");
  });
});
