import {
  EpistemicEvidenceDimension,
  type AppendEvidenceRecordInput,
  type DeriveEvidenceFromMetricsInput,
  type EpistemicEvidenceRecord,
  EPISTEMIC_EVIDENCE_SCHEMA_VERSION,
} from "@/lib/trader/discovery/evidence.types";
import { buildEvidenceRecordContentDigest } from "@/lib/trader/discovery/serialize-discovery";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";

export function appendEvidenceRecord(
  input: AppendEvidenceRecordInput,
  evidenceId: string,
  createdAt = new Date().toISOString(),
): EpistemicEvidenceRecord {
  assertNoBannedFields(input, "appendEvidenceRecord");

  const draft: Omit<EpistemicEvidenceRecord, "contentDigest"> = {
    schemaVersion: EPISTEMIC_EVIDENCE_SCHEMA_VERSION,
    evidenceId,
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    hypothesisRef: input.hypothesisRef ?? null,
    candidateRef: input.candidateRef ?? null,
    dimension: input.dimension,
    direction: input.direction,
    strength: input.strength,
    uncertaintyBandLow: input.uncertaintyBandLow,
    uncertaintyBandHigh: input.uncertaintyBandHigh,
    contradictionRefs: input.contradictionRefs ?? [],
    sourceRunDigest: input.sourceRunDigest,
    relevanceScore: input.relevanceScore,
    rationaleJson: input.rationaleJson,
    createdAt,
  };

  return {
    ...draft,
    contentDigest: buildEvidenceRecordContentDigest(draft),
  };
}

function directionForCoverage(satisfies: boolean): "FOR" | "AGAINST" | "NEUTRAL" {
  return satisfies ? "FOR" : "AGAINST";
}

export function deriveEvidenceFromMetrics(
  input: DeriveEvidenceFromMetricsInput,
  newId: () => string = crypto.randomUUID.bind(crypto),
): EpistemicEvidenceRecord[] {
  assertNoBannedFields(input, "deriveEvidenceFromMetrics");

  const sourceRunDigest = input.sourceRunDigest;
  const records: EpistemicEvidenceRecord[] = [];

  records.push(
    appendEvidenceRecord(
      {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        candidateRef: input.candidateRef,
        dimension: EpistemicEvidenceDimension.RegimeCoverage,
        direction: directionForCoverage(input.satisfiesMultiRegimeCoverage),
        strength: input.satisfiesMultiRegimeCoverage ? "0.85" : "0.20",
        uncertaintyBandLow: "0.10",
        uncertaintyBandHigh: "0.90",
        sourceRunDigest,
        relevanceScore: "1.00",
        rationaleJson: JSON.stringify({
          rule: "regime_coverage_from_attributed_regimes",
          observedRegimeLabels: input.observedRegimeLabels,
          satisfiesMultiRegimeCoverage: input.satisfiesMultiRegimeCoverage,
          note: "epistemic_not_success_probability",
        }),
      },
      newId(),
    ),
  );

  records.push(
    appendEvidenceRecord(
      {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        candidateRef: input.candidateRef,
        dimension: EpistemicEvidenceDimension.SampleAdequacy,
        direction: input.closedTradeCount >= 5 ? "FOR" : "NEUTRAL",
        strength: input.closedTradeCount >= 5 ? "0.70" : "0.35",
        uncertaintyBandLow: "0.15",
        uncertaintyBandHigh: "0.85",
        sourceRunDigest,
        relevanceScore: "1.00",
        rationaleJson: JSON.stringify({
          rule: "closed_trade_count_threshold",
          closedTradeCount: input.closedTradeCount,
          threshold: 5,
        }),
      },
      newId(),
    ),
  );

  records.push(
    appendEvidenceRecord(
      {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        candidateRef: input.candidateRef,
        dimension: EpistemicEvidenceDimension.BlindDiscipline,
        direction: input.blindConsumed ? "FOR" : "NEUTRAL",
        strength: input.blindConsumed ? "0.90" : "0.40",
        uncertaintyBandLow: "0.20",
        uncertaintyBandHigh: "0.95",
        sourceRunDigest,
        relevanceScore: "1.00",
        rationaleJson: JSON.stringify({
          rule: "blind_single_use_consumed",
          blindConsumed: input.blindConsumed,
        }),
      },
      newId(),
    ),
  );

  records.push(
    appendEvidenceRecord(
      {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        candidateRef: input.candidateRef,
        dimension: EpistemicEvidenceDimension.Reproducibility,
        direction: input.walkForwardWindowCount >= 1 ? "FOR" : "AGAINST",
        strength: input.walkForwardWindowCount >= 3 ? "0.80" : "0.45",
        uncertaintyBandLow: "0.10",
        uncertaintyBandHigh: "0.90",
        sourceRunDigest,
        relevanceScore: "1.00",
        rationaleJson: JSON.stringify({
          rule: "walk_forward_window_count",
          walkForwardWindowCount: input.walkForwardWindowCount,
        }),
      },
      newId(),
    ),
  );

  records.push(
    appendEvidenceRecord(
      {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        candidateRef: input.candidateRef,
        dimension: EpistemicEvidenceDimension.ProvenanceComplete,
        direction: input.builderGitSha ? "FOR" : "NEUTRAL",
        strength: input.builderGitSha ? "0.75" : "0.40",
        uncertaintyBandLow: "0.20",
        uncertaintyBandHigh: "0.90",
        sourceRunDigest,
        relevanceScore: "1.00",
        rationaleJson: JSON.stringify({
          rule: "builder_git_sha_present",
          builderGitSha: input.builderGitSha,
          metricsSchemaVersion: input.metricsSchemaVersion,
        }),
      },
      newId(),
    ),
  );

  return records;
}
