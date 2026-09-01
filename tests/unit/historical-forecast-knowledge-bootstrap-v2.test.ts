import { describe, expect, it } from "vitest";

import { buildHistoricalForecastKnowledgeBootstrapV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-knowledge-bootstrap-v2";

const input = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  symbol: "BTCUSDT",
  horizonMinutes: 30,
  predictivePackageContentDigestHex: "a".repeat(64),
} as const;

describe("historical Forecast cold-start Knowledge authority v2", () => {
  it("creates a stable neutral unverified model claim", () => {
    const first = buildHistoricalForecastKnowledgeBootstrapV2(input);
    expect(first).toEqual(buildHistoricalForecastKnowledgeBootstrapV2(input));
    expect(first.knowledgeEdgeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.confidence).toBe("0.50000000");
    expect(first.strength).toBe("0.00000000");
    expect(first.verified).toBe(false);
  });

  it("separates package and horizon identities", () => {
    const first = buildHistoricalForecastKnowledgeBootstrapV2(input);
    expect(buildHistoricalForecastKnowledgeBootstrapV2({ ...input, horizonMinutes: 60 }).knowledgeEdgeId)
      .not.toBe(first.knowledgeEdgeId);
    expect(buildHistoricalForecastKnowledgeBootstrapV2({ ...input,
      predictivePackageContentDigestHex: "b".repeat(64) }).knowledgeEdgeId)
      .not.toBe(first.knowledgeEdgeId);
  });
});
