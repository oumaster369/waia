import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  forecast: vi.fn(),
  issueForecast: vi.fn(),
  requireOutcome: vi.fn((value) => value),
  preregister: vi.fn(),
  verifyForecast: vi.fn(),
  verifyScientific: vi.fn(),
  verifyExecution: vi.fn(),
  loadScientificVerification: vi.fn(),
  persistAuthority: vi.fn(),
  producePit: vi.fn(),
  readScientific: vi.fn(),
  events: [] as string[],
}));

vi.mock("@/lib/trader/historical-simulation-v2/production-next-cycle-forecast-v2", () => ({
  prepareHistoricalProductionNextCycleForecastV2: mocked.forecast,
}));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", () => ({
  issueForecastRuntimeV2: mocked.issueForecast,
  requireForecastRuntimeAuthorizedOutcomeV2: mocked.requireOutcome,
}));
vi.mock("@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2", () => ({
  createCanonicalDecisionVerificationReceiptServiceV2: () => ({
    preregisterExecution: mocked.preregister,
    issueForecast: mocked.verifyForecast,
    issueScientific: mocked.verifyScientific,
    issueExecution: mocked.verifyExecution,
  }),
  createPostgresCanonicalDecisionVerificationReceiptPortV2: () => ({
    loadScientificVerification: mocked.loadScientificVerification,
  }),
}));
vi.mock("@/lib/trader/historical-simulation-v2/dee659-authority-repository-postgres-v2", () => ({
  createPostgresDee659AuthorityRepositoryV2: () => ({
    persist: mocked.persistAuthority,
  }),
}));
vi.mock("@/lib/trader/historical-simulation-v2/pit-forecast-input-producer-v2", () => ({
  createPostgresHistoricalForecastInputPitProducerV2: () => mocked.producePit,
}));
vi.mock("@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1", () => ({
  readScientificAdmissionReceiptV1: mocked.readScientific,
}));

import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { assertHistoricalForecastNonActionableSourceV2 } from
  "@/lib/trader/historical-simulation-v2/non-actionable-forecast-source-v2";
import { prepareHistoricalProductionNextCycleForCommitV2 } from
  "@/lib/trader/historical-simulation-v2/production-next-cycle-preparation-v2";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const account = "account";
const run = "run";
const previousCycleId = "run:WALK_FORWARD:BTCUSDT:999";
const cycleId = "run:WALK_FORWARD:BTCUSDT:1000";
const forecastId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bundleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const datasetId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const accountingId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const accountingDigest = "1".repeat(64);
const forecastDigest = "2".repeat(64);
const admissionDigest = "3".repeat(64);
const verificationDigest = "4".repeat(64);
const pit = "2026-01-01T00:01:00.000Z";

const policyConfig = { policyId: "policy" };
const previousAuthority = {
  schemaVersion: "waia.trader.dee659_authority_preregistration.v2",
  organizationId: org,
  accountId: account,
  runId: run,
  sealedCycle: { cycleId: previousCycleId },
  policyConfig,
  authorities: { economicSize: { exactQuantities: ["0.001"] } },
};

function sqlHarness(options: Readonly<{ accountingDigest?: string }> = {}) {
  let call = 0;
  return Object.assign(vi.fn(async () => {
    call += 1;
    if (call === 1) return [{
      cycle_id: previousCycleId,
      record_index: 999,
      policy_config_digest_hex: computeStableJsonDigest(policyConfig),
      authority_bundle_json: previousAuthority,
      authority_bundle_digest_hex: computeStableJsonDigest(previousAuthority),
      runtime_input_json: {
        predictivePackage: { family: { primaryHorizonMinutes: 30 } },
      },
    }];
    if (call === 2) return [{ id: accountingId,
      semantic_content_digest: options.accountingDigest ?? accountingDigest }];
    if (call === 3) return [{ evidence_semantic_digest: "5".repeat(64) }];
    return [{ digest: "6".repeat(64) }];
  }), { json: (value: unknown) => value });
}

