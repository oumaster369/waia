import { describe, expect, it } from "vitest";
import { sortHypothesesByTypeCodePoint } from "@/lib/trader/intelligence/records/serialize-intelligence-records";
import { HYPOTHESIS_RECORD_SCHEMA_VERSION } from "@/lib/trader/intelligence/records/intelligence-records.types";

describe("trader wp13 atomic cycle bundle", () => {
  it("orders hypotheses by code-point before persistence", () => {
    const mk = (hypothesisType: string) => ({
      id: hypothesisType,
      organizationId: "org",
      cycleEnvelopeId: "env",
      runId: "run",
      cycleId: "0",
      symbol: "BTC/USDT",
      evaluatedAt: "t",
      hypothesisType,
      hypothesisStatus: "EMITTED",
      confidenceValue: "0.1",
      thesisDigest: "a",
      evidenceDigest: "b",
      miHypothesisId: null,
      authoritativeLinkDigest: "c",
      contentDigest: "d",
      schemaVersion: HYPOTHESIS_RECORD_SCHEMA_VERSION,
    });
    const sorted = sortHypothesesByTypeCodePoint([
      mk("trend_continuation"),
      mk("accumulation"),
      mk("mean_reversion"),
    ]);
    expect(sorted.map((row) => row.hypothesisType)).toEqual([
      "accumulation",
      "mean_reversion",
      "trend_continuation",
    ]);
  });
});
