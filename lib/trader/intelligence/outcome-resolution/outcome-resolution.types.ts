import type { Bar } from "@/lib/trader/intelligence/types";
import type { TraderIntelligenceDecisionRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { TraderIntelligenceForecastRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { TraderIntelligenceHypothesisRecord } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { OutcomeResolutionVerdict } from "@/lib/trader/knowledge/mkb-read-model.types";
import type {
  EpistemicAuthorityClass,
  EpistemicDownstreamAuthority,
  EpistemicOperatorDisposition,
  KnowledgeConfidenceValueClass,
} from "@/lib/trader/intelligence/epistemic/epistemic-authority.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export const FORECAST_OUTCOME_SCHEMA_VERSION = "waia.trader.forecast_outcome_record.v1" as const;
export const HYPOTHESIS_OUTCOME_SCHEMA_VERSION =
  "waia.trader.hypothesis_outcome_record.v1" as const;
export const ABSTENTION_OUTCOME_SCHEMA_VERSION =
  "waia.trader.abstention_outcome_record.v1" as const;

export const forecastOutcomeClassEnum = [
  "ACTIVE",
  "RESOLVED",
  "EXPIRED",
  "INVALIDATED",
  "UNRESOLVED_DUE_TO_DATA_INTEGRITY",
] as const;

export type ForecastOutcomeClass = (typeof forecastOutcomeClassEnum)[number];

export const hypothesisOutcomeClassEnum = [
  "SUPPORTING_OBSERVATION",
  "CONTRADICTING_OBSERVATION",
  "INCONCLUSIVE",
  "DATA_INTEGRITY_BLOCKED",
  "UNRESOLVED",
] as const;

export type HypothesisOutcomeClass = (typeof hypothesisOutcomeClassEnum)[number];

export const abstentionOutcomeClassEnum = [
  "NEUTRAL_CONFIRMED",
  "ADVERSE_AVOIDED",
  "OPPORTUNITY_FOREGONE",
  "COST_ADJUSTED_NEGATIVE",
  "SAFETY_MANDATED",
  "MISSING_NET_ECONOMICS",
] as const;

export type AbstentionOutcomeClass = (typeof abstentionOutcomeClassEnum)[number];

export const calibrationNonScoringReasonEnum = [
  "EXPIRED_NO_DIRECTIONAL_CONFIRMATION",
  "DECLARED_INVALIDATION_FIRED",
  "UNRESOLVED_DUE_TO_DATA_INTEGRITY",
  "INVALID_PROBABILITY",
  "STRATEGY_DISABLED_AFTER_ISSUANCE",
  "NON_DIRECTIONAL_FORECAST",
] as const;

export type CalibrationNonScoringReason = (typeof calibrationNonScoringReasonEnum)[number];

export type OutcomeProvenance = Readonly<{
  codeSha: string;
  datasetContentDigest: string;
  profileDigest: string;
  canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1";
}>;

export type ForecastOutcomeRecord = Readonly<{
  id: string;
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  forecastRecordId: string;
  decisionRecordId: string | null;
  hypothesisRecordId: string | null;
  modelVersion: string;
  strategyVersion: string | null;
  regime: string;
  horizon: string;
  issuedAt: string;
  eligibleResolutionAt: string;
  resolvedAt: string | null;
  pitEvidenceBoundary: string | null;
  outcomeClass: ForecastOutcomeClass;
  outcomeVerdict: OutcomeResolutionVerdict | null;
  score: string | null;
  sourceRecordIdsJson: string;
  contentDigest: string;
  idempotencyKey: string;
  provenance: OutcomeProvenance;
  terminalReason: string;
  schemaVersion: typeof FORECAST_OUTCOME_SCHEMA_VERSION;
}>;

export type HypothesisOutcomeRecord = Readonly<{
  id: string;
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  hypothesisRecordId: string;
  decisionRecordId: string | null;
  forecastOutcomeIdsJson: string;
  modelVersion: string;
  strategyVersion: string | null;
  regime: string;
  horizon: string;
  issuedAt: string;
  eligibleResolutionAt: string;
  resolvedAt: string | null;
  pitEvidenceBoundary: string | null;
  outcomeClass: HypothesisOutcomeClass;
  score: string | null;
  authorityClass: EpistemicAuthorityClass;
  operatorDisposition: EpistemicOperatorDisposition;
  hypothesisLifecycleAuthority: EpistemicDownstreamAuthority;
  strategyPromotionAuthority: EpistemicDownstreamAuthority;
  validatedKnowledgeAuthority: EpistemicDownstreamAuthority;
  sourceRecordIdsJson: string;
  contentDigest: string;
  idempotencyKey: string;
  provenance: OutcomeProvenance;
  terminalReason: string;
  schemaVersion: typeof HYPOTHESIS_OUTCOME_SCHEMA_VERSION;
}>;

export type AbstentionOutcomeRecord = Readonly<{
  id: string;
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  decisionRecordId: string;
  forecastRecordId: string | null;
  forecastOutcomeId: string | null;
  modelVersion: string | null;
  strategyVersion: string | null;
  regime: string;
  horizon: string;
  issuedAt: string;
  eligibleResolutionAt: string;
  resolvedAt: string;
  pitEvidenceBoundary: string;
  outcomeClass: AbstentionOutcomeClass;
  score: string | null;
  observedOutcomeJson: string;
  counterfactualTradeSimJson: string | null;
  sourceRecordIdsJson: string;
  contentDigest: string;
  idempotencyKey: string;
  provenance: OutcomeProvenance;
  terminalReason: string;
  schemaVersion: typeof ABSTENTION_OUTCOME_SCHEMA_VERSION;
}>;

export type PitBarWindow = Readonly<{
  bars: readonly Bar[];
  asOf: string;
  evidenceCutoffAt: string;
}>;

export type ForecastOutcomeRepository = Readonly<{
  findByForecastRecordId(
    context: OrgContext,
    forecastRecordId: string,
  ): Promise<ForecastOutcomeRecord | null>;
  listForRun(context: OrgContext, runId: string): Promise<readonly ForecastOutcomeRecord[]>;
  listUnresolvedForRun(
    context: OrgContext,
    runId: string,
  ): Promise<readonly ForecastOutcomeRecord[]>;
  insert(context: OrgContext, record: ForecastOutcomeRecord): Promise<void>;
}>;

export type HypothesisOutcomeRepository = Readonly<{
  findByHypothesisRecordId(
    context: OrgContext,
    hypothesisRecordId: string,
  ): Promise<HypothesisOutcomeRecord | null>;
  insert(context: OrgContext, record: HypothesisOutcomeRecord): Promise<void>;
}>;

export type AbstentionOutcomeRepository = Readonly<{
  findByDecisionRecordId(
    context: OrgContext,
    decisionRecordId: string,
  ): Promise<AbstentionOutcomeRecord | null>;
  insert(context: OrgContext, record: AbstentionOutcomeRecord): Promise<void>;
}>;

export type OutcomeResolutionSink = Readonly<{
  forecastOutcomeRepository: ForecastOutcomeRepository;
  hypothesisOutcomeRepository: HypothesisOutcomeRepository;
  abstentionOutcomeRepository: AbstentionOutcomeRepository;
}>;

export type OutcomeResolutionSource = Readonly<{
  listForecastsEligibleForResolution: (
    context: OrgContext,
    runId: string,
    asOf: string,
  ) => Promise<readonly TraderIntelligenceForecastRecord[]>;
  listHypothesesEligibleForResolution: (
    context: OrgContext,
    runId: string,
    asOf: string,
  ) => Promise<readonly TraderIntelligenceHypothesisRecord[]>;
  listNoTradeDecisionsEligibleForScoring: (
    context: OrgContext,
    runId: string,
    asOf: string,
  ) => Promise<readonly TraderIntelligenceDecisionRecord[]>;
  findForecastOutcomeByForecastId: (
    context: OrgContext,
    forecastRecordId: string,
  ) => Promise<ForecastOutcomeRecord | null>;
  listForecastOutcomesForRun: (
    context: OrgContext,
    runId: string,
  ) => Promise<readonly ForecastOutcomeRecord[]>;
}>;

export type ResolveForecastOutcomeInput = Readonly<{
  context: OrgContext;
  forecast: TraderIntelligenceForecastRecord;
  decision: TraderIntelligenceDecisionRecord | null;
  pitWindow: PitBarWindow;
  provenance: OutcomeProvenance;
  codeSha: string;
}>;
