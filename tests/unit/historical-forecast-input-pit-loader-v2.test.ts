import { describe, expect, it, vi } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HISTORICAL_DATASET_MEMBERSHIP_V2 } from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";
import { HISTORICAL_FORECAST_INPUT_PIT_V2 } from "@/lib/trader/historical-simulation-v2/pit-forecast-input-producer-v2";

const mocked = vi.hoisted(() => ({ issue: vi.fn() }));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", () => ({
  issueForecastRuntimeV2: mocked.issue,
}));

import { assertHistoricalForecastInputPitBindingV2 } from "@/lib/trader/historical-simulation-v2/pit-forecast-input-loader-v2";

const digest = "a".repeat(64);
const pit = "2026-08-01T00:01:00.000Z";
const authorityDigest = "b".repeat(64);
const membershipBody = { schemaVersion: HISTORICAL_DATASET_MEMBERSHIP_V2, organizationId: "org", cycleId: "cycle",
  manifestSemanticDigestHex: "1".repeat(64), sealReceiptDigestHex: "2".repeat(64), partitionDigestHex: "3".repeat(64),
  partitionRawSha256Hex: "4".repeat(64), partition: "DEVELOPMENT" as const, symbol: "BTCUSDT" as const,
  recordIndex: 0, barContentDigestHex: "5".repeat(64), sealedCycleContentDigestHex: "6".repeat(64) };
const datasetMembership = { ...membershipBody, contentDigestHex: computeSemanticSha256Hex(membershipBody) };
const expected = {
  organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast", symbol: "BTCUSDT" as const,
  pitAnchor: pit, knowledgeContentDigestHex: digest, forecastAuthorityContentDigestHex: authorityDigest, datasetMembership,
};
const runtimeInput = {
  predictiveAdmissionReceipt: { pitAnchor: pit },
  marketStateSnapshot: { organizationId: "org", symbol: "BTC/USDT", pitAnchor: pit },
  forecastContractBinding: { organizationId: "org" }, predictivePackage: {},
  executionHorizonMinutes: 1, normalizationVersionDigestHex: digest,
  knowledgeEdgeId: "edge", knowledgeContentDigestHex: digest,
};
const row = (patch: Record<string, unknown> = {}) => {
 const base = {
  organization_id: "org", run_id: "run", cycle_id: "cycle", forecast_id: "forecast", symbol: "BTCUSDT",
  partition: "DEVELOPMENT", record_index: 0, dataset_membership_content_digest_hex: datasetMembership.contentDigestHex,
  dataset_membership_json: datasetMembership,
  pit_anchor: pit, visible_from: pit, knowledge_content_digest_hex: digest,
  forecast_authority_content_digest_hex: authorityDigest, runtime_input_json: runtimeInput,
  schema_version: HISTORICAL_FORECAST_INPUT_PIT_V2,
 };
 const merged = { ...base, ...patch };
 const body = { schemaVersion: merged.schema_version, organizationId: merged.organization_id, runId: merged.run_id,
   cycleId: merged.cycle_id, forecastId: merged.forecast_id, datasetMembership: merged.dataset_membership_json,
   symbol: merged.symbol, pitAnchor: merged.pit_anchor, visibleFrom: merged.visible_from,
   knowledgeContentDigestHex: merged.knowledge_content_digest_hex,
   forecastAuthorityContentDigestHex: merged.forecast_authority_content_digest_hex, runtimeInput: merged.runtime_input_json };
 return { ...merged, content_digest_hex: patch.content_digest_hex ?? computeSemanticSha256Hex(body) };
};

describe("historical Forecast V2 exact PIT input loader", () => {
  it("accepts only an exact scope/PIT/knowledge row whose authority replay agrees", () => {
    mocked.issue.mockReturnValue({ status: "FORECAST_AUTHORIZED", authority: {
      organizationId: "org", anchorClosedBarAt: pit, knowledgeContentDigestHex: digest,
      contentDigestHex: authorityDigest,
    } });
    const result = assertHistoricalForecastInputPitBindingV2(row() as never, expected);
    expect(result).toEqual(runtimeInput);
    expect(result).not.toBe(runtimeInput);
    expect(Object.isFrozen(result.marketStateSnapshot)).toBe(true);
  });

  it.each([
    ["future visibility", { visible_from: "2026-08-01T00:02:00.000Z" }],
    ["wrong organization", { organization_id: "other" }],
    ["wrong run", { run_id: "other" }],
    ["wrong cycle", { cycle_id: "other" }],
    ["wrong symbol", { symbol: "ETHUSDT" }],
    ["wrong knowledge", { knowledge_content_digest_hex: "b".repeat(64) }],
  ])("rejects %s", (_name, patch) => {
    expect(() => assertHistoricalForecastInputPitBindingV2(row(patch) as never, expected)).toThrow("SCOPE_OR_PIT_MISMATCH");
  });

  it("rejects a runtime input substituted behind exact row metadata", () => {
    const substituted = { ...runtimeInput, knowledgeContentDigestHex: "b".repeat(64) };
    expect(() => assertHistoricalForecastInputPitBindingV2(row({ runtime_input_json: substituted }) as never, expected)).toThrow("INPUT_BINDING_MISMATCH");
  });

  it("rejects an altered row digest and substituted dataset membership", () => {
    expect(() => assertHistoricalForecastInputPitBindingV2(row({ content_digest_hex: "f".repeat(64) }) as never, expected)).toThrow("ROW_DIGEST_MISMATCH");
    expect(() => assertHistoricalForecastInputPitBindingV2(row({ dataset_membership_json: { ...datasetMembership, recordIndex: 2 } }) as never, expected)).toThrow("SCOPE_OR_PIT_MISMATCH");
  });
});
