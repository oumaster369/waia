import type { Bar } from "@/lib/trader/intelligence/types";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import type { OutcomeProvenance } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { FORECAST_RECORD_SCHEMA_VERSION } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { TraderIntelligenceForecastRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";

export const WP21_ORG = "00000000-0000-4000-8021-000000000001";

export function wp21Provenance(): OutcomeProvenance {
  return {
    codeSha: "wp21-test-sha",
    datasetContentDigest: "d".repeat(64),
    profileDigest: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1",
  };
}

export function wp21Bars(input: { startMs?: number; count?: number; step?: number }): Bar[] {
  const startMs = input.startMs ?? Date.UTC(2024, 0, 1, 0, 0);
  const count = input.count ?? 120;
  const step = input.step ?? 0.5;
  return Array.from({ length: count }, (_, i) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: String(100 + i * step),
    high: String(101 + i * step),
    low: String(99 + i * step),
    close: String(100 + i * step),
    volume: "1",
    barOpenTime: new Date(startMs + i * 60_000).toISOString(),
    barCloseTime: new Date(startMs + (i + 1) * 60_000).toISOString(),
  }));
}

export function buildWp21ForecastFixture(
  overrides: Partial<TraderIntelligenceForecastRecord> = {},
): TraderIntelligenceForecastRecord {
  const issuedAt = "2024-01-01T00:00:00.000Z";
  const targetWindowEndAt = "2024-01-01T01:00:00.000Z";
  return {
    id: "00000000-0000-4000-8021-000000000010",
    organizationId: WP21_ORG,
    cycleEnvelopeId: "00000000-0000-4000-8021-000000000011",
    hypothesisRecordId: "00000000-0000-4000-8021-000000000012",
    convictionRecordId: "00000000-0000-4000-8021-000000000013",
    runId: "wp21-run",
    cycleId: "0",
    symbol: "BTC/USDT",
    forecastKeyDigest: "a".repeat(64),
    evaluatedAt: issuedAt,
    issuedAt,
    evidenceCutoffAt: issuedAt,
    targetWindowStartAt: issuedAt,
    targetWindowEndAt,
    marketQuestion: "test",
    invalidationConditionsJson: "[]",
    scenarioSetJson: JSON.stringify({ expected_path: "continuation_higher" }),
    forecastConfidenceJson: JSON.stringify({ confidence_value: "0.7000" }),
    historicalProfileId: "htr-historical-intelligence-profile-v1",
    historicalProfileDigest: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    matrixDigest: "b".repeat(64),
    evidenceDigest: "c".repeat(64),
    authoritativeLinkDigest: "d".repeat(64),
    forecastModelVersion: "waia.trader.forecast_model.v1",
    contentDigest: "e".repeat(64),
    schemaVersion: FORECAST_RECORD_SCHEMA_VERSION,
    ...overrides,
  };
}
