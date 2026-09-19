import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HumanPromotionProposalV2 } from "@/lib/trader/research-v2/human-promotion-proposal-v2";
import {
  requireResearchV2DigestHex,
  requireResearchV2NonEmpty,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";
import { assignStrategyCandidateToAccountV2 } from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
import type { StrategyEvolutionCandidateV2 } from "@/lib/trader/research-v2/strategy-candidate-generation-v2";

export const HUMAN_RESEARCH_ASSIGNMENT_V2_SCHEMA =
  "waia.trader.human_research_assignment.v2" as const;

export const HUMAN_RESEARCH_ASSIGNMENT_LIFECYCLES_V2 = ["RESEARCH", "PAPER"] as const;
export type HumanResearchAssignmentLifecycleV2 =
  (typeof HUMAN_RESEARCH_ASSIGNMENT_LIFECYCLES_V2)[number];

export type ResearchAccountRefV2 = Readonly<{
  organizationId: string;
  accountId: string;
}>;

export type HumanResearchAssignmentV2 = Readonly<{
  schemaVersion: typeof HUMAN_RESEARCH_ASSIGNMENT_V2_SCHEMA;
  capitalAuthority: "NONE";
  liveAuthority: "NONE";
  venueWriteAuthority: "NONE";
  assignmentAuthority: "HUMAN_ONLY";
  lifecycle: HumanResearchAssignmentLifecycleV2;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  candidateDigestHex: string;
  proposalDigestHex: string;
  accountIds: readonly string[];
  humanActorId: string;
  operatorAttestationDigestHex: string;
  contentDigestHex: string;
}>;

export type AdmitHumanResearchCandidateAssignmentV2Input = Readonly<{
  organizationId: string;
  proposal: HumanPromotionProposalV2;
  candidate: StrategyEvolutionCandidateV2;
  humanActorId: string;
  operatorAttestationDigestHex: string;
  lifecycle: HumanResearchAssignmentLifecycleV2 | "LIVE";
  accounts: readonly ResearchAccountRefV2[];
  candidateSelfAssignAttempted?: boolean;
}>;

export function admitHumanResearchCandidateAssignmentV2(
  input: AdmitHumanResearchCandidateAssignmentV2Input,
): HumanResearchAssignmentV2 {
  if (input.candidateSelfAssignAttempted) {
    assignStrategyCandidateToAccountV2(input.candidate, input.accounts[0]?.accountId ?? "");
  }
  if (
    input.proposal.approvalAuthority !== "HUMAN_ONLY" ||
    input.proposal.disposition !== "pending"
  ) {
    throw new StrategyEvolutionResearchError("HUMAN_ASSIGNMENT_REQUIRES_PENDING_PROPOSAL");
  }
  if (input.proposal.candidateDigestHex !== input.candidate.contentDigestHex) {
    throw new StrategyEvolutionResearchError("HUMAN_ASSIGNMENT_PROPOSAL_CANDIDATE_MISMATCH");
  }
  if (input.lifecycle === "LIVE") {
    throw new StrategyEvolutionResearchError(
      "LIVE_ASSIGNMENT_FORBIDDEN",
      "Human research assignment cannot grant LIVE authority",
    );
  }
  requireResearchV2NonEmpty(input.organizationId, "HUMAN_ASSIGNMENT_SCOPE_INVALID");
  requireResearchV2NonEmpty(input.humanActorId, "HUMAN_ASSIGNMENT_ACTOR_INVALID");
  requireResearchV2DigestHex(
    input.operatorAttestationDigestHex,
    "HUMAN_ASSIGNMENT_ATTESTATION_INVALID",
  );
  if (input.accounts.length === 0) {
    throw new StrategyEvolutionResearchError("HUMAN_ASSIGNMENT_ACCOUNTS_REQUIRED");
  }

  const accountIds: string[] = [];
  const seen = new Set<string>();
  for (const account of input.accounts) {
    requireResearchV2NonEmpty(account.accountId, "HUMAN_ASSIGNMENT_ACCOUNT_INVALID");
    if (account.organizationId !== input.organizationId) {
      throw new StrategyEvolutionResearchError(
        "HUMAN_ASSIGNMENT_TENANT_ISOLATION",
        "Accounts from another organization cannot be assigned",
      );
    }
    if (seen.has(account.accountId)) {
      continue;
    }
    seen.add(account.accountId);
    accountIds.push(account.accountId);
  }

  const body = {
    schemaVersion: HUMAN_RESEARCH_ASSIGNMENT_V2_SCHEMA,
    capitalAuthority: "NONE" as const,
    liveAuthority: "NONE" as const,
    venueWriteAuthority: "NONE" as const,
    assignmentAuthority: "HUMAN_ONLY" as const,
    lifecycle: input.lifecycle,
    organizationId: input.organizationId,
    strategyId: input.candidate.strategyId,
    strategyVersion: input.candidate.strategyVersion,
    candidateDigestHex: input.candidate.contentDigestHex,
    proposalDigestHex: input.proposal.contentDigestHex,
    accountIds: Object.freeze(accountIds),
    humanActorId: input.humanActorId,
    operatorAttestationDigestHex: input.operatorAttestationDigestHex,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

export function mergeHumanResearchAssignmentsV2(
  first: HumanResearchAssignmentV2,
  second: HumanResearchAssignmentV2,
): readonly HumanResearchAssignmentV2[] {
  if (first.organizationId !== second.organizationId) {
    throw new StrategyEvolutionResearchError("HUMAN_ASSIGNMENT_TENANT_ISOLATION");
  }
  return Object.freeze([first, second]);
}
