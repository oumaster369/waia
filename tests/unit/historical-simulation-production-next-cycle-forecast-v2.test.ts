import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  information: vi.fn(), ratified: vi.fn(), requireScientific: vi.fn((value) => value),
  fold: vi.fn(), evaluation: vi.fn(), persistBundle: vi.fn(), buildRuntime: vi.fn(),
  persistPackage: vi.fn(), persistBinding: vi.fn(), buildKnowledge: vi.fn(),
  persistKnowledge: vi.fn(), loadKnowledge: vi.fn(), persistForecast: vi.fn(),
  loadInitial: vi.fn(), issue: vi.fn(), requireOutcome: vi.fn((value) => value),
  rebuildBinding: vi.fn(), processForecastCycle: vi.fn(),
}));

vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: (value: unknown) => value }));
vi.mock("@/db/schema.postgres", () => ({}));
vi.mock("@/lib/trader/historical-simulation-v2/production-next-cycle-information-v2", () => ({
  prepareHistoricalProductionNextCycleInformationV2: mocked.information,
}));
vi.mock("@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2", () => ({
  requireHistoricalFourSurfaceRatifiedAdmissionV2: mocked.ratified,
}));
vi.mock("@/lib/trader/research/execopp-qualification/scientific-admission-v2", () => ({
  requireScientificAdmissionV2: mocked.requireScientific,
}));
vi.mock("@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1",
  );
  return { ...actual, foldCanonicalRuntimeIntelligenceStateV1: mocked.fold };
});
vi.mock("@/lib/trader/intelligence/evaluation-cycle", () => ({
  runEvaluationCycle: mocked.evaluation,
}));
vi.mock("@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres", () => ({
  persistIntelligenceCycleBundleWithinTransaction: mocked.persistBundle,
}));
vi.mock("@/lib/trader/historical-simulation-v2/forecast-cycle-runtime-input-v2", () => ({
  buildHistoricalForecastCycleRuntimeInputV2: mocked.buildRuntime,
}));
vi.mock("@/lib/trader/historical-simulation-v2/forecast-authority-bootstrap-v2", () => ({
  buildHistoricalForecastAuthorityBootstrapV2: mocked.rebuildBinding,
}));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service", () => ({
  persistPredictivePackageV2: mocked.persistPackage,
}));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1", () => ({
  persistForecastContractBindingV1: mocked.persistBinding,
}));
vi.mock("@/lib/trader/historical-simulation-v2/forecast-knowledge-bootstrap-v2", () => ({
  buildHistoricalForecastKnowledgeBootstrapV2: mocked.buildKnowledge,
  persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2: mocked.persistKnowledge,
}));
vi.mock("@/lib/trader/historical-simulation-v2/knowledge-snapshot-binding-v2", () => ({
  loadHistoricalKnowledgeSnapshotAuthorityV2: mocked.loadKnowledge,
}));
vi.mock("@/lib/trader/historical-simulation-v2/forecast-cycle-persistence-v2", () => ({
  persistHistoricalForecastCycleV2: mocked.persistForecast,
}));
vi.mock("@/lib/trader/historical-simulation-v2/production-initial-cycle-index-v2", () => ({
  loadHistoricalSimulationInitialRecordIndexV2: mocked.loadInitial,
}));
vi.mock("@/lib/trader/historical-simulation-v2/knowledge-port-postgres", () => ({
  createHistoricalSimulationPostgresKnowledgePortV2: () => ({
    processForecastCycle: mocked.processForecastCycle,
  }),
}));
vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", () => ({
  issueForecastRuntimeV2: mocked.issue,
  requireForecastRuntimeAuthorizedOutcomeV2: mocked.requireOutcome,
}));
vi.mock("@/lib/trader/mi/hypothesis-repository-adapters", () => ({
  createPostgresMiHypothesisRepository: () => ({}),
}));
vi.mock("@/lib/trader/mi/evidence-repository-adapters", () => ({
  createPostgresMiEvidenceRepository: () => ({}),
}));
vi.mock("@/lib/trader/mi/observation-repository-adapters", () => ({
  createPostgresMiObservationRepository: () => ({}),
}));
vi.mock("@/lib/trader/mi/trial-repository-adapters", () => ({
  createPostgresMiTrialRepository: () => ({}),
}));
vi.mock("@/lib/trader/knowledge/mkb-read-model-postgres", () => ({
  createMkbReadModelSourcePostgres: () => ({}),
}));

import {
  assertHistoricalNextCycleKnowledgeBoundaryV2,
  prepareHistoricalProductionNextCycleForecastV2,
} from
  "@/lib/trader/historical-simulation-v2/production-next-cycle-forecast-v2";

