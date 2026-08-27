import { describe, expect, it } from "vitest";

import { buildForecastContractBindingV1 } from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import {
  buildForecastInputContractV2,
  buildForecastModelArtifactV2,
  buildForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
} from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import {
  assessPredictiveAdmissionV1,
  buildMarketStateSnapshotV2,
  requireForecastRuntimeAdmittedPredictiveAdmissionV1,
} from "@/lib/trader/intelligence/predictive-admission/predictive-admission-v1";
import { MANDATORY_BASELINE_IDS } from "@/lib/trader/research/benchmark/baseline-models-v1";
import {
  bucketIndexForReturn,
  computeTerminalTargetGridFromDevelopmentReturns,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { buildKmConvergenceReceiptV1 } from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import {
  buildEpistemicParameterRatificationReceiptV1,
  buildPredictiveTerminalReceiptV1,
  buildScientificAdmissionReceiptV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import {
  makeUnderstandingEvidence,
  makeUnderstandingRequirement,
} from "@/tests/unit/helpers/market-understanding-evidence";

const hex = (char: string) => char.repeat(64);
const organizationId = "11111111-1111-4111-8111-111111111111";
const scientificAdmissionReceiptId = "22222222-2222-4222-8222-222222222222";

function scientificFixture() {
  const identities = {
    developmentDatasetDigestHex: hex("1"),
    targetGridReceiptDigestHex: hex("2"),
    predictivePackageGenerationIdentityDigestHex: hex("3"),
    predictivePackageContentDigestHex: hex("4"),
    runtimeContractDigestHex: hex("5"),
    scoringContractVersion: "multiclass-log-score/v1" as const,
    evaluationPartitionReceiptDigestHex: hex("6"),
  };
  const developmentReturns = Array.from(
    { length: 400 },
    (_, index) => Math.sin(index / 17) * 0.02 + (index % 9) * 0.0005,
  );
  const historyReturns = Array.from(
    { length: 2500 },
    (_, index) => developmentReturns[index % developmentReturns.length]!,
  );
  const grid = computeTerminalTargetGridFromDevelopmentReturns(developmentReturns);
  const observed = developmentReturns.slice(0, 24);
  const predictive = buildPredictiveTerminalReceiptV1({
    identities,
    harnessInput: {
      venue: "htx",
      market: "spot",
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      challengerPackageContentDigestHex: identities.predictivePackageContentDigestHex,
      comparisonFamilyId: "family-dee-647",
      evaluationPartitionReceiptDigestHex: identities.evaluationPartitionReceiptDigestHex,
      purgeDurationMinutes: 30,
      embargoDurationMinutes: 30,
      developmentReturns,
      historyReturns,
      historyReturnMinuteOpenTimesMs: historyReturns.map(
        (_, index) => 1_700_000_000_000 + index * 60_000,
      ),
      anchors: observed.map((observedReturn, index) => {
        const bucket = bucketIndexForReturn(observedReturn, grid);
        return {
          anchorId: `anchor-${index}`,
          observedReturn,
          challengerProbabilities: Array.from({ length: 7 }, (_, bucketIndex) =>
            bucketIndex === bucket ? 0.999 : 0.001 / 6,
          ),
        };
      }),
    },
  });
  expect(predictive.mandatoryBaselineIds).toEqual([...MANDATORY_BASELINE_IDS].sort());
  const km = buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: hex("8"),
    kmGlobalAnchorSetDigestHex: hex("9"),
    candidateGenerationDigestsHex: [hex("a")],
    configurations: [
      {
        kConfig: 10,
        mConfig: 20,
        evLowerRelativeErrorP95: 0.001,
        evBaseRelativeErrorP95: 0.001,
        evUpperRelativeErrorP95: 0.001,
        mcEsRelativeErrorP95: 0.001,
        qualifies: true,
      },
    ],
    selectedPackageGenerationIdentityDigestHex:
      identities.predictivePackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: identities.predictivePackageContentDigestHex,
  });
  const ratification = buildEpistemicParameterRatificationReceiptV1({
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex,
    selectedK: km.selectedK!,
    selectedM: km.selectedM!,
    alphaEpiConfigScale8: km.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigestHex:
      identities.predictivePackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: identities.predictivePackageContentDigestHex,
    humanReceiptIdentityDigestHex: hex("b"),
  });
  const receipt = buildScientificAdmissionReceiptV2({
    organizationId,
    predictiveTerminalReceipt: predictive,
    kmConvergenceReceipt: km,
    epistemicParameterRatificationReceipt: ratification,
  });
  return {
    receipt,
    identities,
    expected: {
      organizationId,
      ...identities,
      kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex,
      epistemicParameterRatificationReceiptDigestHex: ratification.contentDigestHex,
      predictiveTerminalReceiptContentDigestHex: predictive.contentDigestHex,
    },
  };
}

