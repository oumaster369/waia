import { describe, expect, it, vi } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2 } from "@/lib/trader/historical-simulation-v2/knowledge-port-postgres";

const mocked = vi.hoisted(() => ({ issue: vi.fn(), readBinding: vi.fn() }));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", () => ({ issueForecastRuntimeV2: mocked.issue }));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1", () => ({ readForecastContractBindingV1: mocked.readBinding }));

import { createPostgresHistoricalForecastInputPitProducerV2 } from "@/lib/trader/historical-simulation-v2/pit-forecast-input-producer-v2";

const pit = "2026-08-01T00:01:00.000Z";
const knowledge = computeSemanticSha256Hex({
  schemaVersion: HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2,
  organizationId: "org", symbol: "BTCUSDT", visibleEvidence: [],
});
const binding = {
  organizationId: "org", scientificAdmissionReceiptId: "receipt",
  scientificAdmissionReceiptContentDigestHex: "b".repeat(64),
  selectedPredictivePackageContentDigestHex: "c".repeat(64),
};
const runtimeInput = { forecastContractBinding: binding, knowledgeContentDigestHex: knowledge };

function sqlHarness(options: { knowledgeRows?: unknown[]; persistedDigest?: string; bindingVisible?: boolean } = {}) {
  let insertedDigest = options.persistedDigest;
  const sql = Object.assign(vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(" ");
    if (query.includes("FROM trader_forecast_v2")) return [{
      organization_id: "org", run_id: "run", cycle_id: "cycle", symbol: "BTCUSDT",
      anchor_epoch_ms: Date.parse(pit),
      authorized_outcome: { status: "FORECAST_AUTHORIZED", authority: { contentDigestHex: "a".repeat(64) } },
    }];
    if (query.includes("FROM trader_forecast_contract_binding_v1 cb")) return options.bindingVisible === false ? [] : [{ content_digest: undefined }];
    if (query.includes("FROM trader_scientific_admission_receipt_v1")) return [{
      id: "receipt", content_digest: "b".repeat(64), selected_package_content_digest: "c".repeat(64),
    }];
    if (query.includes("FROM trader_knowledge_confidence_update_record")) return options.knowledgeRows ?? [];
    if (query.includes("INSERT INTO trader_historical_forecast_input_pit_v2")) {
      insertedDigest ??= values.find((value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value) && value !== knowledge && value !== "a".repeat(64)) as string;
      return [];
    }
    if (query.includes("SELECT content_digest_hex FROM trader_historical_forecast_input_pit_v2")) return [{ content_digest_hex: insertedDigest }];
    return [];
  }), { json: (value: unknown) => value });
  return sql;
}

describe("historical Forecast V2 PIT producer", () => {
  it("persists an idempotent row only after canonical Forecast/scientific/knowledge replay", async () => {
    mocked.issue.mockReturnValue({ status: "FORECAST_AUTHORIZED", authority: {
      organizationId: "org", anchorClosedBarAt: pit, knowledgeContentDigestHex: knowledge,
      contentDigestHex: "a".repeat(64),
    } });
    mocked.readBinding.mockResolvedValue(binding);
    const sql = sqlHarness();
    const record = await createPostgresHistoricalForecastInputPitProducerV2(sql as never)({
      organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, runtimeInput: runtimeInput as never,
    });
    expect(record).toMatchObject({ visibleFrom: pit, knowledgeContentDigestHex: knowledge });
    expect(record.contentDigestHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects knowledge evidence that becomes visible after the cycle PIT", async () => {
    mocked.issue.mockReturnValue({ status: "FORECAST_AUTHORIZED", authority: {
      organizationId: "org", anchorClosedBarAt: pit, knowledgeContentDigestHex: knowledge,
      contentDigestHex: "a".repeat(64),
    } });
    mocked.readBinding.mockResolvedValue(binding);
    const sql = sqlHarness({ knowledgeRows: [{
      id: "k", knowledge_edge_id: "e", content_digest: "d".repeat(64), resolved_at: pit,
      pit_evidence_boundary: pit, source_record_ids_json: JSON.stringify({
        visible_from_cycle_pit_anchor: "2026-08-01T00:02:00.000Z",
        forecast_runtime_authority_content_digest_hex: "e".repeat(64),
        forecast_outcome_content_digest_hex: "f".repeat(64),
      }),
    }] });
    await expect(createPostgresHistoricalForecastInputPitProducerV2(sql as never)({
      organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, runtimeInput: runtimeInput as never,
    })).rejects.toThrow("KNOWLEDGE_SOURCE");
  });

  it("rejects a contract binding or package that was not durable by the PIT", async () => {
    mocked.issue.mockReturnValue({ status: "FORECAST_AUTHORIZED", authority: {
      organizationId: "org", anchorClosedBarAt: pit, knowledgeContentDigestHex: knowledge,
      contentDigestHex: "a".repeat(64),
    } });
    mocked.readBinding.mockResolvedValue(binding);
    await expect(createPostgresHistoricalForecastInputPitProducerV2(sqlHarness({ bindingVisible: false }) as never)({
      organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, runtimeInput: runtimeInput as never,
    })).rejects.toThrow("FUTURE_BINDING_OR_PACKAGE");
  });

  it("rejects a conflicting durable row instead of overwriting it", async () => {
    mocked.issue.mockReturnValue({ status: "FORECAST_AUTHORIZED", authority: {
      organizationId: "org", anchorClosedBarAt: pit, knowledgeContentDigestHex: knowledge,
      contentDigestHex: "a".repeat(64),
    } });
    mocked.readBinding.mockResolvedValue(binding);
    const sql = sqlHarness({ persistedDigest: "9".repeat(64) });
    await expect(createPostgresHistoricalForecastInputPitProducerV2(sql as never)({
      organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, runtimeInput: runtimeInput as never,
    })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
});
