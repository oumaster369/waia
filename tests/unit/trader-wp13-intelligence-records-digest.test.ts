import { describe, expect, it } from "vitest";
import { computeCycleEnvelopeContentDigest, canonicalizeCycleEnvelope } from "@/lib/trader/intelligence/records/serialize-intelligence-records";
import { CYCLE_ENVELOPE_SCHEMA_VERSION } from "@/lib/trader/intelligence/records/intelligence-records.types";

describe("trader wp13 intelligence records digest", () => {
  it("excludes created_at and recomputes envelope digest", () => {
    const record = {
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "org",
      runId: "run",
      cycleId: "0",
      symbol: "BTC/USDT",
      evaluatedAt: "2024-01-01T00:00:00.000Z",
      historicalProfileId: "HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1",
      historicalProfileDigest: "a".repeat(64),
      matrixDigest: "b".repeat(64),
      terminalReasonCode: "NO_TRADE",
      inputCausalBundleJson: null,
      inputSemanticDigest: "c".repeat(64),
      outputSemanticDigest: "d".repeat(64),
      contentDigest: "",
      schemaVersion: CYCLE_ENVELOPE_SCHEMA_VERSION,
    };
    const digest = computeCycleEnvelopeContentDigest(record);
    expect(digest).toHaveLength(64);
    expect(canonicalizeCycleEnvelope(record)).not.toHaveProperty("created_at");
  });
});
