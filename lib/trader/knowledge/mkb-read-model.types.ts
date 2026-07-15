import type { MkbKnowledgeState } from "@/lib/trader/knowledge/mkb-knowledge-state";
import type {
  KnowledgeEdge,
  MarketEvent,
  MarketPrediction,
} from "@/lib/trader/knowledge/knowledge.types";
import type {
  TraderIntelligenceConvictionRecord,
  TraderIntelligenceCycleEnvelopeRecord,
  TraderIntelligenceHypothesisRecord,
} from "@/lib/trader/intelligence/records/intelligence-records.types";
import type {
  TraderIntelligenceDecisionForecastLink,
  TraderIntelligenceDecisionRecord,
  TraderIntelligenceEntryPurposeRecord,
  TraderIntelligenceForecastRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export const MKB_READ_MODEL_SCHEMA_VERSION = "waia.trader.mkb_read_model.v1" as const;

export const mkbSubjectKindEnum = [
  "forecast",
  "knowledge_edge",
  "market_prediction",
  "market_event",
  "no_trade_observation",
] as const;

export type MkbSubjectKind = (typeof mkbSubjectKindEnum)[number];

export const outcomeResolutionVerdictEnum = ["CORRECT", "INCORRECT", "INSUFFICIENT"] as const;

export type OutcomeResolutionVerdict = (typeof outcomeResolutionVerdictEnum)[number];

export type OutcomeResolutionRow = Readonly<{
  organizationId: string;
  forecastRecordId: string;
  resolvedAt: string;
  verdict: OutcomeResolutionVerdict;
}>;

export type OutcomeResolutionReadPort = Readonly<{
  listResolvedOutcomes: (
    context: OrgContext,
    asOf: Date,
    query: MkbReadModelQuery,
  ) => Promise<readonly OutcomeResolutionRow[]>;
}>;

export type MkbReadModelQuery = Readonly<{
  runId?: string;
  cycleId?: string;
  symbol?: string;
  regimeScope?: string;
  limit?: number;
}>;

export type MkbReadModelEntry = Readonly<{
  subjectKind: MkbSubjectKind;
  subjectId: string;
  knowledgeState: MkbKnowledgeState;
  asOf: string;
  organizationId: string;
  runId?: string;
  cycleId?: string;
  symbol?: string;
  regimeScope?: string;
  strategyId?: string | null;
  strategyVersion?: string | null;
  lineageDigest?: string;
  metadata?: Readonly<Record<string, string>>;
}>;

export type MkbReadModelResult = Readonly<{
  schemaVersion: typeof MKB_READ_MODEL_SCHEMA_VERSION;
  asOf: string;
  entries: readonly MkbReadModelEntry[];
  verifiedKnowledge: readonly MkbReadModelEntry[];
  semanticDigest: string;
}>;

export type ForecastDecisionLineageRow = Readonly<{
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  cycleEnvelopeId: string;
  forecastRecordIds: readonly string[];
  decisionRecordId: string | null;
  entryPurposeRecordId: string | null;
  hypothesisRecordIds: readonly string[];
  convictionRecordId: string | null;
  chainComplete: boolean;
}>;

export type PatternDiscoveryCandidate = Readonly<{
  edgeId: string;
  fromRef: string;
  toRef: string;
  relationKind: string;
  regimeScope: string;
  confidence: string;
  verified: boolean;
  knowledgeState: MkbKnowledgeState;
}>;

export type NoTradeObservation = Readonly<{
  decisionRecordId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  evaluatedAt: string;
  universalTerminalReasonCode: string;
  whyCashOrAbstainJson: string | null;
  knowledgeState: MkbKnowledgeState;
}>;

export type HypothesisFamilyByRegime = Readonly<{
  regimeScope: string;
  hypothesisTypes: readonly string[];
  hypothesisRecordIds: readonly string[];
  edgeIds: readonly string[];
}>;

export type MkbReadModelSnapshot = Readonly<{
  cycleEnvelopes: readonly TraderIntelligenceCycleEnvelopeRecord[];
  hypotheses: readonly TraderIntelligenceHypothesisRecord[];
  convictions: readonly TraderIntelligenceConvictionRecord[];
  forecasts: readonly TraderIntelligenceForecastRecord[];
  decisions: readonly TraderIntelligenceDecisionRecord[];
  links: readonly TraderIntelligenceDecisionForecastLink[];
  entryPurposes: readonly TraderIntelligenceEntryPurposeRecord[];
  knowledgeEdges: readonly KnowledgeEdge[];
  marketPredictions: readonly MarketPrediction[];
  marketEvents: readonly MarketEvent[];
}>;
