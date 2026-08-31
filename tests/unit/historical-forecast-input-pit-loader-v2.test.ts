import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ issue: vi.fn() }));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", () => ({
  issueForecastRuntimeV2: mocked.issue,
}));

import { assertHistoricalForecastInputPitBindingV2 } from "@/lib/trader/historical-simulation-v2/pit-forecast-input-loader-v2";

const digest = "a".repeat(64);
const pit = "2026-08-01T00:01:00.000Z";
const expected = {
  organizationId: "org", runId: "run", cycleId: "cycle", symbol: "BTCUSDT" as const,
  pitAnchor: pit, knowledgeContentDigestHex: digest,
};
const runtimeInput = {
  predictiveAdmissionReceipt: { pitAnchor: pit },
  marketStateSnapshot: { organizationId: "org", symbol: "BTC/USDT", pitAnchor: pit },
  forecastContractBinding: { organizationId: "org" }, predictivePackage: {},
  executionHorizonMinutes: 1, normalizationVersionDigestHex: digest,
  knowledgeEdgeId: "edge", knowledgeContentDigestHex: digest,
};
const row = (patch: Record<string, unknown> = {}) => ({
  organization_id: "org", run_id: "run", cycle_id: "cycle", symbol: "BTCUSDT",
  pit_anchor: pit, visible_from: pit, knowledge_content_digest_hex: digest,
  runtime_input_json: runtimeInput, ...patch,
});

describe("historical Forecast V2 exact PIT input loader", () => {
  it("accepts only an exact scope/PIT/knowledge row whose authority replay agrees", () => {
    mocked.issue.mockReturnValue({ status: "FORECAST_AUTHORIZED", authority: {
      organizationId: "org", anchorClosedBarAt: pit, knowledgeContentDigestHex: digest,
    } });
    expect(assertHistoricalForecastInputPitBindingV2(row() as never, expected)).toBe(runtimeInput);
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
});

