import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { ResearchHypothesisFamilyV2 } from "@/lib/trader/research-v2/multiple-testing-holm-v2";
import {
  AppendOnlyStrategyAdmissionJournal,
  assessStrategyAdmission,
  strategyAdmissionHypothesisId,
  StrategyAdmissionError,
  type StrategyAdmissionAssessment,
  type StrategyAdmissionKind,
  type StrategyAdmissionObservation,
  type StrategyAdmissionSide,
} from "@/lib/trader/research/strategy-admission-v1";
import {
  assertResearchDiscoveryFitnessV2,
  assertResearchV2ContentDigest,
  requireResearchV2Decimal,
  requireResearchV2DigestHex,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";
import type { StrategyEvolutionCandidateV2 } from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
import { STRATEGY_EVOLUTION_CANDIDATE_V2_SCHEMA } from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
import { compareDecimal } from "@/lib/trader/risk/numeric";

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
  distinctDayCount: number;
  positiveTradeCount: number;
  nonZeroTradeCount: number;
  /** Date-level after-cost nets. Admission refuses a pass when this series is absent. */
  dateNets?: readonly StrategyAdmissionObservation[];
  incumbentComparisonDigestHex: string;
}>;

export type QualificationAdmissionV2 = Readonly<{
  specSha256: string;
  declaredFamilySize: number;
  hypothesisId: string;
  kind: StrategyAdmissionKind;
  intraday: boolean;
  sideDeclared: StrategyAdmissionSide;
  horizonBars: number;
  barIntervalMinutes: number;
  usedForDiscovery: boolean;
  signalBarCloseUtc: string;
  entryTimeUtc: string;
  symbol: string;
  fundingMean: string | null;
  /** False when IS did not qualify and validation was not scored. */
  scored: boolean;
  familyObservationNets: readonly (readonly StrategyAdmissionObservation[])[];
  trialIndex: number;
  assessment: StrategyAdmissionAssessment;
}>;

export type QualificationMultipleTestingV2 = Readonly<{
  method: ResearchHypothesisFamilyV2["method"];
  familySize: number;
  alpha: ResearchHypothesisFamilyV2["alpha"];
  confirmatory: boolean;
  trialIndex: number;
  familyPositiveCounts: readonly number[];
  familyNonZeroCounts: readonly number[];
  familySampleSizes: readonly number[];
  familyDistinctDayCounts: readonly number[];
  rawPValue: string;
  adjustedPValue: string;
}>;