function fixture(purpose: "NEW_OPPORTUNITY" | "OPEN_POSITION_REASSESSMENT" | "RESEARCH_NON_CAPITAL" = "NEW_OPPORTUNITY") {
  const scientific = scientificFixture();
  const inputContract = buildForecastInputContractV2({
    measurementSemanticVersion: "realized-volatility-20m-from-1m/v2",
    hypothesisAssessmentSchemaVersion: "waia.trader.hypothesis_assessment.v1",
  });
  const modelSpec = buildForecastModelSpecV2({
    modelId: "champion-v1",
    modelTransformVersion: "transform-v1",
    inputContractDigestHex: inputContract.contentDigestHex,
    terminalTargetDefinitionDigestHex: hex("c"),
    executionOpportunityTargetDefinitionDigestHex: hex("d"),
  });
  const modelArtifact = buildForecastModelArtifactV2({
    modelSpecDigestHex: modelSpec.contentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    developmentDatasetDigestHex: scientific.identities.developmentDatasetDigestHex,
    runtimeContractDigestHex: scientific.identities.runtimeContractDigestHex,
    artifactPayloadDigestHex: hex("e"),
  });
  const binding = buildForecastContractBindingV1({
    organizationId,
    scientificAdmissionReceiptId,
    scientificAdmissionReceiptContentDigestHex: scientific.receipt.contentDigestHex,
    selectedPredictivePackageContentDigestHex:
      scientific.identities.predictivePackageContentDigestHex,
    inputContract,
    modelSpec,
    modelArtifact,
  });
  const pitAnchor = "2026-08-27T00:00:00.000Z";
  const requiredInformationProfile = defineRequiredInformationProfileV2({
    organizationId,
    accountId: null,
    profileVersion: "dee-647-test-profile-v1",
    purpose,
    symbol: "BTCUSDT",
    venue: "htx",
    analyticalTimeframe: "1m",
    horizon: "30m",
    forecastPackageId: "champion-v1",
    forecastPackageContentDigest: binding.selectedPredictivePackageContentDigestHex,
    inputContractContentDigest: binding.inputContract.contentDigestHex,
    requirements: [makeUnderstandingRequirement()],
    aggregateQualityContract: null,
  });
  const isg = evaluateInformationSufficiencyV2({
    profile: requiredInformationProfile,
    organizationId,
    accountId: null,
    purpose,
    symbol: "BTCUSDT",
    venue: "htx",
    analyticalTimeframe: "1m",
    horizon: "30m",
    pitAnchor,
    activeContextTriggers: [],
    evidence: [makeUnderstandingEvidence({ availableAt: "2026-08-26T23:59:30.000Z" })],
  });
  expect(isg.status).toBe("SUFFICIENT");
  const digest = hex("f");
  const snapshot = buildMarketStateSnapshotV2({
    organizationId,
    accountId: null,
    instrumentId: "BTC-USDT",
    symbol: "BTCUSDT",
    venue: "htx",
    analysisPurpose: purpose,
    analyticalTimeframe: "1m",
    horizon: "30m",
    pitAnchor,
    runtimeContextDigestHex: digest,
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    requiredInformationProfileDigestHex: requiredInformationProfile.contentDigest,
    informationSufficiencyReceiptDigestHex: isg.contentDigest,
    reconstructionDigestHex: hex("3"),
    stateRepresentationSpecDigestHex: hex("4"),
    dynamicStateDescriptorDigestHex: hex("5"),
    understandingClaimSetDigestHex: hex("6"),
    activeKnowledgeStateDigestHex: hex("7"),
    selectedKnowledgeClaimDigestsHex: [hex("8")],
    selectedFailureBoundaryDigestsHex: [hex("9")],
    hypothesisAssessmentSetDigestHex: hex("a"),
    consumedHypothesisAssessments: [
      {
        hypothesisAssessmentContentDigestHex: hex("b"),
        evaluatorIdentityDigestHex: hex("c"),
        status: "APPLICABLE",
      },
    ],
    sourceProfileDigestHex: hex("d"),
    representationProfileDigestHex: hex("e"),
    anchorRealizedVol20m_1m: 0.015,
    forecastContractBinding: binding,
  });
  const expected = {
    organizationId,
    symbol: snapshot.symbol,
    venue: snapshot.venue,
    analyticalTimeframe: snapshot.analyticalTimeframe,
    horizon: snapshot.horizon,
    sourceProfileDigestHex: snapshot.sourceProfileDigestHex,
    representationProfileDigestHex: snapshot.representationProfileDigestHex,
    stateRepresentationSpecDigestHex: snapshot.stateRepresentationSpecDigestHex,
    selectedPredictivePackageContentDigestHex:
      binding.selectedPredictivePackageContentDigestHex,
    inputContractDigestHex: binding.inputContract.contentDigestHex,
    modelSpecDigestHex: binding.modelSpec.contentDigestHex,
    modelArtifactDigestHex: binding.modelArtifact.contentDigestHex,
  };
  return { snapshot, requiredInformationProfile, isg, binding, scientific, expected };
}

