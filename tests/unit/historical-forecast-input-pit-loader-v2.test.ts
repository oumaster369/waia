import { describe, expect, it, vi } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HISTORICAL_DATASET_MEMBERSHIP_V2 } from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";
import { HISTORICAL_FORECAST_INPUT_PIT_V2 } from "@/lib/trader/historical-simulation-v2/pit-forecast-input-producer-v2";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

const mocked = vi.hoisted(() => ({ issue: vi.fn() }));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", () => ({
  issueForecastRuntimeV2: mocked.issue,
  reviveForecastRuntimeJsonV2: (value: unknown) => value,
}));
vi.mock("@/lib/trader/research/execopp-qualification/scientific-admission-v2", () => ({
  requireScientificAdmissionV2: vi.fn(),
}));

import { assertHistoricalForecastInputPitBindingV2 } from "@/lib/trader/historical-simulation-v2/pit-forecast-input-loader-v2";

const digest = "a".repeat(64);
const pit = "2026-08-01T00:01:00.000Z";
process.env.WAIA_RELEASE_SHA = "1".repeat(40);
const authorityDigest = "b".repeat(64);
const membershipBody = { schemaVersion: HISTORICAL_DATASET_MEMBERSHIP_V2, organizationId: "org", cycleId: "cycle",
  manifestSemanticDigestHex: "1".repeat(64), sealReceiptDigestHex: "2".repeat(64), partitionDigestHex: "3".repeat(64),
  partitionRawSha256Hex: "4".repeat(64), partition: "DEVELOPMENT" as const, symbol: "BTCUSDT" as const,
  recordIndex: 0, barContentDigestHex: "5".repeat(64), sealedCycleContentDigestHex: "6".repeat(64) };
const datasetMembership = { ...membershipBody, contentDigestHex: computeSemanticSha256Hex(membershipBody) };
const sealedCycle = { cycleId: "cycle", contentDigestHex: "6".repeat(64) };
const datasetAuthorityDigest = computeStableJsonDigest({ organizationId: "org", runId: "run",
  membership: datasetMembership, sealedCycle });
const expected = {
  organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast", symbol: "BTCUSDT" as const,
  pitAnchor: pit, knowledgeContentDigestHex: digest, forecastAuthorityContentDigestHex: authorityDigest,
  datasetAuthorityId: "dataset-authority",
};
const runtimeInput = {
  predictiveAdmissionReceipt: { pitAnchor: pit },
  marketStateSnapshot: { organizationId: "org", symbol: "BTC/USDT", pitAnchor: pit },
  forecastContractBinding: { organizationId: "org", contentDigestHex: "c".repeat(64),
    selectedPredictivePackageContentDigestHex: "d".repeat(64),
    scientificAdmissionReceiptContentDigestHex: "e".repeat(64) }, predictivePackage: {},
  executionHorizonMinutes: 1, normalizationVersionDigestHex: digest,
  knowledgeEdgeId: "edge", knowledgeContentDigestHex: digest,
};
const replayOutcome = { status: "FORECAST_AUTHORIZED", authority: {
  organizationId: "org", anchorClosedBarAt: pit, knowledgeContentDigestHex: digest,
  contentDigestHex: authorityDigest,
}, issuance: { forecastContentDigestExec: Buffer.from("f".repeat(64), "hex") } };
const scientificReceipt = { contentDigestHex: "e".repeat(64), organizationId: "org",
  predictiveTerminalReceipt: { developmentDatasetDigestHex: digest, targetGridReceiptDigestHex: digest,
    predictivePackageGenerationIdentityDigestHex: digest, predictivePackageContentDigestHex: "d".repeat(64),
    runtimeContractDigestHex: digest, scoringContractVersion: "v", evaluationPartitionReceiptDigestHex: digest,
    contentDigestHex: digest }, kmConvergenceReceipt: { evidenceSemanticDigestHex: digest },
  epistemicParameterRatificationReceipt: { contentDigestHex: digest } };
