import { describe, expect, it, vi } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2 } from "@/lib/trader/historical-simulation-v2/knowledge-port-postgres";
import { HISTORICAL_DATASET_MEMBERSHIP_V2 } from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { buildHistoricalKnowledgeSnapshotAuthorityV2 } from
  "@/lib/trader/intelligence/forecast-v2/historical-knowledge-snapshot-authority-v2";

const mocked = vi.hoisted(() => ({ issue: vi.fn(), requireOutcome: vi.fn((value) => value),
  readBinding: vi.fn(), requireScientific: vi.fn(), verifyInformation: vi.fn() }));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", () => ({
  issueForecastRuntimeV2: mocked.issue, requireForecastRuntimeAuthorizedOutcomeV2: mocked.requireOutcome,
  reviveForecastRuntimeJsonV2: (value: unknown) => value,
}));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1", () => ({ readForecastContractBindingV1: mocked.readBinding }));
vi.mock("@/lib/trader/research/execopp-qualification/scientific-admission-v2", () => ({ requireScientificAdmissionV2: mocked.requireScientific }));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service", () => ({
  verifyHistoricalForecastInformationProofV2: mocked.verifyInformation,
}));

import { createPostgresHistoricalForecastInputPitProducerV2 } from "@/lib/trader/historical-simulation-v2/pit-forecast-input-producer-v2";

const pit = "2026-08-01T00:01:00.000Z";
process.env.WAIA_RELEASE_SHA = "1".repeat(40);
const knowledge = computeSemanticSha256Hex({
  schemaVersion: HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2,
  organizationId: "org", symbol: "BTCUSDT", visibleEvidence: [],
});
const binding = {
  organizationId: "org", scientificAdmissionReceiptId: "receipt",
  scientificAdmissionReceiptContentDigestHex: "b".repeat(64),
  selectedPredictivePackageContentDigestHex: "c".repeat(64),
};
const runtimeInput = {
  forecastContractBinding: binding,
  knowledgeContentDigestHex: knowledge,
  historicalKnowledgeSnapshotAuthority: buildHistoricalKnowledgeSnapshotAuthorityV2({
    organizationId: "org",
    runId: "run",
    symbol: "BTCUSDT",
    pitAnchor: pit,
    visibleEvidenceCount: 0,
    knowledgeContentDigestHex: knowledge,
  }),
};
const membershipBody = {
  schemaVersion: HISTORICAL_DATASET_MEMBERSHIP_V2, organizationId: "org", cycleId: "cycle",
  manifestSemanticDigestHex: "1".repeat(64), sealReceiptDigestHex: "2".repeat(64),
  partitionDigestHex: "3".repeat(64), partitionRawSha256Hex: "4".repeat(64),
  partition: "DEVELOPMENT" as const, symbol: "BTCUSDT" as const, recordIndex: 0,
  barContentDigestHex: "5".repeat(64), sealedCycleContentDigestHex: "6".repeat(64),
};
const datasetMembership = { ...membershipBody, contentDigestHex: computeSemanticSha256Hex(membershipBody) };
const sealedCycle = { cycleId: "cycle", contentDigestHex: "6".repeat(64) };
const datasetAuthorityDigest = computeStableJsonDigest({ organizationId: "org", runId: "run",
  membership: datasetMembership, sealedCycle });
const scientificReceipt = {
  organizationId: "org", contentDigestHex: "b".repeat(64),
  predictiveTerminalReceipt: {
    developmentDatasetDigestHex: "1".repeat(64), targetGridReceiptDigestHex: "2".repeat(64),
    predictivePackageGenerationIdentityDigestHex: "3".repeat(64), predictivePackageContentDigestHex: "c".repeat(64),
    runtimeContractDigestHex: "4".repeat(64), scoringContractVersion: "multiclass-log-score/v1",
    evaluationPartitionReceiptDigestHex: "5".repeat(64), contentDigestHex: "6".repeat(64),
  },
  kmConvergenceReceipt: { evidenceSemanticDigestHex: "7".repeat(64) },
  epistemicParameterRatificationReceipt: { contentDigestHex: "8".repeat(64) },
};
function authorizedOutcome() {
  return { status: "FORECAST_AUTHORIZED", authority: {
    organizationId: "org", anchorClosedBarAt: pit, knowledgeContentDigestHex: knowledge,
    contentDigestHex: "a".repeat(64),
  }, issuance: { forecastContentDigestExec: Buffer.from("7".repeat(64), "hex") } };
}

