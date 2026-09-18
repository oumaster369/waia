import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { ResearchMemoryV2 } from "@/lib/trader/research-v2/research-memory-v2";
import {
  requireResearchV2NonEmpty,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";

export const RESEARCH_QUESTION_V2_SCHEMA = "waia.trader.research_question.v2" as const;
export const FALSIFIABLE_HYPOTHESIS_V2_SCHEMA = "waia.trader.falsifiable_hypothesis.v2" as const;

export type ResearchQuestionV2 = Readonly<{
  schemaVersion: typeof RESEARCH_QUESTION_V2_SCHEMA;
  capitalAuthority: "NONE";
  questionId: string;
  organizationId: string;
  campaignId: string;
  symbol: string;
  questionText: string;
  memoryDigestHex: string;
  status: "OPEN";
  contentDigestHex: string;
}>;

export type FalsifiableHypothesisV2 = Readonly<{
  schemaVersion: typeof FALSIFIABLE_HYPOTHESIS_V2_SCHEMA;
  capitalAuthority: "NONE";
  hypothesisId: string;
  questionDigestHex: string;
  claimText: string;
  falsificationConditions: readonly string[];
  intendedSymbol: string;
  contentDigestHex: string;
}>;

export function buildResearchQuestionV2(input: {
  questionId: string;
  memory: ResearchMemoryV2;
  symbol: string;
}): ResearchQuestionV2 {
  requireResearchV2NonEmpty(input.questionId, "RESEARCH_QUESTION_INVALID");
  requireResearchV2NonEmpty(input.symbol, "RESEARCH_QUESTION_INVALID");
  const questionText =
    `Under which locked causal contexts is ${input.symbol} candidate behavior reproducible, ` +
    `given research memory ${input.memory.contentDigestHex} that retains both supporting ` +
    `(${input.memory.supportingCount}) and contradicting (${input.memory.contradictingCount}) outcomes?`;
  const body = {
    schemaVersion: RESEARCH_QUESTION_V2_SCHEMA,
    capitalAuthority: "NONE" as const,
    questionId: input.questionId,
    organizationId: input.memory.organizationId,
    campaignId: input.memory.campaignId,
    symbol: input.symbol,
    questionText,
    memoryDigestHex: input.memory.contentDigestHex,
    status: "OPEN" as const,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

export function buildFalsifiableHypothesisV2(input: {
  hypothesisId: string;
  question: ResearchQuestionV2;
  generationKind: "PARAMETER_MUTATION" | "MULTI_PARENT_COMBINATION";
}): FalsifiableHypothesisV2 {
  requireResearchV2NonEmpty(input.hypothesisId, "HYPOTHESIS_NOT_FALSIFIABLE");
  const claimText =
    `A typed ${input.generationKind} candidate can be evaluated on locked DEVELOPMENT and ` +
    `walk-forward partitions without discarding contradicting outcomes from research memory.`;
  const falsificationConditions = Object.freeze([
    "Walk-forward evaluation does not improve on the incumbent comparison digest.",
    "Contradicting outcomes in research memory remain unexplained by the candidate lineage.",
    "The candidate uses a banned discovery-fitness field as a ranking signal.",
  ]);
  if (falsificationConditions.length < 1) {
    throw new StrategyEvolutionResearchError("HYPOTHESIS_NOT_FALSIFIABLE");
  }
  const body = {
    schemaVersion: FALSIFIABLE_HYPOTHESIS_V2_SCHEMA,
    capitalAuthority: "NONE" as const,
    hypothesisId: input.hypothesisId,
    questionDigestHex: input.question.contentDigestHex,
    claimText,
    falsificationConditions,
    intendedSymbol: input.question.symbol,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