const row = (patch: Record<string, unknown> = {}) => {
 const base = {
  organization_id: "org", run_id: "run", cycle_id: "cycle", forecast_id: "forecast", symbol: "BTCUSDT",
  forecast_target_role_id: "EXECUTION_OPPORTUNITY", forecast_content_digest_hex: "f".repeat(64),
  bundle_id: "bundle", runtime_input_source_id: "source", dataset_authority_digest_hex: "2".repeat(64),
  verifier_build_digest_hex: computeSemanticSha256Hex({ verifierVersion:
    "waia.forecast-runtime-input-source.verifier.v2", sourceSha: "1".repeat(40) }),
  partition: "DEVELOPMENT", record_index: 0, dataset_membership_content_digest_hex: datasetMembership.contentDigestHex,
  dataset_membership_json: datasetMembership,
  pit_anchor: pit, visible_from: pit, knowledge_content_digest_hex: digest,
  forecast_authority_content_digest_hex: authorityDigest, runtime_input_json: runtimeInput,
  dataset_authority_id: "dataset-authority", dataset_authority_content_digest_hex: datasetAuthorityDigest,
  sealed_cycle_json: sealedCycle, runtime_input_content_digest_hex: computeSemanticSha256Hex(runtimeInput),
  source_runtime_input_json: runtimeInput, source_authorized_outcome_json: replayOutcome,
  source_forecast_authority_content_digest_hex: authorityDigest,
  source_verifier_build_digest_hex: computeSemanticSha256Hex({ verifierVersion:
    "waia.forecast-runtime-input-source.verifier.v2", sourceSha: "1".repeat(40) }),
  canonical_authorized_outcome_json: replayOutcome, canonical_forecast_content_digest_hex: "f".repeat(64),
  canonical_package_content_digest_hex: "d".repeat(64), canonical_scientific_content_digest_hex: "e".repeat(64),
  canonical_scientific_receipt_json: JSON.stringify(scientificReceipt), canonical_binding_content_digest_hex: "c".repeat(64),
  schema_version: HISTORICAL_FORECAST_INPUT_PIT_V2,
 };
 const merged = { ...base, ...patch };
 const body = { schemaVersion: merged.schema_version, organizationId: merged.organization_id, runId: merged.run_id,
   cycleId: merged.cycle_id, forecastId: merged.forecast_id, bundleId: merged.bundle_id,
   forecastTargetRoleId: merged.forecast_target_role_id,
   forecastContentDigestHex: merged.forecast_content_digest_hex,
   runtimeInputSourceId: merged.runtime_input_source_id, datasetAuthorityId: merged.dataset_authority_id,
   datasetAuthorityDigestHex: merged.dataset_authority_digest_hex, datasetMembership: merged.dataset_membership_json,
   symbol: merged.symbol, pitAnchor: merged.pit_anchor, visibleFrom: merged.visible_from,
   knowledgeContentDigestHex: merged.knowledge_content_digest_hex,
   forecastAuthorityContentDigestHex: merged.forecast_authority_content_digest_hex,
   runtimeInputContentDigestHex: merged.runtime_input_content_digest_hex,
   verifierBuildDigestHex: merged.verifier_build_digest_hex, runtimeInput: merged.runtime_input_json };
 return { ...merged, content_digest_hex: patch.content_digest_hex ?? computeSemanticSha256Hex(body) };
};

describe("historical Forecast V2 exact PIT input loader", () => {
  it("accepts only an exact scope/PIT/knowledge row whose authority replay agrees", () => {
    mocked.issue.mockReturnValue(replayOutcome);
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
    expect(() => assertHistoricalForecastInputPitBindingV2(row({ runtime_input_json: substituted }) as never, expected)).toThrow("SCOPE_OR_PIT_MISMATCH");
  });

  it("rejects an altered row digest and substituted dataset membership", () => {
    expect(() => assertHistoricalForecastInputPitBindingV2(row({ content_digest_hex: "f".repeat(64) }) as never, expected)).toThrow("ROW_DIGEST_MISMATCH");
    expect(() => assertHistoricalForecastInputPitBindingV2(row({ dataset_membership_json: { ...datasetMembership, recordIndex: 2 } }) as never, expected)).toThrow("SCOPE_OR_PIT_MISMATCH");
  });

  it("rejects substitution of the execution Forecast role or canonical content digest", () => {
    expect(() => assertHistoricalForecastInputPitBindingV2(
      row({ forecast_target_role_id: "TERMINAL_RETURN" }) as never, expected,
    )).toThrow("SCOPE_OR_PIT_MISMATCH");
    expect(() => assertHistoricalForecastInputPitBindingV2(
      row({ forecast_content_digest_hex: "0".repeat(64) }) as never, expected,
    )).toThrow("FORECAST_MEMBER_MISMATCH");
  });

  it("compares JSON semantically while rejecting a disagreeing deployment SHA", () => {
    mocked.issue.mockReturnValue(replayOutcome);
    const reordered = Object.fromEntries(Object.entries(runtimeInput).reverse());
    expect(assertHistoricalForecastInputPitBindingV2(row({ source_runtime_input_json: reordered }) as never, expected)).toEqual(runtimeInput);
    process.env.VERCEL_GIT_COMMIT_SHA = "2".repeat(40);
    expect(() => assertHistoricalForecastInputPitBindingV2(row() as never, expected)).toThrow("BUILD_SHA_CONFLICT");
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });
});