function sqlHarness(options: { knowledgeRows?: unknown[]; persistedDigest?: string; bindingVisible?: boolean;
  datasetAuthorityDigest?: string; forecastSchema?: string; persistedOutcome?: unknown } = {}) {
  let insertedDigest = options.persistedDigest;
  const sql = Object.assign(vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join(" ");
    if (query.includes("FROM trader_historical_simulation_run_start_v2")) return [{ started_at: pit }];
    if (query.includes("FROM trader_forecast_runtime_input_source_v2")) return [{
      id: "source", bundle_id: "bundle", runtime_input_json: runtimeInput,
      execution_forecast_target_role_id: "EXECUTION_OPPORTUNITY",
      execution_forecast_content_digest_hex: "7".repeat(64),
      runtime_input_content_digest_hex: computeSemanticSha256Hex(runtimeInput),
      verifier_build_digest_hex: computeSemanticSha256Hex({ verifierVersion:
        "waia.forecast-runtime-input-source.verifier.v2", sourceSha: "1".repeat(40) }),
    }];
    if (query.includes("FROM trader_historical_dataset_authority_v2")) return [{
      membership_json: datasetMembership, sealed_cycle_json: sealedCycle,
      dataset_authority_digest_hex: "2".repeat(64),
      authority_content_digest_hex: options.datasetAuthorityDigest ?? datasetAuthorityDigest,
      membership_content_digest_hex: datasetMembership.contentDigestHex,
      sealed_cycle_content_digest_hex: "6".repeat(64),
    }];
    if (query.includes("FROM trader_forecast_v2")) return [{
      organization_id: "org", run_id: "run", cycle_id: "cycle", symbol: "BTCUSDT",
      forecast_schema: options.forecastSchema ?? "2", forecast_content_digest: "7".repeat(64),
      anchor_epoch_ms: Date.parse(pit),
      authorized_outcome: options.persistedOutcome ?? mocked.issue(),
    }];
    if (query.includes("FROM trader_forecast_contract_binding_v1 cb")) return options.bindingVisible === false ? [] : [{ content_digest: undefined }];
    if (query.includes("FROM trader_scientific_admission_receipt_v1")) return [{
      id: "receipt", content_digest: "b".repeat(64), selected_package_content_digest: "c".repeat(64),
      receipt_json: JSON.stringify(scientificReceipt),
    }];
    if (query.includes("FROM trader_knowledge_confidence_update_record")) return options.knowledgeRows ?? [];
    if (query.includes("INSERT INTO trader_historical_forecast_input_pit_v2")) {
      insertedDigest ??= values.at(-2) as string;
      return [];
    }
    if (query.includes("SELECT content_digest_hex FROM trader_historical_forecast_input_pit_v2")) return [{ content_digest_hex: insertedDigest }];
    return [];
  }), { json: (value: unknown) => value });
  Object.assign(sql, { begin: async (_level: string, callback: (tx: unknown) => unknown) => callback(sql) });
  return sql;
}

