import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  computeInquiryContentDigest,
  defineInformationInquiryPolicyV1,
  runInformationInquiryRuntimeV1,
  type BuildInformationNeedPlanV1Input,
  type InformationAcquisitionSelectionV1,
} from "@/lib/trader/intelligence/information-inquiry";
import { defineTopDownReconstructionV1 } from "@/lib/trader/intelligence/information-inquiry/top-down-reconstruction-v1";
import {
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
  type InformationEvidenceV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import { CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/canonical-observation-v1";
import {
  INFORMATION_ACQUISITION_RECEIPT_V1_SCHEMA_VERSION,
  type InformationAcquisitionReceiptV1,
} from "@/lib/trader/market-data/types";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import type { GatewayPollResult } from "@/lib/trader/market-data/market-data-gateway";
import { resolveHtxInformationInquiryCycleV1 } from "@/lib/trader/paper/paper-cycle-runner";

const PIT = "2026-08-24T12:00:00.000Z";
const hex = (value: string) => createHash("sha256").update(value).digest("hex");

function evidence(): InformationEvidenceV2 {
  return {
    evidenceId: "price-evidence",
    evidenceFamily: "price",
    providerId: "htx_spot",
    sourceId: "source-a",
    observationId: "observation-a",
    observationKind: "ohlcv_bar",
    observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    observationContentDigest: hex("observation"),
    trustAsOfReceiptId: hex("trust-as-of"),
    trustRevisionId: "trust-revision-a",
    trustRevisionContentDigest: hex("trust-revision"),
    measurementDefinitionId: null,
    measurementDefinitionContentDigest: null,
    measurementValueId: null,
    measurementValueContentDigest: null,
    availability: "AVAILABLE",
    availableAt: "2026-08-24T11:59:30.000Z",
    trust: "TRUSTED",
    trustScore: 1,
    pitQualified: true,
    replayEligible: true,
    dependenceGroup: "price-group-a",
    contradictionGroup: null,
    contradiction: "NONE",
    epistemicRole: "PRICE_STATE",
    historyScope: "NOT_HISTORICAL",
    degradationReasonCodes: [],
  };
}

function planningInput(initialEvidence: readonly InformationEvidenceV2[]): BuildInformationNeedPlanV1Input {
  const profile = defineRequiredInformationProfileV2({
    organizationId: "org-a",
    accountId: "account-a",
    profileVersion: "profile-v1",
    purpose: "NEW_OPPORTUNITY",
    symbol: "BTC/USDT",
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: "15m",
    forecastPackageId: null,
    forecastPackageContentDigest: null,
    inputContractContentDigest: null,
    requirements: [
      {
        id: "price-state",
        questionId: "Q_WHAT_HAPPENING",
        classification: "MANDATORY",
        contextTriggerKey: null,
        satisfiers: [
          { evidenceFamily: "price", providerIds: ["htx_spot"], substitutionRuleId: null },
        ],
        allowedObservationKinds: ["ohlcv_bar"],
        allowedObservationSchemaVersions: [CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION],
        allowedMeasurementDefinitionDigests: [],
        maxStalenessMs: 60_000,
        minimumTrustScore: 0.5,
        minimumIndependentGroups: 1,
        contradictionPolicy: "FAIL_UNRESOLVED",
        requirePitQualified: true,
        requireReplayEligible: true,
        inquiryBounds: { maxDepth: 1, maxDurationMs: 1_000, maxProviderFanout: 1 },
      },
    ],
    aggregateQualityContract: null,
  });
  const receipt = evaluateInformationSufficiencyV2({
    profile,
    organizationId: profile.organizationId,
    accountId: profile.accountId,
    purpose: profile.purpose,
    symbol: profile.symbol,
    venue: profile.venue,
    analyticalTimeframe: profile.analyticalTimeframe,
    horizon: profile.horizon,
    pitAnchor: PIT,
    activeContextTriggers: [],
    evidence: initialEvidence,
  });
  return {
    derivationVersion: "planner-v1",
    profile,
    receipt,
    policy: defineInformationInquiryPolicyV1({
      policyVersion: "policy-v1",
      purpose: "NEW_OPPORTUNITY_SEARCH",
      timeframePolicies: ["1d", "4h", "1h", "15m", "1m"].map((timeframe) => ({
        timeframe: timeframe as "1d" | "4h" | "1h" | "15m" | "1m",
        relevantRequirementIds: timeframe === "1m" ? ["price-state"] : [],
        maxStalenessMsByRequirement:
          timeframe === "1m" ? [{ requirementId: "price-state", maxStalenessMs: 60_000 }] : [],
      })),
      bounds: {
        maxIterations: 1,
        maxDepth: 1,
        maxDurationMs: 1_000,
        maxProviderFanout: 1,
        maxQueryCount: 1,
        maxHistoricalResults: 1,
        maxAcquisitionCostUnits: 1,
      },
      costPolicy: {
        evaluatorVersion: "caller-cost-v1",
        evaluatorContentDigest: hex("cost-policy"),
        assignments: [{ requirementId: "price-state", providerId: "htx_spot", costUnits: 1 }],
      },
      contradictionMaterialityPolicyVersion: "materiality-v1",
      contradictionMaterialityPolicyDigest: hex("materiality-policy"),
      schedulingPolicyVersion: "scheduler-v1",
      schedulingPolicyDigest: hex("scheduler-policy"),
      maxNewOpportunityWaitTurns: 2,
    }),
    topDownReconstruction: defineTopDownReconstructionV1({
      symbol: profile.symbol,
      pitAnchor: PIT,
      states: [
        ["1d", "STRATEGIC_CONTEXT"],
        ["4h", "STRUCTURAL_REFINEMENT"],
        ["1h", "OPERATIONAL_STATE"],
        ["15m", "SETUP_CONFIRMATION"],
        ["1m", "EXECUTION_PRECISION"],
      ].map(([timeframe, role]) => ({
        timeframe: timeframe as "1d" | "4h" | "1h" | "15m" | "1m",
        role: role as "STRATEGIC_CONTEXT" | "STRUCTURAL_REFINEMENT" | "OPERATIONAL_STATE" | "SETUP_CONFIRMATION" | "EXECUTION_PRECISION",
        status: "AVAILABLE" as const,
        stateContentDigest: hex(`state-${timeframe}`),
        evidenceIds: [`state-${timeframe}`],
        reasonCodes: ["CALLER_STATE"],
      })),
      relations: [["1d", "4h"], ["4h", "1h"], ["1h", "15m"], ["15m", "1m"]].map(
        ([higherTimeframe, lowerTimeframe]) => ({
          higherTimeframe: higherTimeframe as "1d" | "4h" | "1h" | "15m",
          lowerTimeframe: lowerTimeframe as "4h" | "1h" | "15m" | "1m",
          relation: "UNCLEAR" as const,
          relationPolicyVersion: "relation-v1",
          relationPolicyContentDigest: hex("relation-policy"),
          evidenceIds: [`state-${higherTimeframe}`, `state-${lowerTimeframe}`],
          reasonCodes: ["CALLER_RELATION"],
        }),
      ),
      upwardReevaluationRequests: [],
    }),
    iterationIndex: 0,
    queryCountConsumed: 0,
    acquisitionCostUnitsConsumed: 0,
    availableProviderIds: ["htx_spot"],
    contradictions: [],
    analogueRequests: [],
    hypothesisDiscriminators: [],
  };
}

function unavailableReceipt(selection: InformationAcquisitionSelectionV1): InformationAcquisitionReceiptV1 {
  const outcomes = selection.requestedSources.map((requestedSource) => ({
    requestedSource,
    status: "UNAVAILABLE" as const,
    reasonCode: "SOURCE_UNAVAILABLE" as const,
    canonicalPitAttempts: [],
    observationContentDigests: [],
  }));
  const payload = {
    schemaVersion: INFORMATION_ACQUISITION_RECEIPT_V1_SCHEMA_VERSION,
    selectionContentDigest: selection.contentDigest,
    mode: selection.mode,
    outcomes,
    causalObservationContentDigests: [],
    authority: "EVIDENCE_ACQUISITION_ONLY" as const,
  };
  return { ...payload, contentDigest: computeInquiryContentDigest(payload) };
}

describe("DEE-699 information inquiry runtime", () => {
  it("executes planning before one exact selected acquisition and terminates unavailable honestly", async () => {
    const acquire = vi.fn(async (selection: InformationAcquisitionSelectionV1) => ({
      receipt: unavailableReceipt(selection),
      finalEvidence: [],
      attempts: selection.requestedSources.map((source) => ({
        iterationIndex: 0,
        depth: 1,
        needId: source.needId,
        requirementId: source.requirementId,
        providerId: source.providerId,
        outcome: "UNAVAILABLE" as const,
        elapsedMsAtCompletion: 10,
        evidenceIds: [],
        reasonCodes: ["SOURCE_UNAVAILABLE"],
      })),
    }));
    const result = await runInformationInquiryRuntimeV1({
      planningInput: planningInput([]),
      mode: "LIVE",
      acquire,
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(result.selection.requestedSources).toHaveLength(1);
    expect(result.loopReceipt.terminalStatus).toBe("UNAVAILABLE");
    expect(result.informationSufficiencyAuthority.kind).toBe("PROFILE_RECEIPT");
    expect(result.createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority).toBe(false);
  });

  it("performs zero acquisition calls when the exact initial receipt has no unresolved need", async () => {
    const acquire = vi.fn();
    const result = await runInformationInquiryRuntimeV1({
      planningInput: planningInput([evidence()]),
      mode: "HISTORICAL",
      acquire,
    });
    expect(acquire).not.toHaveBeenCalled();
    expect(result.selection.requestedSources).toEqual([]);
    expect(result.acquisitionReceipt).toBeNull();
    expect(result.loopReceipt.terminalStatus).toBe("ANSWERED_SUFFICIENTLY");
  });

  it("composes the standard HTX poll seam mandatory-first and selected-only", async () => {
    const events: string[] = [];
    const mandatoryBundle = {
      snapshot: { bars: [], quote: {}, evaluatedAt: PIT, cycleIndex: 0, cycleId: "cycle-a" },
      fusedContext: { instrumentId: "BTC/USDT", fusedAtUtc: PIT },
      mtfBarsByInterval: {},
      canonicalPitCandidates: [],
      informationAcquisition: null,
    } as unknown as GatewayPollResult;
    const poll = Object.create(HtxBarPollSource.prototype) as HtxBarPollSource;
    poll.fetchMandatoryEvaluationBundle = vi.fn(async () => {
      events.push("mandatory");
      return mandatoryBundle;
    });
    poll.fetchSelectedEvaluationBundle = vi.fn(async ({ selection }) => {
      events.push("selected");
      return { ...mandatoryBundle, informationAcquisition: unavailableReceipt(selection) };
    });
    const resolved = await resolveHtxInformationInquiryCycleV1({
      poll,
      resolver: async () => {
        events.push("resolve");
        return {
          planningInput: planningInput([]),
          refresh: async (selected) => ({
            finalEvidence: [],
            attempts: selected.informationAcquisition!.outcomes.map((outcome) => ({
              iterationIndex: 0,
              depth: 1,
              needId: outcome.requestedSource.needId,
              requirementId: outcome.requestedSource.requirementId,
              providerId: outcome.requestedSource.providerId,
              outcome: outcome.status,
              elapsedMsAtCompletion: 10,
              evidenceIds: [],
              reasonCodes: [outcome.reasonCode!],
            })),
          }),
        };
      },
    });
    expect(events).toEqual(["mandatory", "resolve", "selected"]);
    expect(resolved.bundle.informationAcquisition?.outcomes[0]?.status).toBe("UNAVAILABLE");
    expect(resolved.informationSufficiencyAuthority?.kind).toBe("PROFILE_RECEIPT");
  });
});
