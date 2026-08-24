import {
  assertInformationInquiryPolicyV1,
  computeInquiryContentDigest,
  deepFreezeInquiry,
  inquiryCanonicalTextCompare,
  requireInquiryDigest,
  requireInquiryNonEmpty,
  type InformationInquiryPolicyV1,
  type InformationInquiryPurposeV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import {
  assertInformationInquiryPlanningBundleV1,
  type InformationInquiryPlanningBundleV1,
} from "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1";

export const INFORMATION_INQUIRY_SCHEDULER_DECISION_V1_SCHEMA_VERSION =
  "information_inquiry_scheduler_decision/v1" as const;

export type InformationInquiryScheduleItemV1 = Readonly<{
  queueSequence: number;
  planId: string;
  planContentDigest: string;
  purpose: InformationInquiryPurposeV1;
}>;

export type InformationInquiryScheduleCandidateV1 = Readonly<{
  queueSequence: number;
  bundle: InformationInquiryPlanningBundleV1;
}>;

export type InformationInquirySchedulerStateV1 = Readonly<{
  newOpportunityWaitTurns: number;
}>;

export type InformationInquirySchedulerDecisionV1 = Readonly<{
  schemaVersion: typeof INFORMATION_INQUIRY_SCHEDULER_DECISION_V1_SCHEMA_VERSION;
  selected: InformationInquiryScheduleItemV1 | null;
  nextState: InformationInquirySchedulerStateV1;
  reasonCode:
    | "OPEN_POSITION_FIRST"
    | "NEW_OPPORTUNITY_FAIRNESS_BOUND_REACHED"
    | "NEW_OPPORTUNITY_ONLY"
    | "RESEARCH_ONLY"
    | "QUEUE_EMPTY";
  schedulingPolicyVersion: string;
  schedulingPolicyDigest: string;
  authority: "INQUIRY_ORDERING_ONLY";
  createsPositionDecisionOrCapitalAuthority: false;
  contentDigest: string;
}>;

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`INFORMATION_INQUIRY_SCHEDULER_INVALID:${field}`);
  }
  return value;
}

function canonicalQueue(
  values: readonly InformationInquiryScheduleCandidateV1[],
): readonly InformationInquiryScheduleItemV1[] {
  const queue = values
    .map((item) => {
      requireNonNegativeInteger(item.queueSequence, "queueSequence");
      const bundle = assertInformationInquiryPlanningBundleV1(item.bundle);
      requireInquiryNonEmpty(bundle.plan.id, "planId");
      requireInquiryDigest(bundle.plan.contentDigest, "planContentDigest");
      return {
        queueSequence: item.queueSequence,
        planId: bundle.plan.id,
        planContentDigest: bundle.plan.contentDigest,
        purpose: bundle.plan.purpose,
      };
    })
    .sort(
      (left, right) =>
        left.queueSequence - right.queueSequence ||
        inquiryCanonicalTextCompare(left.planId, right.planId),
    );
  if (
    new Set(queue.map((item) => item.planId)).size !== queue.length ||
    new Set(queue.map((item) => item.queueSequence)).size !== queue.length
  ) {
    throw new Error("INFORMATION_INQUIRY_SCHEDULER_INVALID:duplicateQueueIdentity");
  }
  return deepFreezeInquiry(queue);
}

export function scheduleInformationInquiryV1(
  input: Readonly<{
    policy: InformationInquiryPolicyV1;
    state: InformationInquirySchedulerStateV1;
    queue: readonly InformationInquiryScheduleCandidateV1[];
  }>,
): InformationInquirySchedulerDecisionV1 {
  const policy = assertInformationInquiryPolicyV1(input.policy);
  requireNonNegativeInteger(input.state.newOpportunityWaitTurns, "newOpportunityWaitTurns");
  if (input.state.newOpportunityWaitTurns > policy.maxNewOpportunityWaitTurns) {
    throw new Error("INFORMATION_INQUIRY_SCHEDULER_INVALID:waitStateBeyondBound");
  }
  const queue = canonicalQueue(input.queue);
  const open = queue.find((item) => item.purpose === "OPEN_POSITION_REASSESSMENT");
  const opportunity = queue.find((item) => item.purpose === "NEW_OPPORTUNITY_SEARCH");
  const research = queue.find((item) => item.purpose === "RESEARCH");
  let selected: InformationInquiryScheduleItemV1 | null;
  let reasonCode: InformationInquirySchedulerDecisionV1["reasonCode"];
  let nextWaitTurns: number;
  if (
    open &&
    opportunity &&
    input.state.newOpportunityWaitTurns >= policy.maxNewOpportunityWaitTurns
  ) {
    selected = opportunity;
    reasonCode = "NEW_OPPORTUNITY_FAIRNESS_BOUND_REACHED";
    nextWaitTurns = 0;
  } else if (open) {
    selected = open;
    reasonCode = "OPEN_POSITION_FIRST";
    nextWaitTurns = opportunity ? input.state.newOpportunityWaitTurns + 1 : 0;
  } else if (opportunity) {
    selected = opportunity;
    reasonCode = "NEW_OPPORTUNITY_ONLY";
    nextWaitTurns = 0;
  } else if (research) {
    selected = research;
    reasonCode = "RESEARCH_ONLY";
    nextWaitTurns = 0;
  } else {
    selected = null;
    reasonCode = "QUEUE_EMPTY";
    nextWaitTurns = 0;
  }
  const body = {
    schemaVersion: INFORMATION_INQUIRY_SCHEDULER_DECISION_V1_SCHEMA_VERSION,
    selected,
    nextState: { newOpportunityWaitTurns: nextWaitTurns },
    reasonCode,
    schedulingPolicyVersion: policy.schedulingPolicyVersion,
    schedulingPolicyDigest: policy.schedulingPolicyDigest,
    authority: "INQUIRY_ORDERING_ONLY" as const,
    createsPositionDecisionOrCapitalAuthority: false as const,
  };
  return deepFreezeInquiry({ ...body, contentDigest: computeInquiryContentDigest(body) });
}