describe("historical Forecast V2 PIT producer", () => {
  mocked.requireScientific.mockImplementation((value) => value);
  it("persists an idempotent row only after canonical Forecast/scientific/knowledge replay", async () => {
    mocked.issue.mockReturnValue(authorizedOutcome());
    mocked.readBinding.mockResolvedValue(binding);
    const sql = sqlHarness();
    const record = await createPostgresHistoricalForecastInputPitProducerV2(sql as never)({
      organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, datasetAuthorityId: "dataset-authority",
    });
    expect(record).toMatchObject({ visibleFrom: pit, knowledgeContentDigestHex: knowledge });
    expect(record.contentDigestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(mocked.verifyInformation).toHaveBeenCalledWith(sql, expect.objectContaining({
      runId: "run",
      cycleId: "cycle",
      symbol: "BTCUSDT",
      expectedDatasetAuthority: {
        id: "dataset-authority",
        datasetAuthorityDigestHex: "2".repeat(64),
        authorityContentDigestHex: datasetAuthorityDigest,
        membershipContentDigestHex: datasetMembership.contentDigestHex,
        sealedCycleContentDigestHex: "6".repeat(64),
      },
    }));
  });

  it("rejects knowledge evidence that becomes visible after the cycle PIT", async () => {
    mocked.issue.mockReturnValue(authorizedOutcome());
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
      symbol: "BTCUSDT", pitAnchor: pit, datasetAuthorityId: "dataset-authority",
    })).rejects.toThrow("HISTORICAL_FORECAST_PIT_PRODUCER_REFUSED");
  });

  it("rejects a contract binding or package that was not durable by the PIT", async () => {
    mocked.issue.mockReturnValue(authorizedOutcome());
    mocked.readBinding.mockResolvedValue(binding);
    await expect(createPostgresHistoricalForecastInputPitProducerV2(sqlHarness({ bindingVisible: false }) as never)({
      organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, datasetAuthorityId: "dataset-authority",
    })).rejects.toThrow("FUTURE_BINDING_OR_PACKAGE");
  });

  it("rejects a substituted persisted outcome and a non-canonical Forecast schema", async () => {
    mocked.issue.mockReturnValue(authorizedOutcome());
    mocked.readBinding.mockResolvedValue(binding);
    await expect(createPostgresHistoricalForecastInputPitProducerV2(sqlHarness({
      persistedOutcome: { ...authorizedOutcome(), authority: {
        ...authorizedOutcome().authority, contentDigestHex: "f".repeat(64),
      } },
    }) as never)({ organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, datasetAuthorityId: "dataset-authority", })).rejects.toThrow("CANONICAL_FORECAST");
    await expect(createPostgresHistoricalForecastInputPitProducerV2(sqlHarness({ forecastSchema: "1" }) as never)({
      organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, datasetAuthorityId: "dataset-authority", })).rejects.toThrow("CANONICAL_FORECAST");
  });

  it("rejects a corrupted durable dataset authority envelope", async () => {
    await expect(createPostgresHistoricalForecastInputPitProducerV2(sqlHarness({
      datasetAuthorityDigest: "f".repeat(64),
    }) as never)({ organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, datasetAuthorityId: "dataset-authority", })).rejects.toThrow("DATASET_AUTHORITY");
  });

  it("rejects a conflicting durable row instead of overwriting it", async () => {
    mocked.issue.mockReturnValue(authorizedOutcome());
    mocked.readBinding.mockResolvedValue(binding);
    const sql = sqlHarness({ persistedDigest: "9".repeat(64) });
    await expect(createPostgresHistoricalForecastInputPitProducerV2(sql as never)({
      organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, datasetAuthorityId: "dataset-authority",
    })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("rejects an unknown durable dataset authority before Forecast lookup", async () => {
    const sql = Object.assign(vi.fn(async (strings: TemplateStringsArray) =>
      strings.join(" ").includes("run_start") ? [{ started_at: pit }] : []),
    { json: (value: unknown) => value });
    Object.assign(sql, { begin: async (_level: string, callback: (tx: unknown) => unknown) => callback(sql) });
    await expect(createPostgresHistoricalForecastInputPitProducerV2(sql as never)({
      organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, datasetAuthorityId: "unknown",
    })).rejects.toThrow("DATASET_AUTHORITY");
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it("returns a detached deeply immutable evidence record", async () => {
    mocked.issue.mockReturnValue(authorizedOutcome());
    mocked.readBinding.mockResolvedValue(binding);
    const record = await createPostgresHistoricalForecastInputPitProducerV2(sqlHarness() as never)({
      organizationId: "org", runId: "run", cycleId: "cycle", forecastId: "forecast",
      symbol: "BTCUSDT", pitAnchor: pit, datasetAuthorityId: "dataset-authority",
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.datasetMembership)).toBe(true);
    expect(Object.isFrozen(record.runtimeInput)).toBe(true);
    expect(record.datasetMembership).not.toBe(datasetMembership);
    expect(record.runtimeInput).not.toBe(runtimeInput);
  });
});