describe("DEE-647 deterministic Predictive Admission", () => {
  it("replays identical PIT inputs and exact package authority to identical ADMITTED receipts", () => {
    const value = fixture();
    const input = {
      snapshot: value.snapshot,
      requiredInformationProfile: value.requiredInformationProfile,
      informationSufficiencyReceipt: value.isg,
      forecastContractBinding: value.binding,
      scientificAdmissionReceipt: value.scientific.receipt,
      scientificAdmissionExpectedBindings: value.scientific.expected,
      expected: value.expected,
      integrityAndPitValid: true,
      packageQuarantinedOrStale: false,
    };
    const first = assessPredictiveAdmissionV1(input);
    expect(first).toEqual(assessPredictiveAdmissionV1(input));
    expect(first.verdict).toBe("ADMITTED");
    expect(first.blockingReasons).toEqual([]);
    expect(requireForecastRuntimeAdmittedPredictiveAdmissionV1(first)).toBe(first);
  });

  it("keeps Hypothesis applicability outside mathematical input identity", () => {
    const first = fixture();
    const second = buildMarketStateSnapshotV2({
      ...first.snapshot,
      consumedHypothesisAssessments: [
        {
          hypothesisAssessmentContentDigestHex: hex("9"),
          evaluatorIdentityDigestHex: hex("8"),
          status: "APPLICABLE",
        },
      ],
      hypothesisAssessmentSetDigestHex: hex("7"),
      forecastContractBinding: first.binding,
    });
    expect(second.mathematicalInputDigestHex).toBe(first.snapshot.mathematicalInputDigestHex);
    expect(second.applicabilityPrerequisiteDigestHex).not.toBe(
      first.snapshot.applicabilityPrerequisiteDigestHex,
    );
  });

  it.each<[
    string,
    {
      isgStatus?: "INSUFFICIENT";
      missingScientific?: boolean;
      blockedHypothesis?: boolean;
      quarantined?: boolean;
    },
    string,
  ]>([
    ["insufficient ISG", { isgStatus: "INSUFFICIENT" }, "ISG_NOT_SUFFICIENT"],
    ["missing scientific receipt", { missingScientific: true }, "SCIENTIFIC_ADMISSION_MISSING_OR_MISMATCHED"],
    ["blocked applicability", { blockedHypothesis: true }, "HYPOTHESIS_NOT_APPLICABLE"],
    ["quarantine", { quarantined: true }, "PACKAGE_QUARANTINED_OR_STALE"],
  ])("fails closed for %s", (_label, mutation, reason) => {
    const value = fixture();
    const snapshot = mutation.blockedHypothesis
      ? buildMarketStateSnapshotV2({
          ...value.snapshot,
          consumedHypothesisAssessments: [
            {
              hypothesisAssessmentContentDigestHex: hex("b"),
              evaluatorIdentityDigestHex: hex("c"),
              status: "BLOCKED",
            },
          ],
          forecastContractBinding: value.binding,
        })
      : value.snapshot;
    const result = assessPredictiveAdmissionV1({
      snapshot,
      requiredInformationProfile: value.requiredInformationProfile,
      informationSufficiencyReceipt: {
        ...value.isg,
        status: mutation.isgStatus ?? value.isg.status,
      },
      forecastContractBinding: value.binding,
      scientificAdmissionReceipt: mutation.missingScientific ? null : value.scientific.receipt,
      scientificAdmissionExpectedBindings: value.scientific.expected,
      expected: value.expected,
      integrityAndPitValid: true,
      packageQuarantinedOrStale: mutation.quarantined ?? false,
    });
    expect(result.verdict).toBe("NOT_ADMITTED");
    expect(result.blockingReasons).toContain(reason);
  });

  it("preserves posture monotonicity while allowing non-new-risk reassessment", () => {
    const reassessment = fixture("OPEN_POSITION_REASSESSMENT");
    const snapshot = buildMarketStateSnapshotV2({
      ...reassessment.snapshot,
      runtimePosture: "CLOSE_ONLY",
      forecastContractBinding: reassessment.binding,
    });
    const result = assessPredictiveAdmissionV1({
      snapshot,
      requiredInformationProfile: reassessment.requiredInformationProfile,
      informationSufficiencyReceipt: reassessment.isg,
      forecastContractBinding: reassessment.binding,
      scientificAdmissionReceipt: reassessment.scientific.receipt,
      scientificAdmissionExpectedBindings: reassessment.scientific.expected,
      expected: reassessment.expected,
      integrityAndPitValid: true,
      packageQuarantinedOrStale: false,
    });
    expect(result.verdict).toBe("ADMITTED");

    const newRisk = fixture();
    const blocked = assessPredictiveAdmissionV1({
      snapshot: buildMarketStateSnapshotV2({
        ...newRisk.snapshot,
        runtimePosture: "NO_NEW_RISK",
        forecastContractBinding: newRisk.binding,
      }),
      requiredInformationProfile: newRisk.requiredInformationProfile,
      informationSufficiencyReceipt: newRisk.isg,
      forecastContractBinding: newRisk.binding,
      scientificAdmissionReceipt: newRisk.scientific.receipt,
      scientificAdmissionExpectedBindings: newRisk.scientific.expected,
      expected: newRisk.expected,
      integrityAndPitValid: true,
      packageQuarantinedOrStale: false,
    });
    expect(blocked.blockingReasons).toContain("NEW_RISK_NOT_PERMITTED");
  });

  it("brands research admission as non-capital", () => {
    const value = fixture("RESEARCH_NON_CAPITAL");
    const result = assessPredictiveAdmissionV1({
      snapshot: value.snapshot,
      requiredInformationProfile: value.requiredInformationProfile,
      informationSufficiencyReceipt: value.isg,
      forecastContractBinding: value.binding,
      scientificAdmissionReceipt: value.scientific.receipt,
      scientificAdmissionExpectedBindings: value.scientific.expected,
      expected: value.expected,
      integrityAndPitValid: true,
      packageQuarantinedOrStale: false,
    });
    expect(result).toMatchObject({ verdict: "RESEARCH_ONLY", capitalAuthority: "NONE" });
    expect(() => requireForecastRuntimeAdmittedPredictiveAdmissionV1(result)).toThrow(
      "PREDICTIVE_ADMISSION_NOT_FORECAST_RUNTIME_ADMITTED",
    );
  });

  it("rejects forged ISG receipts even when their declared identity fields match", () => {
    const value = fixture();
    const result = assessPredictiveAdmissionV1({
      snapshot: value.snapshot,
      requiredInformationProfile: value.requiredInformationProfile,
      informationSufficiencyReceipt: {
        ...value.isg,
        evidenceInventory: [],
      },
      forecastContractBinding: value.binding,
      scientificAdmissionReceipt: value.scientific.receipt,
      scientificAdmissionExpectedBindings: value.scientific.expected,
      expected: value.expected,
      integrityAndPitValid: true,
      packageQuarantinedOrStale: false,
    });
    expect(result.blockingReasons).toContain("ISG_IDENTITY_MISMATCH");
  });

  it("rejects a scientific receipt cross-bound to a different model artifact", () => {
    const value = fixture();
    const mismatchedArtifact = buildForecastModelArtifactV2({
      modelSpecDigestHex: value.binding.modelSpec.contentDigestHex,
      inputContractDigestHex: value.binding.inputContract.contentDigestHex,
      developmentDatasetDigestHex: hex("0"),
      runtimeContractDigestHex: value.scientific.identities.runtimeContractDigestHex,
      artifactPayloadDigestHex: hex("e"),
    });
    const mismatchedBinding = buildForecastContractBindingV1({
      organizationId,
      scientificAdmissionReceiptId,
      scientificAdmissionReceiptContentDigestHex: value.scientific.receipt.contentDigestHex,
      selectedPredictivePackageContentDigestHex:
        value.scientific.identities.predictivePackageContentDigestHex,
      inputContract: value.binding.inputContract,
      modelSpec: value.binding.modelSpec,
      modelArtifact: mismatchedArtifact,
    });
    const snapshot = buildMarketStateSnapshotV2({
      ...value.snapshot,
      forecastContractBinding: mismatchedBinding,
    });
    const result = assessPredictiveAdmissionV1({
      snapshot,
      requiredInformationProfile: value.requiredInformationProfile,
      informationSufficiencyReceipt: value.isg,
      forecastContractBinding: mismatchedBinding,
      scientificAdmissionReceipt: value.scientific.receipt,
      scientificAdmissionExpectedBindings: value.scientific.expected,
      expected: {
        ...value.expected,
        modelArtifactDigestHex: mismatchedArtifact.contentDigestHex,
      },
      integrityAndPitValid: true,
      packageQuarantinedOrStale: false,
    });
    expect(result.blockingReasons).toContain("SCIENTIFIC_ADMISSION_MISSING_OR_MISMATCHED");
  });

  it("rejects forged runtime admission receipts and unknown semantic enums", () => {
    const value = fixture();
    const admitted = assessPredictiveAdmissionV1({
      snapshot: value.snapshot,
      requiredInformationProfile: value.requiredInformationProfile,
      informationSufficiencyReceipt: value.isg,
      forecastContractBinding: value.binding,
      scientificAdmissionReceipt: value.scientific.receipt,
      scientificAdmissionExpectedBindings: value.scientific.expected,
      expected: value.expected,
      integrityAndPitValid: true,
      packageQuarantinedOrStale: false,
    });
    expect(() =>
      requireForecastRuntimeAdmittedPredictiveAdmissionV1({
        ...admitted,
        capitalAuthority: "LIVE" as "NONE",
      }),
    ).toThrow("PREDICTIVE_ADMISSION_NOT_FORECAST_RUNTIME_ADMITTED");
    for (const mutation of [
      { scientificAdmissionReceiptContentDigestHex: null },
      { analysisPurpose: "RESEARCH_NON_CAPITAL" as const },
    ]) {
      const tamperedBody: Record<string, unknown> = { ...admitted, ...mutation };
      delete tamperedBody.contentDigestHex;
      const tampered = {
        ...tamperedBody,
        contentDigestHex: computeSemanticSha256Hex(tamperedBody),
      } as typeof admitted;
      expect(() => requireForecastRuntimeAdmittedPredictiveAdmissionV1(tampered)).toThrow(
        "PREDICTIVE_ADMISSION_NOT_FORECAST_RUNTIME_ADMITTED",
      );
    }
    expect(() =>
      buildMarketStateSnapshotV2({
        ...value.snapshot,
        runtimePosture: "UNKNOWN" as "HALT",
        forecastContractBinding: value.binding,
      }),
    ).toThrow("PREDICTIVE_ADMISSION_INVALID:runtimePosture");

    const invalidBody: Record<string, unknown> = {
      ...value.snapshot,
      analysisPurpose: "UNKNOWN" as "OPEN_POSITION_REASSESSMENT",
    };
    delete invalidBody.contentDigestHex;
    const invalidSnapshot = {
      ...invalidBody,
      contentDigestHex: computeSemanticSha256Hex(invalidBody),
    } as typeof value.snapshot;
    const result = assessPredictiveAdmissionV1({
      snapshot: invalidSnapshot,
      requiredInformationProfile: value.requiredInformationProfile,
      informationSufficiencyReceipt: value.isg,
      forecastContractBinding: value.binding,
      scientificAdmissionReceipt: value.scientific.receipt,
      scientificAdmissionExpectedBindings: value.scientific.expected,
      expected: value.expected,
      integrityAndPitValid: true,
      packageQuarantinedOrStale: false,
    });
    expect(result.blockingReasons).toContain("PIT_OR_INTEGRITY_INVALID");
  });
});
