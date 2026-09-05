import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  source: vi.fn(),
  ratified: vi.fn(),
  persistObservation: vi.fn(),
  buildTrust: vi.fn((value) => ({ ...value, schemaVersion:
    "historical-dataset-trust-authority-v2", contentDigestHex: "d".repeat(64) })),
  defineProfile: vi.fn((value) => ({ ...value, id: "profile", contentDigest: "e".repeat(64) })),
  evaluate: vi.fn((value) => ({ ...value, id: "receipt", status: "SUFFICIENT",
    contentDigest: "f".repeat(64) })),
  bind: vi.fn((_profile, receipt) => ({ kind: "PROFILE_RECEIPT", receipt })),
  persistProfile: vi.fn(),
  persistReceipt: vi.fn(),
  requireAuthority: vi.fn(),
  loadPreviousPit: vi.fn(),
  resolveTrust: vi.fn(),
}));

vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: (value: unknown) => value }));
vi.mock("@/db/schema.postgres", () => ({}));
vi.mock("@/lib/trader/historical-simulation-v2/production-next-cycle-authority-v2", () => ({
  prepareHistoricalProductionNextCycleAuthorityV2: mocked.source,
}));
vi.mock("@/lib/trader/historical-simulation-v2/pit-forecast-input-loader-v2", () => ({
  loadPostgresHistoricalForecastInputPitInTransactionV2: mocked.loadPreviousPit,
}));
vi.mock("@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2", () => ({
  requireHistoricalFourSurfaceRatifiedAdmissionV2: mocked.ratified,
}));
vi.mock("@/lib/trader/mi/canonical-pit-service-postgres", () => ({
  persistCanonicalAvailableGatewayWithinHeldTransactionV1Postgres: mocked.persistObservation,
}));
vi.mock("@/lib/trader/mi/trust-as-of-repository-postgres", () => ({
  resolveAndPersistTrustAsOfV1Postgres: mocked.resolveTrust,
}));
vi.mock("@/lib/trader/intelligence/information-sufficiency", () => ({
  buildHistoricalDatasetTrustAuthorityV2: mocked.buildTrust,
  bindInformationSufficiencyReceiptAuthorityV2: mocked.bind,
  defineRequiredInformationProfileV2: mocked.defineProfile,
  evaluateInformationSufficiencyV2: mocked.evaluate,
}));
vi.mock("@/lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres", () => ({
  persistInformationSufficiencyReceiptWithinTransactionV2Postgres: mocked.persistReceipt,
  persistRequiredInformationProfileWithinTransactionV2Postgres: mocked.persistProfile,
  requireInformationSufficiencyAuthorityWithinTransactionV2Postgres: mocked.requireAuthority,
}));

import { prepareHistoricalProductionNextCycleInformationV2 } from
  "@/lib/trader/historical-simulation-v2/production-next-cycle-information-v2";

const cutoff = "2026-09-01T00:00:00.000Z";
const pit = "2026-01-01T00:01:00.000Z";
const currentTrustReceiptId = "f".repeat(64);
const runtime = {
  marketStateSnapshot: { organizationId: "org", symbol: "BTCUSDT" },
  historicalIntelligenceCycleAuthority: {
    runId: "run", cycleId: "run:WALK_FORWARD:BTCUSDT:999",
  },
  forecastContractBinding: {
    selectedPredictivePackageContentDigestHex: "a".repeat(64),
    inputContract: { contentDigestHex: "b".repeat(64) },
  },
};

function configure() {
  mocked.loadPreviousPit.mockResolvedValue(runtime);
  mocked.source.mockResolvedValue({
    previousCycleId: "run:WALK_FORWARD:BTCUSDT:999",
    currentCycleId: "run:WALK_FORWARD:BTCUSDT:1000",
    currentDatasetAuthorityId: "44444444-4444-4444-8444-444444444444",
    currentDatasetAuthorityContentDigestHex: "1".repeat(64),
    currentMembership: {
      datasetAuthorityClass: "PRE_HOLDOUT_QUALIFICATION_V1",
      datasetAuthorityDigestHex: "2".repeat(64),
      partitionRawSha256Hex: "3".repeat(64),
      contentDigestHex: "4".repeat(64),
    },
    currentSealedCycle: {
      contentDigestHex: "5".repeat(64),
      closedBar: { symbol: "BTC/USDT", close: "50000", barCloseTime: pit },
    },
    warmupCycles: [],
  });
  mocked.ratified.mockResolvedValue({
    organizationId: "org", runId: "run", releaseSha: "9".repeat(40),
    contentDigestHex: "8".repeat(64), epistemicRecordCutoff: cutoff,
    marketEvidence: [{
      symbol: "BTCUSDT", trustAuthorityKind: "HISTORICAL_DATASET_TRUST",
      sourceId: "source", trustAsOfReceiptId: "6".repeat(64),
      trustRevisionId: "77777777-7777-4777-8777-777777777777",
      trustRevisionContentDigestHex: "7".repeat(64), trustScore: "1",
      wfPredictiveSemanticContentDigestHex: "8".repeat(64),
      wfPredictiveStartUtc: "2025-12-01T00:00:00.000Z",
      wfPredictiveEndUtc: "2026-01-01T00:00:00.000Z",
    }],
    surfaceAdmissions: [{ surfaceKey: "BTCUSDT:30",
      predictivePackageContentDigestHex: "a".repeat(64) }],
  });
  mocked.persistObservation.mockResolvedValue({ observation: {
    id: "88888888-8888-4888-8888-888888888888",
    contentDigest: "c".repeat(64), availableAt: new Date(pit),
    ingestTime: new Date(cutoff),
  } });
  mocked.resolveTrust.mockResolvedValue({ receipt: {
    id: currentTrustReceiptId,
    contentDigest: currentTrustReceiptId,
    organizationId: "org",
    sourceId: "source",
    anchorTimeUtc: cutoff,
    status: "RESOLVED",
    unknownReason: null,
    selectedTrustRevisionId: "77777777-7777-4777-8777-777777777777",
    selectedContentDigest: "7".repeat(64),
    selectedTrustScore: "1",
  } });
}

