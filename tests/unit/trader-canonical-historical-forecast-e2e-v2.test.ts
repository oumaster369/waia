import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildHistoricalForecastAuthorityBootstrapV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-authority-bootstrap-v2";
import { buildHistoricalForecastCycleRuntimeInputV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-cycle-runtime-input-v2";
import { buildHistoricalForecastKnowledgeBootstrapV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-knowledge-bootstrap-v2";
import { computeHistoricalSimulationEmptyKnowledgeBindingDigestV2 } from
  "@/lib/trader/historical-simulation-v2/knowledge-snapshot-binding-v2";
import { buildHistoricalKnowledgeSnapshotAuthorityV2 } from
  "@/lib/trader/intelligence/forecast-v2/historical-knowledge-snapshot-authority-v2";
import { buildHistoricalForecastFamilyV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { buildHistoricalHypothesisApplicabilitySetV2 } from
  "@/lib/trader/historical-simulation-v2/hypothesis-applicability-v2";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { issueForecastRuntimeV2, requireForecastRuntimeAuthorizedOutcomeV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { persistForecastBundleV2, verifyHistoricalForecastInformationProofV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  computeReplicaRootFamilyIdentityDigest,
  digestHex,
} from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  buildPredictivePackageV1,
  type SourceAnchor,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import {
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
} from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { buildCanonicalRuntimeIntelligenceStateV1 } from
  "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import { buildHypothesisSet } from
  "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
import { createEmptyHypothesisSessionState } from
  "@/lib/trader/intelligence/mi-core.types";
import {
  buildHistoricalDatasetTrustAuthorityV2,
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import { bindInformationSufficiencyReceiptAuthorityV2 } from
  "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-runtime-authority-v2";
import { buildReconstructionSnapshot } from
  "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import { assembleReconstructionSnapshot } from
  "@/lib/trader/intelligence/reconstruction/reconstruction-assembly";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import {
  bucketIndexForReturn,
  computeTerminalTargetGridFromDevelopmentReturns,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { buildKmConvergenceReceiptV1 } from
  "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import {
  buildEpistemicParameterRatificationReceiptV1,
  buildPredictiveTerminalReceiptV1,
  buildScientificAdmissionReceiptV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import {
  makeUnderstandingEvidence,
  makeUnderstandingRequirement,
} from "@/tests/unit/helpers/market-understanding-evidence";

const organizationId = "00000000-0000-4000-8000-000000000001";
const releaseSha = "b".repeat(40);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const historicalEpistemicCutoff = "2026-01-02T12:00:00.000Z";
const historicalEpistemicAuthority = Object.freeze({
  schemaVersion: "waia.trader.historical_four_surface_ratified_admission.v2" as const,
  ratifiedAdmissionId: "11111111-1111-4111-8111-111111111111",
  authorityContentDigestHex: hash("historical-ratified-authority"),
  createdAt: historicalEpistemicCutoff,
});

function makeHistoricalUnderstandingEvidence(pitAnchor: string) {
  const base = makeUnderstandingEvidence({ availableAt: pitAnchor });
  const authority = buildHistoricalDatasetTrustAuthorityV2({
    organizationId,
    symbol: "BTCUSDT",
    runId: "canonical-e2e-run",
    releaseSha,
    ratifiedAdmissionId: historicalEpistemicAuthority.ratifiedAdmissionId,
    ratifiedAdmissionContentDigestHex:
      historicalEpistemicAuthority.authorityContentDigestHex,
    epistemicRecordCutoff: historicalEpistemicCutoff,
    datasetAuthorityId: "33333333-3333-4333-8333-333333333333",
    datasetAuthorityContentDigestHex: hash("dataset-authority-content"),
    datasetAuthorityDigestHex: hash("dataset-authority"),
    partitionRawSha256Hex: hash("partition-raw"),
    membershipContentDigestHex: hash("membership"),
    sealedCycleContentDigestHex: hash("sealed-cycle"),
    wfPredictiveSemanticContentDigestHex: hash("wf-predictive"),
    wfPredictiveStartUtc: new Date(Date.parse(pitAnchor) - 60_000).toISOString(),
    wfPredictiveEndUtc: pitAnchor,
    publicAvailableAt: pitAnchor,
    canonicalRecordAvailableAt: pitAnchor,
    canonicalRecordIngestTime: historicalEpistemicCutoff,
    sourceId: base.sourceId,
    trustAsOfReceiptId: base.trustAsOfReceiptId!,
    trustRevisionId: base.trustRevisionId!,
    trustRevisionContentDigestHex: base.trustRevisionContentDigest!,
    trustScore: base.trustScore!,
    observationId: base.observationId,
    observationContentDigestHex: base.observationContentDigest,
  });
  return makeUnderstandingEvidence({
    availableAt: pitAnchor,
    historyScope: "WALK_FORWARD_PREDICTIVE",
    historicalDatasetTrustAuthority: authority,
  });
}

function marketFixture(): { bars: Bar[]; latestQuote: Quote } {
  const startMs = Date.UTC(2026, 0, 1, 0, 0);
  const bars: Bar[] = Array.from({ length: 240 }, (_, index) => {
    const close = 100 + Math.sin(index / 6) * 0.04;
    return {
      symbol: "BTCUSDT",
      interval: "1m",
      open: close.toFixed(8),
      high: (close + 0.05).toFixed(8),
      low: (close - 0.05).toFixed(8),
      close: close.toFixed(8),
      volume: "10",
      barOpenTime: new Date(startMs + index * 60_000).toISOString(),
      barCloseTime: new Date(startMs + (index + 1) * 60_000).toISOString(),
    };
  });
  const latest = Number(bars.at(-1)!.close);
  return {
    bars,
    latestQuote: {
      symbol: "BTCUSDT",
      bid: (latest - 0.01).toFixed(8),
      ask: (latest + 0.01).toFixed(8),
      last: latest.toFixed(8),
      timestamp: bars.at(-1)!.barCloseTime,
    },
  };
}

function authorityGraph() {
  const family = buildHistoricalForecastFamilyV2({
    organizationId,
    symbol: "BTCUSDT",
    primaryHorizonMinutes: 30,
    developmentDatasetDigestHex: hash("development"),
    releaseSha,
  });
  const corpus: SourceAnchor[] = Array.from({ length: 180 }, (_, index) => ({
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    closedBarEpochMs: 1_700_000_000_000 + index * 60_000,
    barContentDigest: hash(`bar:${index}`),
    realizedVol20m_1m: 0.005 + (index % 30) * 0.001,
    outcome13d: [
      0.001, 0.002, 0.003, (index % 11 - 5) / 1000, 0.004, 0.005, 0.006,
      100, 101, 102, 103, 104, 105,
    ],
  }));
  const predictivePackage = buildPredictivePackageV1({
    family,
    sourceCorpus: corpus,
    kConfigDec: 10,
    mConfigDec: 20,
  });
  const packageDigest = digestHex(predictivePackage.predictivePackageContentDigest);
  const generationDigest = digestHex(
    predictivePackage.predictivePackageGenerationIdentityDigest,
  );
  const runtimeDigest = digestHex(predictivePackage.runtimeContractDigest);
  const km = buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: digestHex(
      computeReplicaRootFamilyIdentityDigest(family),
    ),
    kmGlobalAnchorSetDigestHex: hash("anchors"),
    candidateGenerationDigestsHex: [generationDigest],
    configurations: [{
      kConfig: 10,
      mConfig: 20,
      evLowerRelativeErrorP95: 0,
      evBaseRelativeErrorP95: 0,
      evUpperRelativeErrorP95: 0,
      mcEsRelativeErrorP95: 0,
      qualifies: true,
    }],
    selectedPackageGenerationIdentityDigestHex: generationDigest,
    selectedPackageContentDigestHex: packageDigest,
  });
  const developmentReturns = Array.from(
    { length: 400 },
    (_, index) => Math.sin(index / 17) * 0.02 + (index % 9) * 0.0005,
  );
  const historyReturns = Array.from(
    { length: 2500 },
    (_, index) => developmentReturns[index % developmentReturns.length]!,
  );
  const grid = computeTerminalTargetGridFromDevelopmentReturns(developmentReturns);
  const identities = {
    developmentDatasetDigestHex: family.developmentDatasetDigestHex,
    targetGridReceiptDigestHex: hash("grid"),
    predictivePackageGenerationIdentityDigestHex: generationDigest,
    predictivePackageContentDigestHex: packageDigest,
    runtimeContractDigestHex: runtimeDigest,
    scoringContractVersion: "multiclass-log-score/v1" as const,
    evaluationPartitionReceiptDigestHex: hash("walk-forward-partition"),
  };
  const predictiveTerminalReceipt = buildPredictiveTerminalReceiptV1({
    identities,
    harnessInput: {
      venue: "htx",
      market: "spot",
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      challengerPackageContentDigestHex: packageDigest,
      comparisonFamilyId: "historical-canonical-e2e-v2",
      evaluationPartitionReceiptDigestHex: identities.evaluationPartitionReceiptDigestHex,
      purgeDurationMinutes: 30,
      embargoDurationMinutes: 30,
      developmentReturns,
      historyReturns,
      historyReturnMinuteOpenTimesMs: historyReturns.map(
        (_, index) => 1_700_000_000_000 + index * 60_000,
      ),
      anchors: developmentReturns.slice(0, 24).map((observedReturn, index) => {
        const bucket = bucketIndexForReturn(observedReturn, grid);
        return {
          anchorId: `anchor-${index}`,
          observedReturn,
          challengerProbabilities: Array.from(
            { length: 7 },
            (_, candidate) => candidate === bucket ? 0.999 : 0.001 / 6,
          ),
        };
      }),
    },
  });
  const ratification = buildEpistemicParameterRatificationReceiptV1({
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex,
    selectedK: km.selectedK!,
    selectedM: km.selectedM!,
    alphaEpiConfigScale8: km.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigestHex: generationDigest,
    selectedPackageContentDigestHex: packageDigest,
    humanReceiptIdentityDigestHex: hash("ratification"),
  });
  const scientificAdmissionReceipt = buildScientificAdmissionReceiptV2({
    organizationId,
    predictiveTerminalReceipt,
    kmConvergenceReceipt: km,
    epistemicParameterRatificationReceipt: ratification,
  });
  const scientificAdmissionExpectedBindings = {
    organizationId,
    ...identities,
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex,
    epistemicParameterRatificationReceiptDigestHex: ratification.contentDigestHex,
    predictiveTerminalReceiptContentDigestHex: predictiveTerminalReceipt.contentDigestHex,
  };
  const authority = buildHistoricalForecastAuthorityBootstrapV2({
    organizationId,
    scientificAdmissionReceiptId: "22222222-2222-4222-8222-222222222222",
    scientificAdmissionReceipt,
    scientificAdmissionExpectedBindings,
    predictivePackage,
  });
  return {
    predictivePackage,
    scientificAdmissionReceipt,
    scientificAdmissionExpectedBindings,
    forecastContractBinding: authority.forecastContractBinding,
  };
}

function analyticalCycle(options: Readonly<{
  contradictory?: boolean;
  historicalProfile?: boolean;
  historicalDualTime?: boolean;
}> = {}) {
  const fixture = marketFixture();
  const pitAnchor = fixture.bars.at(-1)!.barCloseTime;
  const reconstruction = buildReconstructionSnapshot({
    bars1m: fixture.bars,
    evaluatedAt: pitAnchor,
  });
  expect(["RANGE", "CHOP"]).toContain(reconstruction.trendStructure.regimeBias);
  const supportingEvidence = [{
    evidenceId: "historical-evidence-for-mean-reversion",
    contentDigest: hash("historical-evidence-for-mean-reversion"),
    direction: "FOR" as const,
    eventTime: pitAnchor,
    ingestTime: options.historicalDualTime
      ? "2026-01-02T11:00:00.000Z"
      : pitAnchor,
  }];
  const canonicalState = buildCanonicalRuntimeIntelligenceStateV1({
    organizationId,
    symbol: "BTCUSDT",
    pitAnchor,
    ...(options.historicalDualTime
      ? {
          epistemicRecordCutoff: historicalEpistemicCutoff,
          epistemicAuthority: historicalEpistemicAuthority,
        }
      : {}),
    knowledgeSemanticDigest: hash("canonical-knowledge-state"),
    hypotheses: [{
      hypothesisId: "canonical-mean-reversion-v1",
      hypothesisKey: "mean-reversion-in-non-trend-regime",
      definitionDigest: hash("mean-reversion-definition"),
      createdAt: pitAnchor,
      hypothesisType: "mean_reversion",
      lifecycleState: "VALIDATED",
      rankOrdinal: 0,
      ordinalJudgment: "SUPPORTED",
      expectedPath: "revert_to_mean",
      invalidationConditions: ["trend_extension_beyond_band"],
      supportingEvidence,
      contradictingEvidence: options.contradictory ? [{
        evidenceId: "historical-evidence-against-mean-reversion",
        contentDigest: hash("historical-evidence-against-mean-reversion"),
        direction: "AGAINST" as const,
        eventTime: pitAnchor,
        ingestTime: pitAnchor,
      }] : [],
      knowledgeRefs: [{
        knowledgeEdgeId: "00000000-0000-4000-8000-000000000001",
        knowledgeState: "RESOLVED_CORRECT",
      }],
      supersedesHypothesisIds: [],
    }],
  });
  return {
    fixture,
    pitAnchor,
    canonicalState,
    evaluation: runEvaluationCycle({
      organizationId,
      symbol: "BTCUSDT",
      bars: fixture.bars,
      quote: fixture.latestQuote,
      reconstruction,
      canonicalRuntimeIntelligenceState: canonicalState,
      historicalProfile: options.historicalProfile === false
        ? undefined
        : HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      runId: "canonical-e2e-run",
      cycleId: "canonical-e2e-cycle",
      newId: () => "canonical-e2e-id",
    }),
  };
}

describe("canonical historical applicability to Forecast V2 authority", () => {
  it("closes a real evaluation result into an admitted input and authorized Forecast", async () => {
    // Exercise the full pure first-cycle chain with genuine historical dual
    // time: market evidence is old, while its durable record time is later but
    // still within the sealed pre-run ratification cutoff.
    const cycle = analyticalCycle({ historicalDualTime: true });
    expect(cycle.evaluation.hypothesisSet?.opportunity).toMatchObject({
      authorized: true,
      conviction: 0,
      sustainedCycles: 0,
      authority: "CANONICAL_HISTORICAL_APPLICABILITY_RECEIPT_V1",
      capitalAuthority: "NONE",
    });
    const graph = authorityGraph();
    const requiredInformationProfile = defineRequiredInformationProfileV2({
      organizationId,
      accountId: null,
      profileVersion: "canonical-historical-e2e-v2",
      purpose: "NEW_OPPORTUNITY",
      symbol: "BTCUSDT",
      venue: "htx",
      analyticalTimeframe: "1m",
      horizon: "30m",
      forecastPackageId: "rv-state-conditional-empirical-joint/v1",
      forecastPackageContentDigest:
        graph.forecastContractBinding.selectedPredictivePackageContentDigestHex,
      inputContractContentDigest: graph.forecastContractBinding.inputContract.contentDigestHex,
      requirements: [makeUnderstandingRequirement()],
      aggregateQualityContract: null,
    });
    const informationSufficiencyReceipt = evaluateInformationSufficiencyV2({
      profile: requiredInformationProfile,
      organizationId,
      accountId: null,
      purpose: "NEW_OPPORTUNITY",
      symbol: "BTCUSDT",
      venue: "htx",
      analyticalTimeframe: "1m",
      horizon: "30m",
      pitAnchor: cycle.pitAnchor,
      activeContextTriggers: [],
      evidence: [makeHistoricalUnderstandingEvidence(cycle.pitAnchor)],
    });
    expect(informationSufficiencyReceipt.status).toBe("SUFFICIENT");
    const evaluationWithInformation = runEvaluationCycle({
      organizationId,
      symbol: "BTCUSDT",
      bars: cycle.fixture.bars,
      quote: cycle.fixture.latestQuote,
      reconstruction: cycle.evaluation.reconstruction,
      canonicalRuntimeIntelligenceState: cycle.canonicalState,
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      fusedContext: {
        schemaVersion: "waia.trader.fused_context.v2",
        fusedAtUtc: cycle.pitAnchor,
        instrumentId: "BTC/USDT",
        sessionPhase: "UNKNOWN",
        mtfBars: {},
        aggregateHealth: "HEALTHY",
        aggregateConfidence: 1,
        provenance: [],
        degradationReasons: [],
      },
      informationSufficiencyAuthority: bindInformationSufficiencyReceiptAuthorityV2(
        requiredInformationProfile,
        informationSufficiencyReceipt,
      ),
      runId: "canonical-e2e-run",
      cycleId: "canonical-e2e-cycle-with-information",
      newId: () => "canonical-e2e-information-id",
    });
    const runtimeBuilderInput = {
      releaseSha,
      organizationId,
      runId: "canonical-e2e-run",
      accountId: null,
      symbol: "BTCUSDT",
      venue: "HTX",
      analyticalTimeframe: "1m",
      horizon: "30m",
      pitAnchor: cycle.pitAnchor,
      runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
      sourceProfileDigestHex: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
      representationProfileDigestHex: hash("representation-profile"),
      runtimeContext: { mode: "HISTORICAL_PRE_HOLDOUT_NON_CAPITAL" },
      knowledgeBootstrap: buildHistoricalForecastKnowledgeBootstrapV2({
        organizationId,
        symbol: "BTCUSDT",
        horizonMinutes: graph.predictivePackage.family.executionHorizonMinutes,
        predictivePackageContentDigestHex:
          digestHex(graph.predictivePackage.predictivePackageContentDigest),
      }),
      knowledgeSnapshotAuthority: buildHistoricalKnowledgeSnapshotAuthorityV2({
        organizationId,
        runId: "canonical-e2e-run",
        symbol: "BTCUSDT",
        pitAnchor: cycle.pitAnchor,
        visibleEvidenceCount: 0,
        knowledgeContentDigestHex:
          computeHistoricalSimulationEmptyKnowledgeBindingDigestV2(
            organizationId,
            "BTCUSDT",
          ),
      }),
      evaluation: evaluationWithInformation,
      requiredInformationProfile,
      informationSufficiencyReceipt,
      forecastContractBinding: graph.forecastContractBinding,
      scientificAdmissionReceipt: graph.scientificAdmissionReceipt,
      scientificAdmissionExpectedBindings: graph.scientificAdmissionExpectedBindings,
      predictivePackage: graph.predictivePackage,
      packageQuarantinedOrStale: false,
      integrityAndPitValid: true,
    } as const;
    const runtimeInput = buildHistoricalForecastCycleRuntimeInputV2(runtimeBuilderInput);
    expect(runtimeInput.knowledgeContentDigestHex).toBe(
      computeHistoricalSimulationEmptyKnowledgeBindingDigestV2(
        organizationId,
        "BTCUSDT",
      ),
    );
    expect(runtimeInput.knowledgeContentDigestHex).not.toBe(
      runtimeBuilderInput.knowledgeBootstrap.contentDigestHex,
    );
    const laterKnowledgeSnapshotAuthority = buildHistoricalKnowledgeSnapshotAuthorityV2({
      organizationId,
      runId: "canonical-e2e-run",
      symbol: "BTCUSDT",
      pitAnchor: cycle.pitAnchor,
      visibleEvidenceCount: 1,
      knowledgeContentDigestHex: hash("later-visible-confidence-update-snapshot"),
    });
    const laterRuntimeInput = buildHistoricalForecastCycleRuntimeInputV2({
      ...runtimeBuilderInput,
      knowledgeSnapshotAuthority: laterKnowledgeSnapshotAuthority,
    });
    expect(laterRuntimeInput.knowledgeContentDigestHex).toBe(
      laterKnowledgeSnapshotAuthority.knowledgeContentDigestHex,
    );
    expect(issueForecastRuntimeV2(laterRuntimeInput).status).toBe("FORECAST_AUTHORIZED");
    expect(() => buildHistoricalForecastCycleRuntimeInputV2({
      ...runtimeBuilderInput,
      knowledgeSnapshotAuthority: buildHistoricalKnowledgeSnapshotAuthorityV2({
        ...laterKnowledgeSnapshotAuthority,
        runId: "other-run",
      }),
    })).toThrow("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:KNOWLEDGE_SNAPSHOT");
    expect(runtimeInput.predictiveAdmissionReceipt).toMatchObject({
      verdict: "ADMITTED",
      capitalAuthority: "NONE",
    });
    const sealedSnapshot = runtimeInput.marketStateSnapshot!;
    expect(sealedSnapshot).toMatchObject({
      activeKnowledgeStateDigestHex: cycle.canonicalState.semanticDigest,
      selectedKnowledgeClaimDigestsHex: [
        cycle.evaluation.hypothesisSet!.activeHypothesis!.canonicalCausalLineageDigest,
      ],
    });
    expect(sealedSnapshot.selectedFailureBoundaryDigestsHex)
      .toHaveLength(1);
    const forecastOutcome = issueForecastRuntimeV2(runtimeInput);
    expect(forecastOutcome).toMatchObject({ status: "FORECAST_AUTHORIZED" });
    if (forecastOutcome.status !== "FORECAST_AUTHORIZED") throw new Error("expected forecast");
    const historicalPackage = runtimeInput.predictivePackage!;
    const genuineGeneralPackage = buildPredictivePackageV1({
      family: {
        ...historicalPackage.family,
        packageSubjectVersion: "general-package/v1",
      },
      sourceCorpus: historicalPackage.canonicalSourceCorpus,
      kConfigDec: historicalPackage.kConfigDec,
      mConfigDec: historicalPackage.mConfigDec,
      alphaEpiConfigScale8: historicalPackage.alphaEpiConfigScale8,
    });
    const downgradedPackageInput = {
      ...runtimeInput,
      predictivePackage: genuineGeneralPackage,
    };
    expect(issueForecastRuntimeV2(downgradedPackageInput)).toMatchObject({
      status: "NON_ACTIONABLE",
      reason: "PIT_OR_INPUT_MISMATCH",
    });
    const downgradedOutcome = {
      ...forecastOutcome,
      issuance: {
        ...forecastOutcome.issuance,
        package: downgradedPackageInput.predictivePackage,
      },
    };
    await expect(persistForecastBundleV2(
      (() => { throw new Error("database must not be reached"); }) as never,
      {
        organizationId,
        packageId: "77777777-7777-4777-8777-777777777777",
        runId: "canonical-e2e-run",
        cycleId: "canonical-e2e-cycle-with-information",
        symbol: "BTCUSDT",
        anchorClosedBarEpochMs: Date.parse(cycle.pitAnchor),
        issuance: downgradedOutcome.issuance,
        authorizedOutcome: downgradedOutcome,
        runtimeInput: downgradedPackageInput,
      },
    )).rejects.toThrow("historical information proof on general runtime refused");
    const {
      informationSufficiencyProfileContentDigestHex: _profileDigest,
      informationSufficiencyReceiptContentDigestHex: _receiptDigest,
      contentDigestHex: _authorityDigest,
      ...strippedAuthorityBody
    } = forecastOutcome.authority;
    void _profileDigest;
    void _receiptDigest;
    void _authorityDigest;
    expect(() => requireForecastRuntimeAuthorizedOutcomeV2({
      ...forecastOutcome,
      authority: {
        ...strippedAuthorityBody,
        contentDigestHex: computeSemanticSha256Hex(strippedAuthorityBody),
      },
    } as never)).toThrow("FORECAST_RUNTIME_AUTHORITY_INFORMATION_BINDING_INVALID");

    const substitutedState = buildCanonicalRuntimeIntelligenceStateV1({
      organizationId: cycle.canonicalState.organizationId,
      symbol: cycle.canonicalState.symbol,
      pitAnchor: cycle.canonicalState.pitAnchor,
      epistemicRecordCutoff: cycle.canonicalState.epistemicRecordCutoff,
      epistemicAuthority: cycle.canonicalState.epistemicAuthority,
      knowledgeSemanticDigest: hash("digest-consistent-substituted-knowledge"),
      hypotheses: cycle.canonicalState.hypotheses,
    });
    const attackerClaimDigest = hash("attacker-selected-knowledge-claim");
    const attackerFailureDigest = hash("attacker-selected-failure-boundary");
    const substitutedLegacyInput = {
      ...runtimeBuilderInput,
      activeKnowledgeState: substitutedState,
      selectedKnowledgeClaimDigestsHex: [attackerClaimDigest],
      selectedFailureBoundaryDigestsHex: [attackerFailureDigest],
    };
    const substitutionAttempt = buildHistoricalForecastCycleRuntimeInputV2(
      substitutedLegacyInput,
    );
    const substitutionSnapshot = substitutionAttempt.marketStateSnapshot!;
    expect(substitutionSnapshot.activeKnowledgeStateDigestHex)
      .toBe(cycle.canonicalState.semanticDigest);
    expect(substitutionSnapshot.selectedKnowledgeClaimDigestsHex)
      .toEqual(sealedSnapshot.selectedKnowledgeClaimDigestsHex);
    expect(substitutionSnapshot.selectedFailureBoundaryDigestsHex)
      .toEqual(sealedSnapshot.selectedFailureBoundaryDigestsHex);
    expect(substitutionSnapshot.selectedKnowledgeClaimDigestsHex)
      .not.toContain(attackerClaimDigest);
    expect(substitutionSnapshot.selectedFailureBoundaryDigestsHex)
      .not.toContain(attackerFailureDigest);
    expect(issueForecastRuntimeV2(substitutionAttempt))
      .toMatchObject({ status: "FORECAST_AUTHORIZED" });

    const sealedDataset = informationSufficiencyReceipt.evidenceInventory
      .find((evidence) => evidence.historyScope === "WALK_FORWARD_PREDICTIVE")!
      .historicalDatasetTrustAuthority!;
    await expect(verifyHistoricalForecastInformationProofV2(
      (() => { throw new Error("database must not be reached"); }) as never,
      {
        organizationId,
        runId: "canonical-e2e-run",
        cycleId: "canonical-e2e-cycle-with-information",
        symbol: "BTCUSDT",
        expectedDatasetAuthority: {
          id: "44444444-4444-4444-8444-444444444444",
          datasetAuthorityDigestHex: sealedDataset.datasetAuthorityDigestHex,
          authorityContentDigestHex: sealedDataset.datasetAuthorityContentDigestHex,
          membershipContentDigestHex: sealedDataset.membershipContentDigestHex,
          sealedCycleContentDigestHex: sealedDataset.sealedCycleContentDigestHex,
        },
        runtimeInput,
      },
    )).rejects.toThrow("historical dataset substitution");
    await expect(verifyHistoricalForecastInformationProofV2(
      (() => { throw new Error("database must not be reached"); }) as never,
      {
        organizationId,
        runId: "canonical-e2e-run",
        cycleId: "cross-cycle-substitution",
        symbol: "BTCUSDT",
        runtimeInput,
      },
    )).rejects.toThrow("historical cycle substitution");

    const unrelatedProfile = defineRequiredInformationProfileV2({
      organizationId,
      accountId: null,
      profileVersion: "canonical-historical-e2e-unrelated-v2",
      purpose: "NEW_OPPORTUNITY",
      symbol: "BTCUSDT",
      venue: "htx",
      analyticalTimeframe: "1m",
      horizon: "30m",
      forecastPackageId: "rv-state-conditional-empirical-joint/v1",
      forecastPackageContentDigest:
        graph.forecastContractBinding.selectedPredictivePackageContentDigestHex,
      inputContractContentDigest: graph.forecastContractBinding.inputContract.contentDigestHex,
      requirements: [makeUnderstandingRequirement()],
      aggregateQualityContract: null,
    });
    const unrelatedReceipt = evaluateInformationSufficiencyV2({
      profile: unrelatedProfile,
      organizationId,
      accountId: null,
      purpose: "NEW_OPPORTUNITY",
      symbol: "BTCUSDT",
      venue: "htx",
      analyticalTimeframe: "1m",
      horizon: "30m",
      pitAnchor: cycle.pitAnchor,
      activeContextTriggers: [],
      evidence: [makeHistoricalUnderstandingEvidence(cycle.pitAnchor)],
    });
    expect(() => buildHistoricalForecastCycleRuntimeInputV2({
      ...runtimeBuilderInput,
      requiredInformationProfile: unrelatedProfile,
      informationSufficiencyReceipt: unrelatedReceipt,
    })).toThrow("HISTORICAL_FORECAST_CYCLE_INPUT_REFUSED:UNDERSTANDING_AUTHORITY");
  });

  it("fails closed on contradictory canonical evidence", () => {
    expect(analyticalCycle({ contradictory: true }).evaluation.hypothesisSet?.opportunity)
      .toBeNull();
  });

  it("does not expose the canonical applicability path outside the historical profile", () => {
    expect(analyticalCycle({ historicalProfile: false }).evaluation.hypothesisSet?.opportunity)
      .toBeUndefined();
  });

  it("rejects a tampered applicability receipt instead of trusting an authorized flag", () => {
    const cycle = analyticalCycle();
    const hypothesisSet = cycle.evaluation.hypothesisSet!;
    const opportunity = hypothesisSet.opportunity!;
    const applicabilityReceipt = opportunity.applicabilityReceipt!;
    const result = buildHistoricalHypothesisApplicabilitySetV2({
      releaseSha,
      organizationId,
      symbol: "BTCUSDT",
      pitAnchor: cycle.pitAnchor,
      reconstruction: cycle.evaluation.reconstruction!,
      canonicalRuntimeIntelligenceState: cycle.evaluation.canonicalRuntimeIntelligenceState!,
      evaluationEnvelope: cycle.evaluation.intelligenceCycleBundle!.envelope,
      hypothesisSet: {
        ...hypothesisSet,
        opportunity: {
          ...opportunity,
          applicabilityReceiptContentDigestHex: hash("forged-receipt"),
          applicabilityReceipt: {
            ...applicabilityReceipt,
            contentDigestHex: hash("forged-receipt"),
          },
        },
      },
    });
    expect(result.assessments).toEqual([
      expect.objectContaining({ status: "NOT_APPLICABLE" }),
    ]);
  });

  it("rejects a validly re-digested reconstruction substituted after evaluation", () => {
    const cycle = analyticalCycle();
    const originalReconstruction = cycle.evaluation.reconstruction!;
    const substitutedReconstruction = assembleReconstructionSnapshot({
      instrumentId: originalReconstruction.instrumentId,
      evaluatedAt: originalReconstruction.evaluatedAt,
      marketStructure: originalReconstruction.marketStructure,
      liquidityStructure: originalReconstruction.liquidityStructure,
      trendStructure: originalReconstruction.trendStructure,
      volatilityStructure: originalReconstruction.volatilityStructure,
      participationStructure: originalReconstruction.participationStructure,
      contextStructure: {
        ...originalReconstruction.contextStructure,
        sessionPhase: "SUBSTITUTED_AFTER_EVALUATION",
      },
    });
    expect(substitutedReconstruction.contentDigest).not.toBe(
      originalReconstruction.contentDigest,
    );
    const substitutedHypothesisSet = buildHypothesisSet({
      reconstruction: substitutedReconstruction,
      evaluatedAt: cycle.pitAnchor,
      organizationId,
      symbol: "BTCUSDT",
      sessionState: createEmptyHypothesisSessionState(),
      canonicalRuntimeIntelligenceState: cycle.canonicalState,
      canonicalApplicabilityPurpose: "HISTORICAL_PRE_HOLDOUT_NON_CAPITAL",
    }).hypothesisSet;
    expect(substitutedHypothesisSet.opportunity?.authorized).toBe(true);
    const result = buildHistoricalHypothesisApplicabilitySetV2({
      releaseSha,
      organizationId,
      symbol: "BTCUSDT",
      pitAnchor: cycle.pitAnchor,
      reconstruction: substitutedReconstruction,
      canonicalRuntimeIntelligenceState: cycle.evaluation.canonicalRuntimeIntelligenceState!,
      evaluationEnvelope: cycle.evaluation.intelligenceCycleBundle!.envelope,
      hypothesisSet: substitutedHypothesisSet,
    });
    expect(result.assessments[0]?.status).toBe("NOT_APPLICABLE");
  });

  it("rejects a validly re-digested canonical state substituted after evaluation", () => {
    const cycle = analyticalCycle();
    const original = cycle.canonicalState;
    const substitutedState = buildCanonicalRuntimeIntelligenceStateV1({
      organizationId: original.organizationId,
      symbol: original.symbol,
      pitAnchor: original.pitAnchor,
      knowledgeSemanticDigest: hash("substituted-canonical-knowledge-state"),
      hypotheses: original.hypotheses,
    });
    expect(substitutedState.semanticDigest).not.toBe(original.semanticDigest);
    const substitutedHypothesisSet = buildHypothesisSet({
      reconstruction: cycle.evaluation.reconstruction!,
      evaluatedAt: cycle.pitAnchor,
      organizationId,
      symbol: "BTCUSDT",
      sessionState: createEmptyHypothesisSessionState(),
      canonicalRuntimeIntelligenceState: substitutedState,
      canonicalApplicabilityPurpose: "HISTORICAL_PRE_HOLDOUT_NON_CAPITAL",
    }).hypothesisSet;
    expect(substitutedHypothesisSet.opportunity?.authorized).toBe(true);
    const result = buildHistoricalHypothesisApplicabilitySetV2({
      releaseSha,
      organizationId,
      symbol: "BTCUSDT",
      pitAnchor: cycle.pitAnchor,
      reconstruction: cycle.evaluation.reconstruction!,
      canonicalRuntimeIntelligenceState: substitutedState,
      evaluationEnvelope: cycle.evaluation.intelligenceCycleBundle!.envelope,
      hypothesisSet: substitutedHypothesisSet,
    });
    expect(result.assessments[0]?.status).toBe("NOT_APPLICABLE");
  });
});
