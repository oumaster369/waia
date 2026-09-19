import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";
import type { FalsifiableHypothesisV2 } from "@/lib/trader/research-v2/research-question-hypothesis-v2";
import {
  assertResearchDiscoveryFitnessV2,
  requireResearchV2DigestHex,
  requireResearchV2IsoUtc,
  requireResearchV2NonEmpty,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";

export const STRATEGY_EVOLUTION_CANDIDATE_V2_SCHEMA =
  "waia.trader.strategy_evolution_candidate.v2" as const;

export const STRATEGY_EVOLUTION_GENERATOR_VERSION_V2 = "strategy-evolution-research/v2" as const;

export const FORBIDDEN_RESEARCH_TEMPLATE_STRATEGY_ID_V2 = "mean_reversion_v0" as const;

export const STRATEGY_CANDIDATE_GENERATION_KINDS_V2 = [
  "PARAMETER_MUTATION",
  "MULTI_PARENT_COMBINATION",
] as const;

export type StrategyCandidateGenerationKindV2 =
  (typeof STRATEGY_CANDIDATE_GENERATION_KINDS_V2)[number];

export type StrategyParentRefV2 = Readonly<{
  strategyId: string;
  strategyVersion: string;
  params: Readonly<Record<string, string>>;
  artifactDigestHex: string;
}>;

export type StrategyCandidateLineageV2 = Readonly<{
  generationKind: StrategyCandidateGenerationKindV2;
  parents: readonly Omit<StrategyParentRefV2, "params">[];
  hypothesisDigestHex: string;
  evidenceCutoffUtc: string;
  researchCodeIdentity: string;
  costModelIdentity: string;
  generatorVersion: typeof STRATEGY_EVOLUTION_GENERATOR_VERSION_V2;
}>;

export type StrategyEvolutionCandidateV2 = Readonly<{
  schemaVersion: typeof STRATEGY_EVOLUTION_CANDIDATE_V2_SCHEMA;
  capitalAuthority: "RESEARCH_ONLY";
  promotionAuthority: "NONE";
  accountAssignmentAuthority: "NONE";
  venueWriteAuthority: "NONE";
  candidateId: string;
  strategyId: string;
  strategyVersion: string;
  params: Readonly<Record<string, string>>;
  lineage: StrategyCandidateLineageV2;
  assignedAccountIds: readonly [];
  contentDigestHex: string;
}>;

export type GenerateStrategyEvolutionCandidateV2Input = Readonly<{
  candidateId: string;
  strategyId: string;
  strategyVersion: string;
  kind: StrategyCandidateGenerationKindV2;
  parents: readonly StrategyParentRefV2[];
  params: Readonly<Record<string, string>>;
  hypothesis: FalsifiableHypothesisV2;
  evidenceCutoffUtc: string;
  researchCodeIdentity: string;
  costModelIdentity: string;
  assignedAccountId?: string;
}>;

export function assertResearchStrategyIdentityAllowedV2(strategyId: string): void {
  requireResearchV2NonEmpty(strategyId, "CANDIDATE_LINEAGE_INVALID");
  if (strategyId === FORBIDDEN_RESEARCH_TEMPLATE_STRATEGY_ID_V2) {
    throw new StrategyEvolutionResearchError(
      "FORBIDDEN_TEMPLATE_STRATEGY_IDENTITY",
      "Default template identity is not a research candidate",
    );
  }
}

export function promoteStrategyCandidateV2(_candidate: StrategyEvolutionCandidateV2): never {
  void _candidate;
  throw new StrategyEvolutionResearchError(
    "CANDIDATE_SELF_PROMOTION_FORBIDDEN",
    "Candidates cannot self-promote",
  );
}

export function assignStrategyCandidateToAccountV2(
  _candidate: StrategyEvolutionCandidateV2,
  _accountId: string,
): never {
  void _candidate;
  void _accountId;
  throw new StrategyEvolutionResearchError(
    "CANDIDATE_ACCOUNT_ASSIGNMENT_FORBIDDEN",
    "Candidates cannot assign themselves to an account",
  );
}

export function generateStrategyEvolutionCandidateV2(
  input: GenerateStrategyEvolutionCandidateV2Input,
): StrategyEvolutionCandidateV2 {
  assertResearchDiscoveryFitnessV2(input.params, "candidate params");
  assertNoBannedFields(input.parents, "candidate parents");
  if (input.assignedAccountId !== undefined) {
    throw new StrategyEvolutionResearchError(
      "CANDIDATE_ACCOUNT_ASSIGNMENT_FORBIDDEN",
      "Candidates cannot assign themselves to an account",
    );
  }
  requireResearchV2NonEmpty(input.candidateId, "CANDIDATE_LINEAGE_INVALID");
  requireResearchV2NonEmpty(input.strategyId, "CANDIDATE_LINEAGE_INVALID");
  assertResearchStrategyIdentityAllowedV2(input.strategyId);
  requireResearchV2NonEmpty(input.strategyVersion, "CANDIDATE_LINEAGE_INVALID");
  requireResearchV2IsoUtc(input.evidenceCutoffUtc, "CANDIDATE_LINEAGE_INVALID");
  requireResearchV2NonEmpty(input.researchCodeIdentity, "CANDIDATE_LINEAGE_INVALID");
  requireResearchV2NonEmpty(input.costModelIdentity, "CANDIDATE_LINEAGE_INVALID");

  if (input.kind === "PARAMETER_MUTATION" && input.parents.length !== 1) {
    throw new StrategyEvolutionResearchError("CANDIDATE_LINEAGE_INVALID");
  }
  if (input.kind === "MULTI_PARENT_COMBINATION" && input.parents.length < 2) {
    throw new StrategyEvolutionResearchError("CANDIDATE_LINEAGE_INVALID");
  }

  const parents = input.parents.map((parent) => {
    requireResearchV2NonEmpty(parent.strategyId, "CANDIDATE_LINEAGE_INVALID");
    assertResearchStrategyIdentityAllowedV2(parent.strategyId);
    requireResearchV2NonEmpty(parent.strategyVersion, "CANDIDATE_LINEAGE_INVALID");
    requireResearchV2DigestHex(parent.artifactDigestHex, "CANDIDATE_LINEAGE_INVALID");
    assertResearchDiscoveryFitnessV2(parent.params, "parent params");
    return Object.freeze({
      strategyId: parent.strategyId,
      strategyVersion: parent.strategyVersion,
      artifactDigestHex: parent.artifactDigestHex,
    });
  });

  const lineage: StrategyCandidateLineageV2 = Object.freeze({
    generationKind: input.kind,
    parents: Object.freeze(parents),
    hypothesisDigestHex: input.hypothesis.contentDigestHex,
    evidenceCutoffUtc: input.evidenceCutoffUtc,
    researchCodeIdentity: input.researchCodeIdentity,
    costModelIdentity: input.costModelIdentity,
    generatorVersion: STRATEGY_EVOLUTION_GENERATOR_VERSION_V2,
  });

  const body = {
    schemaVersion: STRATEGY_EVOLUTION_CANDIDATE_V2_SCHEMA,
    capitalAuthority: "RESEARCH_ONLY" as const,
    promotionAuthority: "NONE" as const,
    accountAssignmentAuthority: "NONE" as const,
    venueWriteAuthority: "NONE" as const,
    candidateId: input.candidateId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    params: Object.freeze({ ...input.params }),
    lineage,
    assignedAccountIds: Object.freeze([]) as readonly [],
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
