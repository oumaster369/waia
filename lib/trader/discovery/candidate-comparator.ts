import {
  EPISTEMIC_EVIDENCE_DIMENSIONS,
  type EpistemicEvidenceDimension,
  type EpistemicEvidenceRecord,
} from "@/lib/trader/discovery/evidence.types";
import type {
  CandidateComparatorResult,
  ComparisonDimensionScore,
} from "@/lib/trader/discovery/comparison.types";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";
import { compareDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";
import { createHash } from "node:crypto";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

export type CandidateComparatorInput = {
  candidates: readonly string[];
  evidenceByCandidate: ReadonlyMap<string, EpistemicEvidenceRecord[]>;
};

const DIRECTION_WEIGHT: Record<"FOR" | "AGAINST" | "NEUTRAL", string> = {
  FOR: "1",
  AGAINST: "-1",
  NEUTRAL: "0",
};

function scoreDimension(record: EpistemicEvidenceRecord): ComparisonDimensionScore {
  return {
    dimension: record.dimension,
    direction: record.direction,
    strength: record.strength,
    relevanceScore: record.relevanceScore,
  };
}

function aggregateRankScore(records: readonly EpistemicEvidenceRecord[]): string {
  let total = "0";
  for (const record of records) {
    if (!EPISTEMIC_EVIDENCE_DIMENSIONS.includes(record.dimension as EpistemicEvidenceDimension)) {
      continue;
    }
    const signed = multiplyDecimal(
      multiplyDecimal(record.strength, record.relevanceScore),
      DIRECTION_WEIGHT[record.direction],
    );
    total = (Number(total) + Number(signed)).toFixed(8);
  }
  return total;
}

function buildComparisonDigest(ranked: CandidateComparatorResult["ranked"]): string {
  return createHash("sha256").update(canonicalJsonString({ ranked }), "utf8").digest("hex");
}

export function rankCandidatesByEpistemicEvidence(
  input: CandidateComparatorInput,
): CandidateComparatorResult {
  assertNoBannedFields(input, "candidateComparatorInput");

  const ranked = input.candidates
    .map((candidateRef) => {
      const records = input.evidenceByCandidate.get(candidateRef) ?? [];
      assertNoBannedFields(records, `evidenceFor:${candidateRef}`);
      const dimensionScores = records.map(scoreDimension);
      return {
        candidateRef,
        aggregateRankScore: aggregateRankScore(records),
        dimensionScores,
        rank: 0,
      };
    })
    .sort((a, b) => compareDecimal(b.aggregateRankScore, a.aggregateRankScore))
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  return {
    ranked,
    comparisonDigest: buildComparisonDigest(ranked),
  };
}
