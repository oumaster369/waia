import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeInquiryContentDigest,
  defineInformationInquiryPolicyV1,
  INFORMATION_NEED_PLAN_V1_SCHEMA_VERSION,
  mapInformationInquiryPurposeV1,
  type InformationInquiryPurposeV1,
  type InformationNeedPlanV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import {
  INFORMATION_INQUIRY_PLANNING_BUNDLE_V1_SCHEMA_VERSION,
  type InformationInquiryPlanningBundleV1,
} from "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1";
import { scheduleInformationInquiryV1 } from "@/lib/trader/intelligence/information-inquiry/inquiry-scheduler-v1";

const hex = (value: string) => createHash("sha256").update(value).digest("hex");

function policy() {
  return defineInformationInquiryPolicyV1({
    policyVersion: "policy-v1",
    purpose: "NEW_OPPORTUNITY_SEARCH",
    timeframePolicies: ["1d", "4h", "1h", "15m", "1m"].map((timeframe) => ({
      timeframe: timeframe as "1d" | "4h" | "1h" | "15m" | "1m",
      relevantRequirementIds: [],
      maxStalenessMsByRequirement: [],
    })),
    bounds: {
      maxIterations: 3,
      maxDepth: 2,
      maxDurationMs: 5_000,
      maxProviderFanout: 2,
      maxQueryCount: 3,
      maxHistoricalResults: 4,
      maxAcquisitionCostUnits: 3,
    },
    costPolicy: {
      evaluatorVersion: "caller-cost-v1",
      evaluatorContentDigest: hex("cost"),
      assignments: [],
    },
    contradictionMaterialityPolicyVersion: "materiality-v1",
    contradictionMaterialityPolicyDigest: hex("materiality"),
    schedulingPolicyVersion: "scheduler-v1",
    schedulingPolicyDigest: hex("scheduler"),
    maxNewOpportunityWaitTurns: 2,
  });
}

function planningBundle(purpose: InformationInquiryPurposeV1): InformationInquiryPlanningBundleV1 {
  const unresolvedQuestionIds: [] = [];
  const availableEvidence: [] = [];
  const needs: [] = [];
  const requestedSources: [] = [];
  const planPayload: Omit<InformationNeedPlanV1, "id" | "contentDigest"> = {
    schemaVersion: INFORMATION_NEED_PLAN_V1_SCHEMA_VERSION,
    derivationVersion: "planner-v1",
    organizationId: "org-a",
    accountId: null,
    symbol: "BTC/USDT",
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: "15m",
    pitAnchor: "2026-08-24T12:00:00.000Z",
    purpose,
    profilePurpose: mapInformationInquiryPurposeV1(purpose),
    profileId: hex(`profile-${purpose}`),
    profileContentDigest: hex(`profile-${purpose}`),
    policyVersion: "policy-v1",
    policyContentDigest: hex(`policy-${purpose}`),
    topDownReconstructionContentDigest: hex(`reconstruction-${purpose}`),
    unresolvedQuestionIds,
    availableEvidence,
    needs,
    requestedSources,
    ignoredSources: [],
    bounds: {
      maxIterations: 3,
      maxDepth: 2,
      maxDurationMs: 5_000,
      maxProviderFanout: 2,
      maxQueryCount: 3,
      maxHistoricalResults: 4,
      maxAcquisitionCostUnits: 3,
    },
    iterationIndex: 0,
    queryCountConsumedBeforeIteration: 0,
    acquisitionCostUnitsConsumedBeforeIteration: 0,
    status: "NO_ADDITIONAL_EVIDENCE_NEEDED",
    evidenceSelectionDigest: computeInquiryContentDigest({
      unresolvedQuestionIds,
      availableEvidence,
      needs,
      requestedSources,
    }),
    authority: "EVIDENCE_ACQUISITION_ONLY",
  };
  const planContentDigest = computeInquiryContentDigest(planPayload);
  const plan = {
    ...planPayload,
    id: `inp_${planContentDigest}`,
    contentDigest: planContentDigest,
  };
  const payload = {
    schemaVersion: INFORMATION_INQUIRY_PLANNING_BUNDLE_V1_SCHEMA_VERSION,
    plan,
    contradictions: [],
    analoguePlanning: [],
    hypothesisDiscriminators: [],
    researchQuestionRoutes: [],
    authority: "EVIDENCE_ACQUISITION_PLANNING_ONLY" as const,
    createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority: false as const,
  };
  return { ...payload, contentDigest: computeInquiryContentDigest(payload) };
}

const openBundle = planningBundle("OPEN_POSITION_REASSESSMENT");
const opportunityBundle = planningBundle("NEW_OPPORTUNITY_SEARCH");
const open = { queueSequence: 2, bundle: openBundle };
const opportunity = { queueSequence: 1, bundle: opportunityBundle };

describe("DEE-697 inquiry scheduler", () => {
  it("prioritizes open-position reassessment first under contention", () => {
    const decision = scheduleInformationInquiryV1({
      policy: policy(),
      state: { newOpportunityWaitTurns: 0 },
      queue: [opportunity, open],
    });
    expect(decision.selected).toMatchObject({
      queueSequence: 2,
      planId: openBundle.plan.id,
      purpose: "OPEN_POSITION_REASSESSMENT",
    });
    expect(decision.reasonCode).toBe("OPEN_POSITION_FIRST");
    expect(decision.nextState.newOpportunityWaitTurns).toBe(1);
    expect(decision.createsPositionDecisionOrCapitalAuthority).toBe(false);
  });

  it("forces deterministic new-opportunity progress at the caller bound", () => {
    const decision = scheduleInformationInquiryV1({
      policy: policy(),
      state: { newOpportunityWaitTurns: 2 },
      queue: [open, opportunity],
    });
    expect(decision.selected).toMatchObject({
      queueSequence: 1,
      planId: opportunityBundle.plan.id,
      purpose: "NEW_OPPORTUNITY_SEARCH",
    });
    expect(decision.reasonCode).toBe("NEW_OPPORTUNITY_FAIRNESS_BOUND_REACHED");
    expect(decision.nextState.newOpportunityWaitTurns).toBe(0);
  });

  it("is order-independent and rejects impossible wait state", () => {
    const left = scheduleInformationInquiryV1({
      policy: policy(),
      state: { newOpportunityWaitTurns: 1 },
      queue: [open, opportunity],
    });
    const right = scheduleInformationInquiryV1({
      policy: policy(),
      state: { newOpportunityWaitTurns: 1 },
      queue: [opportunity, open],
    });
    expect(left).toEqual(right);
    expect(() =>
      scheduleInformationInquiryV1({
        policy: policy(),
        state: { newOpportunityWaitTurns: 3 },
        queue: [open, opportunity],
      }),
    ).toThrow("waitStateBeyondBound");
  });
});
