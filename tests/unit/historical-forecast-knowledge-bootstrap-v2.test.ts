import { describe, expect, it } from "vitest";

import {
  assertHistoricalForecastKnowledgeBootstrapDurableRowV2,
  buildHistoricalForecastKnowledgeBootstrapV2,
} from
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

  it("requires the exact durable edge bytes", () => {
    const edge = buildHistoricalForecastKnowledgeBootstrapV2(input);
    const row = {
      from_ref: edge.fromRef, to_ref: edge.toRef, relation_kind: edge.relationKind,
      confidence: edge.confidence, strength: edge.strength, regime_scope: edge.regimeScope,
      failure_cases_json: edge.failureCasesJson, hypothesis_id: null, verified: edge.verified,
    };
    expect(() => assertHistoricalForecastKnowledgeBootstrapDurableRowV2(edge, row))
      .not.toThrow();
    expect(() => assertHistoricalForecastKnowledgeBootstrapDurableRowV2(edge, undefined))
      .toThrowError("HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_REFUSED:DURABLE_LINEAGE");
    expect(() => assertHistoricalForecastKnowledgeBootstrapDurableRowV2(edge, {
      ...row, to_ref: "market-horizon:ETHUSDT:30m",
    })).toThrowError("HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_REFUSED:DURABLE_LINEAGE");
    expect(() => assertHistoricalForecastKnowledgeBootstrapDurableRowV2(edge, {
      ...row, verified: true,
    })).toThrowError("HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_REFUSED:DURABLE_LINEAGE");
    expect(() => assertHistoricalForecastKnowledgeBootstrapDurableRowV2(edge, {
      ...row, hypothesis_id: "00000000-0000-4000-8000-000000000099",
    })).toThrowError("HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_REFUSED:DURABLE_LINEAGE");
  });
});