export type QualificationRecordV2 = Readonly<{
  schemaVersion: typeof QUALIFICATION_RECORD_V2_SCHEMA;
  capitalAuthority: "RESEARCH_ONLY";
  candidateDigestHex: string;
  partition: QualificationPartitionV2;
  fittingAllowed: boolean;
  evaluation: QualificationEvaluationV2;
  multipleTesting: QualificationMultipleTestingV2;
  admission: QualificationAdmissionV2;
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

const RECOMPUTED_FAILURE_REASONS = new Set([
  "INSUFFICIENT_DATA",
  "NET_MEAN_DATE_NOT_POSITIVE",
  "HOLM_ADJUSTED_P_ABOVE_ALPHA",
  "WITHOUT_BEST_DATE_NOT_POSITIVE",
  "STABILITY_NOT_MET",
  "VALIDATION_T_BELOW_1_645",
  "DEFLATED_SHARPE_NOT_PASSED",
  "USED_FOR_DISCOVERY_NOT_IN_IS",
  "NET_ECONOMIC_RESULT_NOT_POSITIVE",
  "AUDIT_REQUIRED",
  "IS_NOT_PASSED",
]);

function observationCounts(observations: readonly StrategyAdmissionObservation[]) {
  const dates = new Set(observations.map((row) => row.utcDate));
  return {
    sampleSize: observations.length,
    distinctDayCount: dates.size,
    positiveTradeCount: observations.filter((row) => Number(row.net) > 0).length,
    nonZeroTradeCount: observations.filter((row) => Number(row.net) !== 0).length,
  };
}

function unscoredAdmissionAssessment(familySize: number): StrategyAdmissionAssessment {
  return Object.freeze({
    verdict: "rejected",
    reasons: Object.freeze(["IS_NOT_PASSED"]),
    flags: Object.freeze([]),
    nEvents: 0,
    nDates: 0,
    netMeanEvent: "0.00000000",
    netMeanDate: "0.00000000",
    seMethod: "newey_west" as const,
    nwLag: 0,
    t: "nan",
    pRaw: "1.00000000",
    pHolm: "1.00000000",
    ci95Low: "nan",
    ci95High: "nan",
    withoutBestDate: "nan",
    bestDate: "",
    byQuarter: Object.freeze({}),
    familySize,
    dsr: null,
    familyTrials: Object.freeze([]),
  });
}

function assertDateNetsMatchCounts(evaluation: QualificationEvaluationV2): void {
  if (!evaluation.dateNets) return;
  const counts = observationCounts(evaluation.dateNets);
  if (
    counts.sampleSize !== evaluation.sampleSize ||
    counts.distinctDayCount !== evaluation.distinctDayCount ||
    counts.positiveTradeCount !== evaluation.positiveTradeCount ||
    counts.nonZeroTradeCount !== evaluation.nonZeroTradeCount
  ) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_EVALUATION_INVALID");
  }
}

/**
 * Records a partition qualification. The verdict is computed inside strategy
 * admission from the date-level evidence. A caller-supplied `verdict` is refused.
 */
