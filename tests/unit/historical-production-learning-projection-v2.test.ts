import { describe, expect, it, vi } from "vitest";

import {
  loadHistoricalProductionLearningProjectionV2,
  loadHistoricalProductionPendingForecastsV2,
} from "@/lib/trader/historical-simulation-v2/production-learning-projection-v2";

const digest = (character: string) => character.repeat(64);
const pit = "2026-09-01T00:40:00.000Z";
const matured = "2026-09-01T00:39:00.000Z";
const eligible = "2026-09-01T00:38:00.000Z";

function sqlHarness() {
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("FROM trader_knowledge_confidence_update_record")) {
      return [{
        content_digest: digest("c"),
        eligible_resolution_at: eligible,
        resolved_at: matured,
        source_record_ids_json: JSON.stringify({
          forecast_runtime_authority_content_digest_hex: digest("a"),
          forecast_outcome_content_digest_hex: digest("b"),
          calibration_observation_content_digest: digest("d"),
          visible_from_cycle_pit_anchor: pit,
        }),
      }];
    }
    if (query.includes("FROM trader_forecast_calibration_observation_v2")) {
      if (!query.includes("encode(content_digest, 'hex')")) {
        throw new Error("calibration bytea digest must be compared as canonical hex");
      }
      return [{ content_digest: digest("d") }];
    }
    if (query.includes("FROM trader_forecast_bundle_v2")) {
      return [{ authority_digest: digest("e") }, { authority_digest: digest("f") }];
    }
    throw new Error(`unexpected query: ${query}`);
  });
  return sql as never;
}

describe("Historical production learning projection V2", () => {
  it("projects one durable strictly-prior closure as APPLIED", async () => {
    await expect(loadHistoricalProductionLearningProjectionV2({
      sql: sqlHarness(),
      organizationId: "11111111-1111-4111-8111-111111111111",
      runId: "run",
      symbol: "BTCUSDT",
      pitAnchor: pit,
      closures: [{
        forecastAuthorityContentDigestHex: digest("a"),
        outcomeContentDigestHex: digest("b"),
        maturedAt: matured,
      }],
    })).resolves.toEqual({
      status: "APPLIED",
      reasonCodes: [],
      calibrationObservationContentDigestHex: digest("d"),
      knowledgeUpdateContentDigestHex: digest("c"),
      eligibleResolutionAtUtc: eligible,
      visibleFromPitAnchorUtc: pit,
    });
  });

  it("keeps a cycle PENDING when no terminal outcome is eligible", async () => {
    await expect(loadHistoricalProductionLearningProjectionV2({
      sql: sqlHarness(),
      organizationId: "11111111-1111-4111-8111-111111111111",
      runId: "run",
      symbol: "BTCUSDT",
      pitAnchor: pit,
      closures: [],
    })).resolves.toMatchObject({
      status: "PENDING",
      calibrationObservationContentDigestHex: null,
      knowledgeUpdateContentDigestHex: null,
    });
  });

  it("refuses to collapse a learning backlog into the scalar v2 ledger", async () => {
    const closure = {
      forecastAuthorityContentDigestHex: digest("a"),
      outcomeContentDigestHex: digest("b"),
      maturedAt: matured,
    };
    await expect(loadHistoricalProductionLearningProjectionV2({
      sql: sqlHarness(),
      organizationId: "11111111-1111-4111-8111-111111111111",
      runId: "run",
      symbol: "BTCUSDT",
      pitAnchor: pit,
      closures: [closure, { ...closure, forecastAuthorityContentDigestHex: digest("9") }],
    })).rejects.toThrow("MULTIPLE_CLOSURES_REQUIRE_LEDGER_V3");
  });

  it("restores the full durable pending Forecast set in issuance order", async () => {
    await expect(loadHistoricalProductionPendingForecastsV2({
      sql: sqlHarness(),
      organizationId: "11111111-1111-4111-8111-111111111111",
      runId: "run",
    })).resolves.toEqual([digest("e"), digest("f")]);
  });
});
