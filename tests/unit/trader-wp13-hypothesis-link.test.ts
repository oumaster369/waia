import { describe, expect, it } from "vitest";
import { deriveAuthoritativeHypothesisLinkDigest, deriveHypothesisRecordId } from "@/lib/trader/intelligence/hypothesis/hypothesis-link";

describe("trader wp13 hypothesis link", () => {
  const input = {
    organizationId: "org",
    runId: "run",
    cycleId: "1",
    symbol: "BTC/USDT",
    evaluatedAt: "2024-01-01T00:00:00.000Z",
    hypothesisType: "mean_reversion",
    thesisDigest: "a".repeat(64),
    evidenceDigest: "b".repeat(64),
  };

  it("derives deterministic link digest and record id", () => {
    const d1 = deriveAuthoritativeHypothesisLinkDigest(input);
    const d2 = deriveAuthoritativeHypothesisLinkDigest(input);
    expect(d1).toBe(d2);
    expect(deriveHypothesisRecordId(input)).toBe(deriveHypothesisRecordId(input));
  });
});