const pit = "2026-01-01T00:01:00.000Z";
const predictiveBoundary = "2026-01-01T00:00:00.000Z";
const packageDigest = "a".repeat(64);
const predictivePackage = {
  family: { symbol: "BTC/USDT", executionHorizonMinutes: 30 },
  predictivePackageContentDigest: Buffer.from(packageDigest, "hex"),
};
const binding = { contentDigestHex: "b".repeat(64),
  selectedPredictivePackageContentDigestHex: packageDigest };

function setup() {
  mocked.information.mockResolvedValue({
    sourceAuthority: {
      previousCycleId: "run:WALK_FORWARD:BTCUSDT:999",
      currentCycleId: "run:WALK_FORWARD:BTCUSDT:1000",
      currentDatasetAuthorityContentDigestHex: "1".repeat(64),
      currentMembership: { datasetAuthorityDigestHex: "2".repeat(64) },
      currentSealedCycle: { closedBar: { symbol: "BTC/USDT", close: "50000",
        barCloseTime: pit }, htxVolumeAuthorityReceipt: { symbol: "BTC/USDT" } },
      warmupCycles: Array.from({ length: 240 }, () => ({ closedBar: {} })),
    },
    previousRuntimeInput: { predictivePackage, forecastContractBinding: binding },
    normalizedObservation: { confidence: 1, provenance: {} },
    requiredInformationProfile: {}, informationSufficiencyReceipt: {},
    informationSufficiencyAuthority: {},
  });
  mocked.ratified.mockResolvedValue({
    schemaVersion: "waia.trader.historical_four_surface_ratified_admission.v2",
    releaseSha: "9".repeat(40), contentDigestHex: "8".repeat(64),
    epistemicRecordCutoff: "2026-09-01T00:00:00.000Z",
    aggregateAdmissionContentDigestHex: "7".repeat(64),
    developmentDatasetIdentityDigestHex: "6".repeat(64),
    surfaceAdmissions: [{
      surfaceKey: "BTCUSDT:30", scientificAdmissionReceiptId:
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scientificAdmissionContentDigestHex: "5".repeat(64),
      predictivePackageGenerationIdentityDigestHex: "4".repeat(64),
      predictivePackageContentDigestHex: packageDigest,
      predictiveTerminalReceipt: { contentDigestHex: "3".repeat(64) },
      humanRatificationReceipt: { contentDigestHex: "2".repeat(64) },
      kmGlobalAnchorSetDigestHex: "1".repeat(64),
    }],
    knowledgeSnapshots: [{ surfaceKey: "BTCUSDT:30", schemaVersion: "sealed",
      organizationId: "org", runId: "run", releaseSha: "9".repeat(40),
      selectedHypothesisType: "trend_continuation",
      hypothesis: { id: "h", hypothesisKey: "hk", definitionDigest: "d", createdAt: pit },
      lifecycle: { id: "l", contentDigest: "d", state: "VALIDATED", createdAt: pit },
      evidence: {}, observation: {}, trial: {}, prediction: { id: "p", sealDigestHex: "d" },
      knowledgeEdge: { id: "k", sealDigestHex: "d" },
      marketPitBoundary: predictiveBoundary,
      snapshotContentDigestHex: "d" }],
    marketEvidence: [{ symbol: "BTCUSDT", wfPredictiveStartUtc:
      "2025-12-01T00:00:00.000Z", wfPredictiveEndUtc: "2026-01-01T00:00:00.000Z",
    publicAvailableAt: predictiveBoundary, observationEventTime: predictiveBoundary }],
  });
  mocked.fold.mockResolvedValue({ hypotheses: [{ lifecycleState: "VALIDATED",
    ordinalJudgment: "SUPPORTED", knowledgeRefs: [{ knowledgeState: "RESOLVED_CORRECT" }] }] });
  mocked.evaluation.mockReturnValue({ intelligenceCycleBundle: { envelope: {} } });
  mocked.buildKnowledge.mockReturnValue({});
  mocked.loadKnowledge.mockResolvedValue({});
  mocked.buildRuntime.mockReturnValue({ runtime: "input" });
  mocked.rebuildBinding.mockReturnValue({ forecastContractBinding: binding });
  mocked.persistPackage.mockResolvedValue({ packageId: "package" });
  mocked.persistForecast.mockResolvedValue({ executionForecastId: "forecast", bundleId: "bundle" });
  mocked.loadInitial.mockResolvedValue(999);
  mocked.issue.mockReturnValue({ status: "FORECAST_AUTHORIZED",
    authority: { contentDigestHex: "f".repeat(64) }, issuance: {} });
}

