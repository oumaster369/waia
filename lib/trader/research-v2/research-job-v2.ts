import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { queryBlindHoldoutAsIterativeFitnessV2 } from "@/lib/trader/research-v2/qualification-records-v2";
import {
  requireResearchV2DigestHex,
  requireResearchV2NonEmpty,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";

export const RESEARCH_JOB_V2_SCHEMA = "waia.trader.research_job.v2" as const;

export const RESEARCH_JOB_CLASS_V2 = "RESEARCH_BACKGROUND" as const;

export const CAPITAL_RUNTIME_CLASSES_V2 = [
  "OPEN_POSITION",
  "RISK",
  "GUARDIAN",
  "EXECUTION",
  "RECONCILIATION",
] as const;

export type CapitalRuntimeClassV2 = (typeof CAPITAL_RUNTIME_CLASSES_V2)[number];

export const RESEARCH_JOB_STATUSES_V2 = ["QUEUED", "YIELDED", "COMPLETED", "FAIL_CLOSED"] as const;
export type ResearchJobStatusV2 = (typeof RESEARCH_JOB_STATUSES_V2)[number];

export type ResearchJobV2 = Readonly<{
  schemaVersion: typeof RESEARCH_JOB_V2_SCHEMA;
  capitalAuthority: "NONE";
  venueWriteAuthority: "NONE";
  assignmentMutationAuthority: "NONE";
  riskPolicyMutationAuthority: "NONE";
  jobClass: typeof RESEARCH_JOB_CLASS_V2;
  preemptionPriority: 0;
  jobId: string;
  organizationId: string;
  campaignId: string;
  budgetMs: number;
  status: ResearchJobStatusV2;
  yieldReason: "CAPITAL_RUNTIME_ACTIVE" | null;
  contentDigestHex: string;
}>;

export type EnqueueResearchJobV2Input = Readonly<{
  jobId: string;
  organizationId: string;
  campaignId: string;
  budgetMs: number;
  claimedRuntimeClass?: string;
  capitalRuntimeActive?: boolean;
  holdoutQueryAttempted?: boolean;
  mutateAssignmentAttempted?: boolean;
  mutateRiskPolicyAttempted?: boolean;
}>;

function isCapitalRuntimeClass(value: string): value is CapitalRuntimeClassV2 {
  return (CAPITAL_RUNTIME_CLASSES_V2 as readonly string[]).includes(value);
}

export function assertResearchJobCannotClaimCapitalRuntimeV2(claimedRuntimeClass: string): void {
  if (isCapitalRuntimeClass(claimedRuntimeClass)) {
    throw new StrategyEvolutionResearchError(
      "RESEARCH_CANNOT_CLAIM_CAPITAL_RUNTIME",
      "Research jobs cannot claim open-position, Risk, Guardian, Execution, or reconciliation class",
    );
  }
}

export function enqueueResearchJobV2(input: EnqueueResearchJobV2Input): ResearchJobV2 {
  if (input.holdoutQueryAttempted) {
    queryBlindHoldoutAsIterativeFitnessV2();
  }
  if (input.mutateAssignmentAttempted) {
    throw new StrategyEvolutionResearchError(
      "RESEARCH_CANNOT_MUTATE_ASSIGNMENT",
      "Research jobs cannot mutate strategy assignment",
    );
  }
  if (input.mutateRiskPolicyAttempted) {
    throw new StrategyEvolutionResearchError(
      "RESEARCH_CANNOT_MUTATE_RISK_POLICY",
      "Research jobs cannot mutate Risk policy",
    );
  }
  if (input.claimedRuntimeClass !== undefined) {
    assertResearchJobCannotClaimCapitalRuntimeV2(input.claimedRuntimeClass);
    if (input.claimedRuntimeClass !== RESEARCH_JOB_CLASS_V2) {
      throw new StrategyEvolutionResearchError("RESEARCH_CANNOT_CLAIM_CAPITAL_RUNTIME");
    }
  }
  requireResearchV2NonEmpty(input.jobId, "RESEARCH_JOB_IDENTITY_INVALID");
  requireResearchV2NonEmpty(input.organizationId, "RESEARCH_JOB_SCOPE_INVALID");
  requireResearchV2NonEmpty(input.campaignId, "RESEARCH_JOB_SCOPE_INVALID");
  if (!Number.isSafeInteger(input.budgetMs) || input.budgetMs < 1) {
    throw new StrategyEvolutionResearchError("RESEARCH_JOB_BUDGET_INVALID");
  }

  const yielded = input.capitalRuntimeActive === true;
  const body = {
    schemaVersion: RESEARCH_JOB_V2_SCHEMA,
    capitalAuthority: "NONE" as const,
    venueWriteAuthority: "NONE" as const,
    assignmentMutationAuthority: "NONE" as const,
    riskPolicyMutationAuthority: "NONE" as const,
    jobClass: RESEARCH_JOB_CLASS_V2,
    preemptionPriority: 0 as const,
    jobId: input.jobId,
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    budgetMs: input.budgetMs,
    status: (yielded ? "YIELDED" : "QUEUED") as ResearchJobStatusV2,
    yieldReason: yielded ? ("CAPITAL_RUNTIME_ACTIVE" as const) : null,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

export function completeResearchJobV2(job: ResearchJobV2): ResearchJobV2 {
  requireResearchV2DigestHex(job.contentDigestHex, "RESEARCH_JOB_IDENTITY_INVALID");
  if (job.status === "YIELDED") {
    throw new StrategyEvolutionResearchError(
      "RESEARCH_JOB_YIELDED_TO_CAPITAL_RUNTIME",
      "Yielded research jobs cannot complete while capital runtime is active",
    );
  }
  if (job.status !== "QUEUED") {
    throw new StrategyEvolutionResearchError("RESEARCH_JOB_NOT_COMPLETABLE");
  }
  const { contentDigestHex: _priorDigest, ...rest } = job;
  void _priorDigest;
  const body = {
    ...rest,
    status: "COMPLETED" as const,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
