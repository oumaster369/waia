import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  requireForecastModelArtifactV2,
  type ForecastModelArtifactV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import {
  runResearchHarnessAdmissionV1,
  type ResearchHarnessAdmissionInputV1,
} from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";
import {
  requireModelTrialSpecV2,
  type ModelTrialSpecV2,
} from "@/lib/trader/research/forecast-model-registry";

export type ChallengerQualificationCandidateV2 = Readonly<{
  trialSpec: ModelTrialSpecV2;
  artifact: ForecastModelArtifactV2;
  harnessInput: ResearchHarnessAdmissionInputV1;
}>;

function comparisonSurface(input: ResearchHarnessAdmissionInputV1) {
  return {
    venue: input.venue,
    market: input.market,
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    evaluationPartitionReceiptDigestHex: input.evaluationPartitionReceiptDigestHex,
    purgeDurationMinutes: input.purgeDurationMinutes,
    embargoDurationMinutes: input.embargoDurationMinutes,
    comparisonFamilyId: input.comparisonFamilyId,
    developmentReturns: input.developmentReturns,
    historyReturns: input.historyReturns,
    historyReturnMinuteOpenTimesMs: input.historyReturnMinuteOpenTimesMs,
    anchors: input.anchors.map((anchor) => ({
      anchorId: anchor.anchorId,
      observedReturn: anchor.observedReturn,
    })),
  };
}

/**
 * Delegates qualification to the already-ratified WF_PREDICTIVE harness. This
 * module never substitutes a one-anchor arena score for purge/embargo,
 * mandatory-baseline, B=10000 stationary-bootstrap or Holm-FWER admission.
 */
export function qualifyChallengerCandidatesV2(
  candidates: readonly ChallengerQualificationCandidateV2[],
) {
  if (candidates.length === 0) throw new Error("CHALLENGER_QUALIFICATION_EMPTY");
  const commonSurfaceDigestHex = computeSemanticSha256Hex(
    comparisonSurface(candidates[0]!.harnessInput),
  );
  const seenModelIds = new Set<string>();
  const seenModelSpecs = new Set<string>();
  const results = candidates
    .map((candidate) => {
      const trial = requireModelTrialSpecV2(candidate.trialSpec);
      const artifact = requireForecastModelArtifactV2(candidate.artifact);
      if (
        seenModelIds.has(trial.modelSpec.modelId) ||
        seenModelSpecs.has(trial.modelSpec.contentDigestHex)
      )
        throw new Error("CHALLENGER_QUALIFICATION_DUPLICATE_MODEL");
      seenModelIds.add(trial.modelSpec.modelId);
      seenModelSpecs.add(trial.modelSpec.contentDigestHex);
      if (trial.readiness !== "EXECUTOR_READY")
        throw new Error(`CHALLENGER_QUALIFICATION_NOT_EXECUTABLE:${trial.readiness}`);
      if (
        artifact.modelSpecDigestHex !== trial.modelSpec.contentDigestHex ||
        artifact.inputContractDigestHex !== trial.modelSpec.inputContractDigestHex
      )
        throw new Error("CHALLENGER_QUALIFICATION_ARTIFACT_MISMATCH");
      if (
        candidate.harnessInput.challengerPackageContentDigestHex !==
        artifact.artifactPayloadDigestHex
      )
        throw new Error("CHALLENGER_QUALIFICATION_PACKAGE_MISMATCH");
      if (
        computeSemanticSha256Hex(comparisonSurface(candidate.harnessInput)) !==
        commonSurfaceDigestHex
      )
        throw new Error("CHALLENGER_QUALIFICATION_COMMON_SURFACE_MISMATCH");
      return {
        modelId: trial.modelSpec.modelId,
        modelTrialSpecDigestHex: trial.contentDigestHex,
        artifactContentDigestHex: artifact.contentDigestHex,
        terminalAdmission: runResearchHarnessAdmissionV1(candidate.harnessInput),
        capitalEligible: false as const,
      };
    })
    .sort((a, b) => a.modelId.localeCompare(b.modelId));
  const body = {
    schemaVersion: "waia.trader.challenger_qualification_evidence.v2" as const,
    commonSurfaceDigestHex,
    results,
    qualificationScope:
      "WF_PREDICTIVE_TERMINAL_REQUIRES_DEE532_JOINT_AND_DEE631_ADMISSION" as const,
    capitalEligible: false as const,
  };
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}