const input = {
  organizationId: org,
  accountId: account,
  runId: run,
  partition: "WALK_FORWARD" as const,
  symbol: "BTCUSDT" as const,
  expectedRecordIndex: 1000,
  previousCycleId,
  accountingFrontierId: accountingId,
  accountingFrontierContentDigestHex: accountingDigest,
  codeSha: "9".repeat(40),
};

describe("Historical Simulation V2 atomic later-cycle preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.events.length = 0;
    const authority = { contentDigestHex: forecastDigest };
    const admission = {
      contentDigestHex: "e".repeat(64),
      scientificAdmissionReceiptContentDigestHex: admissionDigest,
    };
    const binding = { scientificAdmissionReceiptId:
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      scientificAdmissionReceiptContentDigestHex: admissionDigest };
    mocked.forecast.mockImplementation(async () => {
      mocked.events.push("forecast");
      return {
        status: "FORECAST_AUTHORIZED",
        forecastId,
        bundleId,
        forecastAuthorityContentDigestHex: forecastDigest,
        runtimeInput: { predictiveAdmissionReceipt: admission,
          forecastContractBinding: binding },
        information: { sourceAuthority: {
          currentCycleId: cycleId,
          currentDatasetAuthorityId: datasetId,
          currentSealedCycle: { closedBar: { barCloseTime: pit } },
        } },
      };
    });
    mocked.issueForecast.mockReturnValue({ status: "FORECAST_AUTHORIZED", authority });
    mocked.preregister.mockImplementation(async () => {
      mocked.events.push("preregister");
      return { preregistrationId: "prereg", datasetAuthorityDigestHex: "7".repeat(64),
        authorities: {
          anchor: { contentDigestHex: "8".repeat(64) },
          executablePolicy: { contentDigestHex: "9".repeat(64) },
          economicSize: { contentDigestHex: "a".repeat(64) },
          cash: { contentDigestHex: "b".repeat(64) },
        } };
    });
    mocked.verifyForecast.mockResolvedValue({ verificationReceiptDigestHex: verificationDigest });
    mocked.verifyScientific.mockResolvedValue({});
    mocked.verifyExecution.mockResolvedValue({ execution: true });
    mocked.loadScientificVerification.mockResolvedValue({
      verificationReceiptDigestHex: "c".repeat(64),
    });
    mocked.readScientific.mockResolvedValue({ id: binding.scientificAdmissionReceiptId,
      organizationId: org, contentDigest: admissionDigest });
    mocked.persistAuthority.mockImplementation(async () => {
      mocked.events.push("dee659");
    });
    mocked.producePit.mockImplementation(async () => {
      mocked.events.push("pit");
      return { contentDigestHex: "d".repeat(64) };
    });
  });

  it("persists Forecast, DEE-659 authority, then PIT inside the caller transaction", async () => {
    const tx = sqlHarness();
    await expect(prepareHistoricalProductionNextCycleForCommitV2({
      tx: tx as never,
      ...input,
    })).resolves.toEqual({
      status: "FORECAST_AUTHORIZED",
      cycleId,
      forecastId,
      pitContentDigestHex: "d".repeat(64),
    });
    expect(mocked.events).toEqual(["forecast", "preregister", "dee659", "pit"]);
    expect(mocked.forecast).toHaveBeenCalledWith(expect.objectContaining({
      tx,
      partition: "WALK_FORWARD",
      primaryHorizonMinutes: 30,
      expectedRecordIndex: 1000,
    }));
    expect(mocked.preregister).toHaveBeenCalledWith(expect.objectContaining({
      accountingFrontierId: accountingId,
      defaultQuantity: "0.001",
      policyConfig,
    }));
    expect(mocked.verifyScientific).toHaveBeenCalledWith(expect.objectContaining({
      scientificAdmissionContentDigestHex: admissionDigest,
    }));
    expect(mocked.loadScientificVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        scientificAdmissionContentDigestHex: admissionDigest,
      }),
    );
    expect(mocked.persistAuthority).toHaveBeenCalledOnce();
    expect(mocked.producePit).toHaveBeenCalledWith(expect.objectContaining({
      cycleId,
      forecastId,
      datasetAuthorityId: datasetId,
    }));
  });

  it("fails closed before creating a Forecast when cursor accounting diverges", async () => {
    await expect(prepareHistoricalProductionNextCycleForCommitV2({
      tx: sqlHarness({ accountingDigest: "f".repeat(64) }) as never,
      ...input,
    })).rejects.toThrow("ACCOUNTING_FRONTIER");
    expect(mocked.forecast).not.toHaveBeenCalled();
    expect(mocked.preregister).not.toHaveBeenCalled();
    expect(mocked.producePit).not.toHaveBeenCalled();
  });

  it("seals a verified CASH path for a sole hypothesis-not-applicable outcome", async () => {
    const outcome = {
      status: "NON_ACTIONABLE" as const,
      reason: "MISSING_OR_NOT_ADMITTED" as const,
      upstreamReasonCodes: ["HYPOTHESIS_NOT_APPLICABLE"] as const,
      contentDigestHex: "f".repeat(64),
    };
    const runtimeInput = {
      diagnosticTimestamp: new Date(pit),
      predictiveAdmissionReceipt: {
        verdict: "NOT_ADMITTED",
        blockingReasons: ["HYPOTHESIS_NOT_APPLICABLE"],
      },
    };
    mocked.forecast.mockResolvedValueOnce({
      status: "NON_ACTIONABLE",
      runtimeInput,
      outcome,
      information: { sourceAuthority: {
        currentCycleId: cycleId,
        currentMembership: { contentDigestHex: "7".repeat(64) },
        currentSealedCycle: { closedBar: { barCloseTime: pit } },
      } },
    });
    mocked.issueForecast.mockReturnValue(outcome);

    const prepared = await prepareHistoricalProductionNextCycleForCommitV2({
      tx: sqlHarness() as never,
      ...input,
    });
    expect(prepared).toMatchObject({
      status: "NON_ACTIONABLE",
      cycleId,
      defaultQuantity: "0.001",
      source: { outcome },
      verification: { verified: true },
    });
    if (prepared.status !== "NON_ACTIONABLE") throw new Error("expected abstention");
    const durableSource = JSON.parse(JSON.stringify(prepared.source));
    expect(() => assertHistoricalForecastNonActionableSourceV2(
      durableSource,
      prepared.source,
    )).not.toThrow();
    expect(durableSource.runtimeInput.diagnosticTimestamp).toBe(pit);
    expect(mocked.preregister).not.toHaveBeenCalled();
    expect(mocked.persistAuthority).not.toHaveBeenCalled();
    expect(mocked.producePit).not.toHaveBeenCalled();
  });

  it("binds the previous cycle through the persisted row and sealed canonical cycle", async () => {
    const tx = sqlHarness();
    tx.mockImplementationOnce(async () => [{
      cycle_id: previousCycleId,
      record_index: 999,
      policy_config_digest_hex: computeStableJsonDigest(policyConfig),
      authority_bundle_json: {
        ...previousAuthority,
        sealedCycle: { cycleId: `${previousCycleId}:tampered` },
      },
      authority_bundle_digest_hex: computeStableJsonDigest({
        ...previousAuthority,
        sealedCycle: { cycleId: `${previousCycleId}:tampered` },
      }),
      runtime_input_json: {
        predictivePackage: { family: { primaryHorizonMinutes: 30 } },
      },
    }]);
    await expect(prepareHistoricalProductionNextCycleForCommitV2({
      tx: tx as never,
      ...input,
    })).rejects.toThrow("PREVIOUS_AUTHORITY");
    expect(mocked.forecast).not.toHaveBeenCalled();
    expect(mocked.preregister).not.toHaveBeenCalled();
  });
});
