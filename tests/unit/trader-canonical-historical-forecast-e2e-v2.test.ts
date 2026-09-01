import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildHistoricalForecastAuthorityBootstrapV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-authority-bootstrap-v2";
import { buildHistoricalForecastCycleRuntimeInputV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-cycle-runtime-input-v2";
import { buildHistoricalForecastKnowledgeBootstrapV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-knowledge-bootstrap-v2";
import { buildHistoricalForecastFamilyV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { buildHistoricalHypothesisApplicabilitySetV2 } from
  "@/lib/trader/historical-simulation-v2/hypothesis-applicability-v2";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { issueForecastRuntimeV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
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
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
} from "@/lib/trader/intelligence/information-sufficiency";
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
    ingestTime: pitAnchor,
  }];
  const canonicalState = buildCanonicalRuntimeIntelligenceStateV1({
    organizationId,
    symbol: "BTCUSDT",
    pitAnchor,
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
  it("closes a real evaluation result into an admitted input and authorized Forecast", () => {
    const cycle = analyticalCycle();
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
      evidence: [makeUnderstandingEvidence({ availableAt: cycle.pitAnchor })],
    });
    expect(informationSufficiencyReceipt.status).toBe("SUFFICIENT");
    const runtimeInput = buildHistoricalForecastCycleRuntimeInputV2({
      releaseSha,
      organizationId,
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
      activeKnowledgeState: cycle.canonicalState,
      selectedKnowledgeClaimDigestsHex: [cycle.canonicalState.semanticDigest],
      selectedFailureBoundaryDigestsHex: [],
      knowledgeBootstrap: buildHistoricalForecastKnowledgeBootstrapV2({
        organizationId,
        symbol: "BTCUSDT",
        horizonMinutes: graph.predictivePackage.family.executionHorizonMinutes,
        predictivePackageContentDigestHex:
          digestHex(graph.predictivePackage.predictivePackageContentDigest),
      }),
      evaluation: cycle.evaluation,
      requiredInformationProfile,
      informationSufficiencyReceipt,
      forecastContractBinding: graph.forecastContractBinding,
      scientificAdmissionReceipt: graph.scientificAdmissionReceipt,
      scientificAdmissionExpectedBindings: graph.scientificAdmissionExpectedBindings,
      predictivePackage: graph.predictivePackage,
      packageQuarantinedOrStale: false,
      integrityAndPitValid: true,
    });
    expect(runtimeInput.predictiveAdmissionReceipt).toMatchObject({
      verdict: "ADMITTED",
      capitalAuthority: "NONE",
    });
    const forecastOutcome = issueForecastRuntimeV2(runtimeInput);
    expect(forecastOutcome).toMatchObject({ status: "FORECAST_AUTHORIZED" });
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