function sqlHarness() {
  let call = 0;
  return Object.assign(vi.fn(async () => {
    call += 1;
    if (call === 1) return [{ id: "99999999-9999-4999-8999-999999999999",
      release_sha: "9".repeat(40), aggregate_admission_receipt_id:
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authority_content_digest_hex:
        "8".repeat(64), created_at: "2026-09-01T00:00:00.000Z" }];
    return [{ receipt_json: {
      organizationId: "org", contentDigestHex: "5".repeat(64),
      predictiveTerminalReceipt: { targetGridReceiptDigestHex: "1".repeat(64),
        runtimeContractDigestHex: "2".repeat(64), evaluationPartitionReceiptDigestHex:
          "3".repeat(64) }, kmConvergenceReceipt: { evidenceSemanticDigestHex: "4".repeat(64) },
    }, content_digest: "5".repeat(64) }];
  }), { json: (value: unknown) => value });
}

const request = { organizationId: "org", accountId: "account", runId: "run",
  partition: "WALK_FORWARD" as const, symbol: "BTCUSDT" as const,
  primaryHorizonMinutes: 30 as const, expectedRecordIndex: 1000 };

describe("Historical Simulation V2 next-cycle Forecast producer", () => {
  beforeEach(() => { vi.clearAllMocks(); setup(); });

  it("builds and persists only the exact next Forecast with authenticated sequence", async () => {
    const result = await prepareHistoricalProductionNextCycleForecastV2({
      tx: sqlHarness() as never, ...request,
    });
    expect(result).toMatchObject({ forecastId: "forecast", issuanceSequence: 1 });
    expect(mocked.persistForecast).toHaveBeenCalledTimes(1);
    expect(mocked.persistForecast).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ cycleId: "run:WALK_FORWARD:BTCUSDT:1000",
        issuanceSequence: 1 }));
    expect(mocked.information).toHaveBeenCalledTimes(1);
    expect(mocked.processForecastCycle).toHaveBeenCalledWith(expect.objectContaining({
      cycleId: "run:WALK_FORWARD:BTCUSDT:1000",
      pitAnchor: pit,
      outcome: null,
    }));
    expect(mocked.processForecastCycle.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.loadKnowledge.mock.invocationCallOrder[0]!,
    );
    expect(mocked.fold).toHaveBeenCalledWith(expect.objectContaining({
      asOf: new Date(pit),
      sealedHistoricalKnowledge: expect.objectContaining({
        marketPitBoundary: predictiveBoundary,
        snapshotContentDigestHex: "d",
      }),
    }), expect.anything());
  });

  it("returns a terminal market abstention without fabricating a Forecast", async () => {
    mocked.issue.mockReturnValueOnce({
      status: "NON_ACTIONABLE",
      reason: "MISSING_OR_NOT_ADMITTED",
      upstreamReasonCodes: ["HYPOTHESIS_NOT_APPLICABLE"],
      contentDigestHex: "e".repeat(64),
    });

    await expect(prepareHistoricalProductionNextCycleForecastV2({
      tx: sqlHarness() as never, ...request,
    })).resolves.toMatchObject({
      status: "NON_ACTIONABLE",
      issuanceSequence: 1,
      outcome: {
        reason: "MISSING_OR_NOT_ADMITTED",
        upstreamReasonCodes: ["HYPOTHESIS_NOT_APPLICABLE"],
      },
    });
    expect(mocked.requireOutcome).not.toHaveBeenCalled();
    expect(mocked.persistForecast).not.toHaveBeenCalled();
  });

  it("refuses a non-forward sequence before persisting a Forecast", async () => {
    mocked.loadInitial.mockResolvedValueOnce(1000);
    await expect(prepareHistoricalProductionNextCycleForecastV2({
      tx: sqlHarness() as never, ...request,
    })).rejects.toThrow("ISSUANCE_SEQUENCE");
    expect(mocked.persistForecast).not.toHaveBeenCalled();
  });

  it("binds ratified Knowledge to exact market evidence strictly before economic PIT", () => {
    const valid = {
      sealedKnowledgeMarketPitBoundary: "2026-01-01T00:00:00.000Z",
      marketEvidencePublicAvailableAt: "2026-01-01T00:00:00.000Z",
      marketEvidenceObservationEventTime: "2026-01-01T00:00:00.000Z",
      currentEconomicPitAnchor: pit,
    };
    expect(() => assertHistoricalNextCycleKnowledgeBoundaryV2(valid)).not.toThrow();
    for (const invalid of [
      { ...valid, sealedKnowledgeMarketPitBoundary: pit },
      { ...valid, sealedKnowledgeMarketPitBoundary: "2026-01-01T00:02:00.000Z" },
      { ...valid, marketEvidenceObservationEventTime: "2025-12-31T23:59:00.000Z" },
      { ...valid, marketEvidencePublicAvailableAt: "2025-12-31T23:59:00.000Z" },
    ]) {
      expect(() => assertHistoricalNextCycleKnowledgeBoundaryV2(invalid)).toThrow(
        "SEALED_KNOWLEDGE_AUTHORITY_BOUNDARY",
      );
    }
  });
});
