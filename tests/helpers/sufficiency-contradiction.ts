import { createHash } from "node:crypto";

import {
  computeInformationContradictionMaterialityEvaluationDigestV1,
  defineInformationInquiryPolicyV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import type { BuildInformationNeedPlanV1Input } from "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1";
import { defineTopDownReconstructionV1 } from "@/lib/trader/intelligence/information-inquiry/top-down-reconstruction-v1";
import {
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
  type InformationEvidenceV2,
  type InformationQuestionRequirementV2,
  type RequiredInformationProfileV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import { CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/canonical-observation-v1";

export const sufficiencyHex = (value: string) => createHash("sha256").update(value).digest("hex");
export const SUFFICIENCY_PIT = "2026-09-01T12:00:00.000Z";

export function contradictionProfile(
  requirement: Partial<InformationQuestionRequirementV2> = {},
  overrides: Partial<Parameters<typeof defineRequiredInformationProfileV2>[0]> = {},
) {
  return defineRequiredInformationProfileV2({
    organizationId: "org-contradiction", accountId: "account-contradiction",
    profileVersion: "contradiction-regression-v1", purpose: "NEW_OPPORTUNITY",
    symbol: "BTC/USDT", venue: "HTX", analyticalTimeframe: "1m", horizon: "15m",
    forecastPackageId: null, forecastPackageContentDigest: null,
    inputContractContentDigest: null, aggregateQualityContract: null,
    requirements: [{
      id: "price", questionId: "Q_WHAT_HAPPENING", classification: "MANDATORY",
      contextTriggerKey: null,
      satisfiers: [{ evidenceFamily: "price", providerIds: ["htx_spot"], substitutionRuleId: null }],
      allowedObservationKinds: ["ohlcv_bar"],
      allowedObservationSchemaVersions: [CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION],
      allowedMeasurementDefinitionDigests: [], maxStalenessMs: 60_000,
      minimumTrustScore: 0.5, minimumIndependentGroups: 1,
      contradictionPolicy: "FAIL_UNRESOLVED", requirePitQualified: true, requireReplayEligible: true,
      inquiryBounds: { maxDepth: 1, maxDurationMs: 1_000, maxProviderFanout: 1 },
      ...requirement,
    }],
    ...overrides,
  });
}

export function contradictionEvidence(
  id: string,
  contradiction: InformationEvidenceV2["contradiction"],
  overrides: Partial<InformationEvidenceV2> = {},
): InformationEvidenceV2 {
  return {
    evidenceId: id, evidenceFamily: "price", providerId: "htx_spot", sourceId: "source-a",
    observationId: id, observationKind: "ohlcv_bar",
    observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    observationContentDigest: sufficiencyHex(id), trustAsOfReceiptId: sufficiencyHex("trust"),
    trustRevisionId: "trust-a", trustRevisionContentDigest: sufficiencyHex("trust-a"),
    measurementDefinitionId: null, measurementDefinitionContentDigest: null,
    measurementValueId: null, measurementValueContentDigest: null,
    availability: "AVAILABLE", availableAt: "2026-09-01T11:59:30.000Z",
    trust: "TRUSTED", trustScore: 0.9, pitQualified: true, replayEligible: true,
    dependenceGroup: "source-group", contradictionGroup: "same-price-claim", contradiction,
    epistemicRole: "PRICE_STATE", historyScope: "NOT_HISTORICAL", degradationReasonCodes: [],
    ...overrides,
  };
}

export function evaluateContradiction(
  profile: RequiredInformationProfileV2,
  evidence: readonly InformationEvidenceV2[],
  overrides: Partial<Parameters<typeof evaluateInformationSufficiencyV2>[0]> = {},
) {
  return evaluateInformationSufficiencyV2({
    profile, organizationId: profile.organizationId, accountId: profile.accountId,
    purpose: profile.purpose, symbol: profile.symbol, venue: profile.venue,
    analyticalTimeframe: profile.analyticalTimeframe, horizon: profile.horizon,
    pitAnchor: SUFFICIENCY_PIT, activeContextTriggers: [], evidence, ...overrides,
  });
}

export function contradictionPlanningInput(
  profile: RequiredInformationProfileV2,
  receipt: ReturnType<typeof evaluateContradiction>,
  withLineage: boolean,
): BuildInformationNeedPlanV1Input {
  const frames = ["1d", "4h", "1h", "15m", "1m"] as const;
  const roles = ["STRATEGIC_CONTEXT", "STRUCTURAL_REFINEMENT", "OPERATIONAL_STATE", "SETUP_CONFIRMATION", "EXECUTION_PRECISION"] as const;
  const materiality = {
    claimId: "same-price-claim", materiality: "MATERIAL" as const,
    evidenceIds: receipt.evidenceInventory.map((item) => item.evidenceId),
    observationIds: receipt.evidenceInventory.map((item) => item.observationId),
    observationContentDigests: receipt.evidenceInventory.map((item) => ({
      observationId: item.observationId, observationContentDigest: item.observationContentDigest,
    })),
    observationContradictionStates: receipt.evidenceInventory.map((item) => ({
      observationId: item.observationId, contradiction: item.contradiction,
    })),
    providerIds: ["htx_spot"], dependenceGroups: ["source-group"],
    materialityPolicyVersion: "test-materiality-v1",
    materialityPolicyContentDigest: sufficiencyHex("materiality"),
  };
  return {
    derivationVersion: "contradiction-planning-v1", profile, receipt,
    policy: defineInformationInquiryPolicyV1({
      policyVersion: "test-inquiry-v1", purpose: "NEW_OPPORTUNITY_SEARCH",
      timeframePolicies: frames.map((timeframe) => ({
        timeframe, relevantRequirementIds: timeframe === "1m" ? ["price"] : [],
        maxStalenessMsByRequirement: timeframe === "1m"
          ? [{ requirementId: "price", maxStalenessMs: 60_000 }] : [],
      })),
      bounds: { maxIterations: 1, maxDepth: 1, maxDurationMs: 1_000, maxProviderFanout: 1,
        maxQueryCount: 1, maxHistoricalResults: 1, maxAcquisitionCostUnits: 1 },
      costPolicy: { evaluatorVersion: "test-cost-v1", evaluatorContentDigest: sufficiencyHex("cost"),
        assignments: [{ requirementId: "price", providerId: "htx_spot", costUnits: 1 }] },
      contradictionMaterialityPolicyVersion: materiality.materialityPolicyVersion,
      contradictionMaterialityPolicyDigest: materiality.materialityPolicyContentDigest,
      schedulingPolicyVersion: "test-scheduler-v1", schedulingPolicyDigest: sufficiencyHex("scheduler"),
      maxNewOpportunityWaitTurns: 2,
    }),
    topDownReconstruction: defineTopDownReconstructionV1({
      symbol: profile.symbol, pitAnchor: SUFFICIENCY_PIT,
      states: frames.map((timeframe, index) => ({
        timeframe, role: roles[index]!, status: "AVAILABLE", stateContentDigest: sufficiencyHex(timeframe),
        evidenceIds: [`state-${timeframe}`], reasonCodes: ["INERT_TEST_STATE"],
      })),
      relations: frames.slice(0, -1).map((higherTimeframe, index) => ({
        higherTimeframe, lowerTimeframe: frames[index + 1]!, relation: "UNCLEAR",
        relationPolicyVersion: "test-relation-v1", relationPolicyContentDigest: sufficiencyHex("relation"),
        evidenceIds: [`state-${higherTimeframe}`, `state-${frames[index + 1]}`],
        reasonCodes: ["INERT_TEST_RELATION"],
      })),
      upwardReevaluationRequests: [],
    }),
    iterationIndex: 0, queryCountConsumed: 0, acquisitionCostUnitsConsumed: 0,
    availableProviderIds: ["htx_spot"], analogueRequests: [], hypothesisDiscriminators: [],
    contradictions: withLineage ? [{ requirementId: "price", lineage: {
      ...materiality, questionId: "Q_WHAT_HAPPENING",
      materialityEvaluationContentDigest: computeInformationContradictionMaterialityEvaluationDigestV1(materiality),
      reasonCodes: ["INERT_TEST_MATERIALITY"],
    } }] : [],
  };
}
