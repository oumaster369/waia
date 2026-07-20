import { describe, expect, it } from "vitest";
import { sortForecastsByKeyDigestCodePoint } from "@/lib/trader/intelligence/forecast-decision/serialize-forecast-decision";
import { FORECAST_RECORD_SCHEMA_VERSION } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";

describe("trader wp14 atomic bundle", () => {
  it("orders forecasts by forecast_key_digest code-point before persistence", () => {
    const mk = (digest: string) => ({
      id: digest,
      organizationId: "org",
      cycleEnvelopeId: "env",
      hypothesisRecordId: "hyp",
      convictionRecordId: "conv",
      runId: "run",
      cycleId: "0",
      symbol: "BTC/USDT",
      forecastKeyDigest: digest,
      evaluatedAt: "t",
      issuedAt: "t",
      evidenceCutoffAt: "t",
      targetWindowStartAt: "t",
      targetWindowEndAt: "t2",
      marketQuestion: "q",
      invalidationConditionsJson: "[]",
      scenarioSetJson: "{}",
      forecastConfidenceJson: "{}",
      historicalProfileId: "profile",
      historicalProfileDigest: "a".repeat(64),
      matrixDigest: "b".repeat(64),
      evidenceDigest: "c".repeat(64),
      authoritativeLinkDigest: "d".repeat(64),
      forecastModelVersion: "v1",
      contentDigest: "e".repeat(64),
      schemaVersion: FORECAST_RECORD_SCHEMA_VERSION,
    });
    const sorted = sortForecastsByKeyDigestCodePoint([
      mk("f".repeat(64)),
      mk("a".repeat(64)),
      mk("c".repeat(64)),
    ]);
    expect(sorted.map((row) => row.forecastKeyDigest)).toEqual([
      "a".repeat(64),
      "c".repeat(64),
      "f".repeat(64),
    ]);
  });
});