function sqlHarness() {
  let call = 0;
  return Object.assign(vi.fn(async () => {
    call += 1;
    if (call === 1) return [{
      id: "99999999-9999-4999-8999-999999999999",
      release_sha: "9".repeat(40),
      aggregate_admission_receipt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      authority_content_digest_hex: "8".repeat(64),
    }];
    return [{ forecast_id: "forecast", cycle_id: "run:WALK_FORWARD:BTCUSDT:999",
      record_index: 999, pit_anchor: "2026-01-01T00:00:00.000Z",
      knowledge_content_digest_hex: "a".repeat(64),
      forecast_authority_content_digest_hex: "b".repeat(64),
      dataset_authority_id: "44444444-4444-4444-8444-444444444444" }];
  }), { json: (value: unknown) => value });
}

const request = {
  organizationId: "org", accountId: "account", runId: "run",
  partition: "WALK_FORWARD" as const, symbol: "BTCUSDT" as const,
  primaryHorizonMinutes: 30 as const, expectedRecordIndex: 1000,
};

describe("Historical Simulation V2 next-cycle information producer", () => {
  it("combines immutable ratification roots with exact current dataset and observation", async () => {
    configure();
    const tx = sqlHarness();
    const result = await prepareHistoricalProductionNextCycleInformationV2({
      tx: tx as never, ...request,
    });
    expect(result.informationSufficiencyReceipt.status).toBe("SUFFICIENT");
    expect(mocked.buildTrust).toHaveBeenCalledWith(expect.objectContaining({
      datasetAuthorityId: "44444444-4444-4444-8444-444444444444",
      datasetAuthorityContentDigestHex: "1".repeat(64),
      membershipContentDigestHex: "4".repeat(64),
      sealedCycleContentDigestHex: "5".repeat(64),
      publicAvailableAt: pit,
      trustAsOfReceiptId: currentTrustReceiptId,
      wfPredictiveEndUtc: "2026-01-01T00:00:00.000Z",
    }));
    expect(mocked.persistObservation).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: "org" },
      expect.objectContaining({ trustAsOfReceiptId: currentTrustReceiptId }),
    );
    expect(mocked.resolveTrust).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: "org" },
      { sourceId: "source", anchorTime: new Date(cutoff) },
    );
    expect(mocked.persistProfile).toHaveBeenCalledOnce();
    expect(mocked.persistReceipt).toHaveBeenCalledOnce();
    expect(mocked.requireAuthority).toHaveBeenCalledOnce();
    const calls = tx.mock.calls as unknown as Array<[readonly string[]]>;
    const previousRuntimeSql = calls[1]?.[0]
      .reduce((text: string, part: string) => text + part, "") ?? "";
    // The PIT row is append-only and the cycle transaction is already protected
    // by the exact org/run advisory lock.  The least-privilege runner has SELECT,
    // not UPDATE, so this immutable read must not request an UPDATE-strength lock.
    expect(previousRuntimeSql).not.toMatch(/FOR\s+(?:NO\s+KEY\s+)?(?:SHARE|UPDATE)/i);
  });

  it("refuses a previous-cycle runtime from another cycle", async () => {
    configure();
    const substituted = { ...runtime, historicalIntelligenceCycleAuthority: {
      runId: "run", cycleId: "run:WALK_FORWARD:BTCUSDT:1000",
    } };
    mocked.loadPreviousPit.mockResolvedValueOnce(substituted);
    await expect(prepareHistoricalProductionNextCycleInformationV2({
      tx: sqlHarness() as never, ...request,
    })).rejects.toThrow("PREVIOUS_RUNTIME_BINDING");
  });

  it("refuses a static surface package that does not match durable prior runtime", async () => {
    configure();
    mocked.ratified.mockResolvedValueOnce({
      ...(await mocked.ratified()),
      surfaceAdmissions: [{ surfaceKey: "BTCUSDT:30",
        predictivePackageContentDigestHex: "0".repeat(64) }],
    });
    await expect(prepareHistoricalProductionNextCycleInformationV2({
      tx: sqlHarness() as never, ...request,
    })).rejects.toThrow("PREVIOUS_RUNTIME_BINDING");
  });
});
