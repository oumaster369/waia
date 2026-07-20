import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { WP21_EPISTEMIC_AUTHORITY_DEFAULTS } from "@/lib/trader/intelligence/epistemic/epistemic-authority.types";
import {
  deriveHypothesisOutcomeId,
  deriveHypothesisOutcomeIdempotencyKey,
} from "@/lib/trader/intelligence/outcome-resolution/derive-outcome-ids";
import {
  extractHorizonFromForecast,
  extractRegimeFromDecision,
} from "@/lib/trader/intelligence/outcome-resolution/evaluate-forecast-path";
import type {
  ForecastOutcomeRecord,
  HypothesisOutcomeClass,
  HypothesisOutcomeRecord,
  OutcomeResolutionSink,
  OutcomeResolutionSource,
} from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { HYPOTHESIS_OUTCOME_SCHEMA_VERSION } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { computeHypothesisOutcomeContentDigest } from "@/lib/trader/intelligence/outcome-resolution/serialize-outcome-resolution";
import type { TraderIntelligenceHypothesisRecord } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { TraderIntelligenceDecisionRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export function deriveHypothesisOutcomeClass(input: {
  linkedOutcomes: readonly ForecastOutcomeRecord[];
}): HypothesisOutcomeClass {
  if (input.linkedOutcomes.length === 0) {
    return "INCONCLUSIVE";
  }

  if (input.linkedOutcomes.some((row) => row.outcomeClass === "UNRESOLVED_DUE_TO_DATA_INTEGRITY")) {
    return "DATA_INTEGRITY_BLOCKED";
  }

  const resolved = input.linkedOutcomes.filter((row) => row.outcomeClass === "RESOLVED");
  if (resolved.some((row) => row.outcomeVerdict === "CORRECT")) {
    return "SUPPORTING_OBSERVATION";
  }
  if (resolved.some((row) => row.outcomeVerdict === "INCORRECT")) {
    return "CONTRADICTING_OBSERVATION";
  }

  const allTerminal = input.linkedOutcomes.every((row) => row.outcomeClass !== "ACTIVE");
  if (!allTerminal) {
    return "UNRESOLVED";
  }

  return "INCONCLUSIVE";
}

function buildHypothesisOutcomeRecord(input: {
  context: OrgContext;
  hypothesis: TraderIntelligenceHypothesisRecord;
  decision: TraderIntelligenceDecisionRecord | null;
  linkedOutcomes: readonly ForecastOutcomeRecord[];
  asOf: string;
  provenance: HypothesisOutcomeRecord["provenance"];
  eligibleResolutionAt: string;
}): HypothesisOutcomeRecord {
  const outcomeClass = deriveHypothesisOutcomeClass({ linkedOutcomes: input.linkedOutcomes });
  const regime = extractRegimeFromDecision(input.decision?.cdeMsvPermissionSnapshotJson);
  const horizon = input.linkedOutcomes[0]
    ? input.linkedOutcomes[0].horizon
    : extractHorizonFromForecast(input.eligibleResolutionAt, input.hypothesis.evaluatedAt);

  const base: Omit<HypothesisOutcomeRecord, "id" | "idempotencyKey" | "contentDigest"> = {
    organizationId: input.context.organizationId,
    runId: input.hypothesis.runId,
    cycleId: input.hypothesis.cycleId,
    symbol: input.hypothesis.symbol,
    hypothesisRecordId: input.hypothesis.id,
    decisionRecordId: input.decision?.id ?? null,
    forecastOutcomeIdsJson: canonicalizeSemanticJsonString(
      input.linkedOutcomes.map((row) => row.id),
    ),
    modelVersion: input.linkedOutcomes[0]?.modelVersion ?? "unknown",
    strategyVersion: input.decision?.strategyVersion ?? null,
    regime,
    horizon,
    issuedAt: input.hypothesis.evaluatedAt,
    eligibleResolutionAt: input.eligibleResolutionAt,
    resolvedAt: outcomeClass === "UNRESOLVED" ? null : input.asOf,
    pitEvidenceBoundary: input.asOf,
    outcomeClass,
    score: null,
    authorityClass: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.authorityClass,
    operatorDisposition: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.operatorDisposition,
    hypothesisLifecycleAuthority:
      WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.hypothesisLifecycleAuthority,
    strategyPromotionAuthority:
      WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.strategyPromotionAuthority,
    validatedKnowledgeAuthority:
      WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.validatedKnowledgeAuthority,
    sourceRecordIdsJson: canonicalizeSemanticJsonString({
      hypothesis_record_id: input.hypothesis.id,
      forecast_outcome_ids: input.linkedOutcomes.map((row) => row.id),
      authority_class: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.authorityClass,
      operator_disposition: WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.operatorDisposition,
      hypothesis_lifecycle_authority:
        WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.hypothesisLifecycleAuthority,
      strategy_promotion_authority:
        WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.strategyPromotionAuthority,
      validated_knowledge_authority:
        WP21_EPISTEMIC_AUTHORITY_DEFAULTS.hypothesisOutcome.validatedKnowledgeAuthority,
    }),
    provenance: input.provenance,
    terminalReason: outcomeClass,
    schemaVersion: HYPOTHESIS_OUTCOME_SCHEMA_VERSION,
  };

  const id = deriveHypothesisOutcomeId({
    organizationId: input.context.organizationId,
    hypothesisRecordId: input.hypothesis.id,
  });
  const idempotencyKey = deriveHypothesisOutcomeIdempotencyKey({
    organizationId: input.context.organizationId,
    runId: input.hypothesis.runId,
    cycleId: input.hypothesis.cycleId,
    symbol: input.hypothesis.symbol,
    hypothesisRecordId: input.hypothesis.id,
  });

  const draft: HypothesisOutcomeRecord = { ...base, id, idempotencyKey, contentDigest: "" };
  return {
    ...draft,
    contentDigest: computeHypothesisOutcomeContentDigest(draft),
  };
}

export async function resolveEligibleHypothesisOutcomes(input: {
  context: OrgContext;
  runId: string;
  asOf: string;
  source: OutcomeResolutionSource;
  sink: OutcomeResolutionSink;
  provenance: HypothesisOutcomeRecord["provenance"];
  decisionByHypothesisId?: ReadonlyMap<string, TraderIntelligenceDecisionRecord | null>;
  forecastOutcomesByHypothesisId?: ReadonlyMap<string, readonly ForecastOutcomeRecord[]>;
}): Promise<readonly HypothesisOutcomeRecord[]> {
  const hypotheses = await input.source.listHypothesesEligibleForResolution(
    input.context,
    input.runId,
    input.asOf,
  );
  const allOutcomes = await input.source.listForecastOutcomesForRun(input.context, input.runId);
  const resolved: HypothesisOutcomeRecord[] = [];

  for (const hypothesis of hypotheses) {
    const existing = await input.sink.hypothesisOutcomeRepository.findByHypothesisRecordId(
      input.context,
      hypothesis.id,
    );
    if (existing) {
      resolved.push(existing);
      continue;
    }

    const linkedOutcomes =
      input.forecastOutcomesByHypothesisId?.get(hypothesis.id) ??
      allOutcomes.filter((row) => row.hypothesisRecordId === hypothesis.id);

    const eligibleResolutionAt =
      linkedOutcomes.reduce<string | null>((latest, row) => {
        if (!latest || row.eligibleResolutionAt > latest) {
          return row.eligibleResolutionAt;
        }
        return latest;
      }, null) ?? input.asOf;

    if (new Date(input.asOf).getTime() < new Date(eligibleResolutionAt).getTime()) {
      continue;
    }

    const decision = input.decisionByHypothesisId?.get(hypothesis.id) ?? null;
    const record = buildHypothesisOutcomeRecord({
      context: input.context,
      hypothesis,
      decision,
      linkedOutcomes,
      asOf: input.asOf,
      provenance: input.provenance,
      eligibleResolutionAt,
    });

    await input.sink.hypothesisOutcomeRepository.insert(input.context, record);
    resolved.push(record);
  }

  return resolved;
}

export { deriveHypothesisOutcomeId };
