import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertResearchDiscoveryFitnessV2,
  assertResearchV2ContentDigest,
  requireResearchV2Decimal,
  requireResearchV2DigestHex,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";
import type { StrategyEvolutionCandidateV2 } from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
import { STRATEGY_EVOLUTION_CANDIDATE_V2_SCHEMA } from "@/lib/trader/research-v2/strategy-candidate-generation-v2";

export const QUALIFICATION_RECORD_V2_SCHEMA =
  "waia.trader.strategy_evolution_qualification.v2" as const;

export const QUALIFICATION_PARTITIONS_V2 = ["DEVELOPMENT", "WALK_FORWARD"] as const;
export type QualificationPartitionV2 = (typeof QUALIFICATION_PARTITIONS_V2)[number];

export const QUALIFICATION_VERDICTS_V2 = ["QUALIFIED", "REJECTED"] as const;
export type QualificationVerdictV2 = (typeof QUALIFICATION_VERDICTS_V2)[number];

export type QualificationEvaluationV2 = Readonly<{
  netEconomicResult: string;
  maxDrawdown: string;
  tailEventCount: number;
  sampleSize: number;
  incumbentComparisonDigestHex: string;
}>;

export type QualificationRecordV2 = Readonly<{
  schemaVersion: typeof QUALIFICATION_RECORD_V2_SCHEMA;
  capitalAuthority: "RESEARCH_ONLY";
  candidateDigestHex: string;
  partition: QualificationPartitionV2;
  fittingAllowed: boolean;
  evaluation: QualificationEvaluationV2;
  verdict: QualificationVerdictV2;
  failureReasons: readonly string[];
  contentDigestHex: string;
}>;

export type RejectedCandidateRecordV2 = Readonly<{
  schemaVersion: "waia.trader.strategy_evolution_rejected_candidate.v2";
  capitalAuthority: "RESEARCH_ONLY";
  status: "REJECTED";
  candidateDigestHex: string;
  developmentDigestHex: string;
  walkForwardDigestHex: string;
  recorded: true;
  contentDigestHex: string;
}>;

export function queryBlindHoldoutAsIterativeFitnessV2(): never {
  throw new StrategyEvolutionResearchError(
    "BLIND_HOLDOUT_ITERATIVE_FITNESS_FORBIDDEN",
    "Blind holdout cannot be queried as iterative fitness",
  );
}

export function assertQualificationPartitionsIndependentV2(
  development: QualificationEvaluationV2,
  walkForward: QualificationEvaluationV2,
): void {
  const developmentDigest = computeSemanticSha256Hex(development);
  const walkForwardDigest = computeSemanticSha256Hex(walkForward);
  if (developmentDigest === walkForwardDigest) {
    throw new StrategyEvolutionResearchError(
      "QUALIFICATION_PARTITIONS_NOT_INDEPENDENT",
      "DEVELOPMENT and walk-forward evaluations must not be identical",
    );
  }
}