export function recordQualificationV2(
  input: {
    candidate: StrategyEvolutionCandidateV2;
    partition: QualificationPartitionV2 | "BLIND_HOLDOUT";
    evaluation: QualificationEvaluationV2;
    failureReasons?: readonly string[];
    specSha256: string;
    declaredFamilySize: number;
    kind?: StrategyAdmissionKind;
    intraday?: boolean;
    sideDeclared?: StrategyAdmissionSide;
    horizonBars?: number;
    familyObservations?: readonly (readonly StrategyAdmissionObservation[])[];
    trialIndex?: number;
    usedForDiscovery?: boolean;
    symbol?: string;
    fundingMean?: string | null;
    hypothesisId?: string;
    signalBarCloseUtc?: string;
    entryTimeUtc?: string;
    barIntervalMinutes?: number;
    journal?: AppendOnlyStrategyAdmissionJournal;
    /** Recompute a sealed record without consuming the split again. */
    replay?: boolean;
    /** IS did not qualify. Validation is recorded as unscored and is not assessed. */
    unscored?: boolean;
  } & { verdict?: never },
): QualificationRecordV2 {
  if (input.partition === "BLIND_HOLDOUT") {
    queryBlindHoldoutAsIterativeFitnessV2();
  }
  if (Object.prototype.hasOwnProperty.call(input, "verdict")) {
    throw new StrategyEvolutionResearchError(
      "QUALIFICATION_VERDICT_NOT_ACCEPTED_FROM_CALLER",
      "research-v2 verdict is computed from partition evidence",
    );
  }
  assertResearchDiscoveryFitnessV2(input.evaluation, "qualification evaluation");
  if (!QUALIFICATION_PARTITIONS_V2.includes(input.partition)) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_PARTITION_INVALID");
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
    input.evaluation.tailEventCount < 0
  ) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_EVALUATION_INVALID");
  }
  assertDateNetsMatchCounts(input.evaluation);

  const kind = input.kind ?? "continuous";
  const intraday = input.intraday ?? false;
  const sideDeclared = input.sideDeclared ?? "long";
  const horizonBars = input.horizonBars ?? 1;
  const ownObservations = input.evaluation.dateNets ?? [];
  const familyObservationNets = input.familyObservations ?? [ownObservations];
  const trialIndex = input.trialIndex ?? 0;
  if (
    !Number.isSafeInteger(trialIndex) ||
    trialIndex < 0 ||
    trialIndex >= familyObservationNets.length
  ) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_FAMILY_TRIAL_INVALID");
  }
  const slot = familyObservationNets[trialIndex] ?? [];
  if (JSON.stringify(slot) !== JSON.stringify(ownObservations)) {
    throw new StrategyEvolutionResearchError(
      "QUALIFICATION_FAMILY_TRIAL_MISMATCH",
      "partition evidence must be the declared family trial",
    );
  }
  const split = partition === "DEVELOPMENT" ? "is" : "validation";
  const hypothesisId =
    input.hypothesisId ?? strategyAdmissionHypothesisId(input.specSha256, input.candidate.params);
  const barIntervalMinutes = input.barIntervalMinutes ?? 1;
  const usedForDiscovery = input.usedForDiscovery;
  const signalBarCloseUtc = input.signalBarCloseUtc;
  const entryTimeUtc = input.entryTimeUtc;
  if (typeof usedForDiscovery !== "boolean") {
    throw new StrategyEvolutionResearchError("used_for_discovery_required");
  }
  if (!signalBarCloseUtc || !entryTimeUtc) {
    throw new StrategyEvolutionResearchError(
      "look_ahead_entry",
      "signal close and entry timestamps are required",
    );
  }
  const unscored = input.unscored === true;
  if (!input.replay && !unscored && !input.journal?.durable) {
    throw new StrategyEvolutionResearchError(
      "admission_journal_unavailable",
      "qualification requires a durable admission journal",
    );
  }
  if (split === "validation" && !input.replay && !unscored) {
    input.journal!.assertSplitAvailable({
      specSha256: input.specSha256,
      hypothesisId,
      split: "validation",
    });
  }

  let assessment: StrategyAdmissionAssessment;
  if (unscored) {
    assessment = unscoredAdmissionAssessment(input.declaredFamilySize);
  } else {
    try {
      assessment = assessStrategyAdmission({
        specSha256: input.specSha256,
        declaredFamilySize: input.declaredFamilySize,
        kind,
        intraday,
        sideDeclared,
        horizonBars,
        split,
        trials: familyObservationNets.map((observations, index) => ({
          hypothesisId: index === trialIndex ? hypothesisId : `${hypothesisId}:${index}`,
          observations,
        })),
        confirmatoryIndex: trialIndex,
        symbol: input.symbol,
        fundingMean: input.fundingMean,
        usedForDiscovery,
        signalBarCloseUtc,
        entryTimeUtc,
        barIntervalMinutes,
        journal: input.journal ?? new AppendOnlyStrategyAdmissionJournal(),
        replay: input.replay === true,
      });
    } catch (error) {
      if (error instanceof StrategyAdmissionError) {
        throw new StrategyEvolutionResearchError(error.code, error.message);
      }
      throw error;
    }
  }

  if (split === "validation" && !input.replay && !unscored) {
    input.journal!.append({
      correctsRowIndex: null,
      hypothesisId,
      specSha256: input.specSha256,
      split: "validation",
      familySize: input.declaredFamilySize,
      configParamsJson: JSON.stringify(input.candidate.params),
      nEvents: assessment.nEvents,
      nDates: assessment.nDates,
      netMeanDate: assessment.netMeanDate,
      seMethod: "newey_west",
      nwLag: assessment.nwLag,
      t: assessment.t,
      pRaw: assessment.pRaw,
      pHolm: assessment.pHolm,
      verdict: assessment.verdict,
      verdictReason: assessment.reasons.join(",") || "passed",
      flags: assessment.flags,
      countsAsSplitUse: true,
    });
  }

  const computedReasons = unscored ? ["IS_NOT_PASSED"] : [...assessment.reasons];
  if (compareDecimal(input.evaluation.netEconomicResult, "0") <= 0) {
    computedReasons.push("NET_ECONOMIC_RESULT_NOT_POSITIVE");
  }
  const callerReasons = input.failureReasons ?? [];
  const passed =
    (assessment.verdict === "passed_is" || assessment.verdict === "passed_validation") &&
    computedReasons.length === 0 &&
    callerReasons.length === 0;
  const verdict: QualificationVerdictV2 = passed ? "QUALIFIED" : "REJECTED";
  const failureReasons = Object.freeze(
    verdict === "REJECTED" ? [...new Set([...computedReasons, ...callerReasons])] : [],
  );
  const trial = assessment.familyTrials[trialIndex] ?? {
    trialIndex,
    hypothesisId,
    rawPValue: "1.00000000",
    adjustedPValue: "1.00000000",
    holmRank: 0,
  };
  const countRows = familyObservationNets.map((observations) => observationCounts(observations));
  const multipleTesting: QualificationMultipleTestingV2 = Object.freeze({
    method: "holm" as const,
    familySize: assessment.familySize,
    alpha: "0.05" as const,
    confirmatory: split === "is",
    trialIndex,
    familyPositiveCounts: Object.freeze(countRows.map((row) => row.positiveTradeCount)),
    familyNonZeroCounts: Object.freeze(countRows.map((row) => row.nonZeroTradeCount)),
    familySampleSizes: Object.freeze(countRows.map((row) => row.sampleSize)),
    familyDistinctDayCounts: Object.freeze(countRows.map((row) => row.distinctDayCount)),
    rawPValue: trial.rawPValue,
    adjustedPValue: trial.adjustedPValue,
  });
  const admission: QualificationAdmissionV2 = Object.freeze({
    specSha256: input.specSha256,
    declaredFamilySize: input.declaredFamilySize,
    hypothesisId,
    kind,
    intraday,
    sideDeclared,
    horizonBars,
    barIntervalMinutes,
    usedForDiscovery,
    signalBarCloseUtc,
    entryTimeUtc,
    symbol: input.symbol ?? "",
    fundingMean: input.fundingMean ?? null,
    scored: !unscored,
    familyObservationNets: Object.freeze(
      familyObservationNets.map((observations) => Object.freeze([...observations])),
    ),
    trialIndex,
    assessment,
  });

  const body = {
    schemaVersion: QUALIFICATION_RECORD_V2_SCHEMA,
    capitalAuthority: "RESEARCH_ONLY" as const,
    candidateDigestHex: input.candidate.contentDigestHex,
    partition,
    fittingAllowed: partition === "DEVELOPMENT",
    evaluation: Object.freeze({
      ...input.evaluation,
      ...(input.evaluation.dateNets
        ? { dateNets: Object.freeze([...input.evaluation.dateNets]) }
        : {}),
    }),
    multipleTesting,
    admission,
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
      failureReasons: record.failureReasons.filter(
        (reason) => !RECOMPUTED_FAILURE_REASONS.has(reason),
      ),
      specSha256: record.admission.specSha256,
      declaredFamilySize: record.admission.declaredFamilySize,
      kind: record.admission.kind,
      intraday: record.admission.intraday,
      sideDeclared: record.admission.sideDeclared,
      horizonBars: record.admission.horizonBars,
      barIntervalMinutes: record.admission.barIntervalMinutes,
      familyObservations: record.admission.familyObservationNets,
      trialIndex: record.admission.trialIndex,
      hypothesisId: record.admission.hypothesisId,
      usedForDiscovery: record.admission.usedForDiscovery,
      signalBarCloseUtc: record.admission.signalBarCloseUtc,
      entryTimeUtc: record.admission.entryTimeUtc,
      symbol: record.admission.symbol,
      fundingMean: record.admission.fundingMean,
      replay: true,
      unscored: record.admission.scored === false,
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