export function recordQualificationV2(input: {
  candidate: StrategyEvolutionCandidateV2;
  partition: QualificationPartitionV2 | "BLIND_HOLDOUT";
  evaluation: QualificationEvaluationV2;
  verdict: QualificationVerdictV2;
  failureReasons?: readonly string[];
}): QualificationRecordV2 {
  assertResearchDiscoveryFitnessV2(input.evaluation, "qualification evaluation");
  if (input.partition === "BLIND_HOLDOUT") {
    queryBlindHoldoutAsIterativeFitnessV2();
  }
  if (!QUALIFICATION_PARTITIONS_V2.includes(input.partition)) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_PARTITION_INVALID");
  }
  if (!QUALIFICATION_VERDICTS_V2.includes(input.verdict)) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_VERDICT_INVALID");
  }
  assertQualificationCandidateV2(input.candidate);
  const partition: QualificationPartitionV2 = input.partition;
  requireResearchV2Decimal(input.evaluation.netEconomicResult, "QUALIFICATION_EVALUATION_INVALID");
  requireResearchV2Decimal(input.evaluation.maxDrawdown, "QUALIFICATION_EVALUATION_INVALID");
  requireResearchV2DigestHex(
    input.evaluation.incumbentComparisonDigestHex,
    "QUALIFICATION_EVALUATION_INVALID",
  );
  if (
    !Number.isSafeInteger(input.evaluation.tailEventCount) ||
    input.evaluation.tailEventCount < 0 ||
    !Number.isSafeInteger(input.evaluation.sampleSize) ||
    input.evaluation.sampleSize < 1
  ) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_EVALUATION_INVALID");
  }

  const verdict: QualificationVerdictV2 =
    input.verdict === "REJECTED" || (input.failureReasons?.length ?? 0) > 0
      ? "REJECTED"
      : "QUALIFIED";
  const failureReasons = Object.freeze(
    verdict === "REJECTED"
      ? [...(input.failureReasons ?? ["WALK_FORWARD_OR_DEVELOPMENT_FAILED"])]
      : [],
  );

  const body = {
    schemaVersion: QUALIFICATION_RECORD_V2_SCHEMA,
    capitalAuthority: "RESEARCH_ONLY" as const,
    candidateDigestHex: input.candidate.contentDigestHex,
    partition,
    fittingAllowed: partition === "DEVELOPMENT",
    evaluation: Object.freeze({ ...input.evaluation }),
    verdict,
    failureReasons,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

function assertQualificationCandidateV2(candidate: StrategyEvolutionCandidateV2): void {
  const code = "QUALIFICATION_CANDIDATE_INVALID";
  assertResearchV2ContentDigest(candidate, code);
  if (
    candidate.schemaVersion !== STRATEGY_EVOLUTION_CANDIDATE_V2_SCHEMA ||
    candidate.capitalAuthority !== "RESEARCH_ONLY" ||
    candidate.promotionAuthority !== "NONE" ||
    candidate.accountAssignmentAuthority !== "NONE" ||
    candidate.venueWriteAuthority !== "NONE" ||
    !Array.isArray(candidate.assignedAccountIds) ||
    candidate.assignedAccountIds.length !== 0
  ) {
    throw new StrategyEvolutionResearchError(code);
  }
}

/** Bind existing records to their candidate and slots; source-window independence is separate. */
export function assertQualificationPairForCandidateV2(input: {
  candidate: StrategyEvolutionCandidateV2;
  development: QualificationRecordV2;
  walkForward: QualificationRecordV2;
}): void {
  assertQualificationCandidateV2(input.candidate);
  const records = [
    ["DEVELOPMENT", input.development],
    ["WALK_FORWARD", input.walkForward],
  ] as const;
  for (const [partition, record] of records) {
    assertResearchV2ContentDigest(record, "QUALIFICATION_RECORD_INVALID");
    if (record.candidateDigestHex !== input.candidate.contentDigestHex) {
      throw new StrategyEvolutionResearchError("QUALIFICATION_CANDIDATE_MISMATCH");
    }
    if (record.partition !== partition) {
      throw new StrategyEvolutionResearchError("QUALIFICATION_PARTITION_MISMATCH");
    }
    const replay = recordQualificationV2({
      candidate: input.candidate,
      partition,
      evaluation: record.evaluation,
      verdict: record.verdict,
      failureReasons: record.failureReasons,
    });
    if (replay.contentDigestHex !== record.contentDigestHex) {
      throw new StrategyEvolutionResearchError("QUALIFICATION_RECORD_INVALID");
    }
  }
}

export function recordRejectedCandidateV2(input: {
  candidate: StrategyEvolutionCandidateV2;
  development: QualificationRecordV2;
  walkForward: QualificationRecordV2;
}): RejectedCandidateRecordV2 {
  assertQualificationPairForCandidateV2(input);
  if (input.development.verdict !== "REJECTED" && input.walkForward.verdict !== "REJECTED") {
    throw new StrategyEvolutionResearchError("REJECTED_CANDIDATE_REQUIRES_FAILURE");
  }
  const body = {
    schemaVersion: "waia.trader.strategy_evolution_rejected_candidate.v2" as const,
    capitalAuthority: "RESEARCH_ONLY" as const,
    status: "REJECTED" as const,
    candidateDigestHex: input.candidate.contentDigestHex,
    developmentDigestHex: input.development.contentDigestHex,
    walkForwardDigestHex: input.walkForward.contentDigestHex,
    recorded: true as const,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}

export function rerecordRejectedCandidateAsPromotedV2(
  rejected: RejectedCandidateRecordV2,
): RejectedCandidateRecordV2 {
  void rejected;
  throw new StrategyEvolutionResearchError(
    "CANDIDATE_SELF_PROMOTION_FORBIDDEN",
    "A rejected candidate remains REJECTED",
  );
}
