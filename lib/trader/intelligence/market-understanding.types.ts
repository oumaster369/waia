import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";

export const MARKET_UNDERSTANDING_SCHEMA_VERSION = "waia.trader.market_understanding.v0" as const;

export const CANONICAL_MARKET_QUESTION_IDS = [
  "Q_WHAT_HAPPENING",
  "Q_WHY_HAPPENING",
  "Q_HTF_ALIGNED",
  "Q_LTF_ALIGNED",
  "Q_CROSS_VENUE",
  "Q_CROWD",
  "Q_LIQUIDITY",
  "Q_DATA_TRUST",
  "Q_UNKNOWN",
  "Q_DEPLOY_CAPITAL",
  "Q_PRESERVE_CAPITAL",
] as const;

export type MarketQuestionId = (typeof CANONICAL_MARKET_QUESTION_IDS)[number];

export type MarketQuestionAnswerStatus =
  | "ANSWERED"
  | "PARTIAL"
  | "UNKNOWN"
  | "UNAVAILABLE"
  | "CONFLICTING";

export type MarketQuestionEvaluation = {
  questionId: MarketQuestionId;
  status: MarketQuestionAnswerStatus;
  answerSummary: string;
  confidence: number;
  evidenceProvenanceIds: readonly string[];
  influencesPermission: boolean;
  influencesPosture: boolean;
};

export type KnowledgeGapKind =
  | "UNKNOWN"
  | "UNAVAILABLE"
  | "CONFLICTING"
  | "NEED_MORE_EVIDENCE"
  | "MISSING_CONFIRMATION";

export type KnowledgeGapSnapshot = {
  kind: KnowledgeGapKind;
  questionId: MarketQuestionId;
  description: string;
  blocksPermission: boolean;
  reasonCode: string;
};

export type ConfidenceContributor = {
  source: string;
  direction: "INCREASE" | "DECREASE";
  magnitude: number;
  reasonCode: string;
};

export type ConfidenceAttribution = {
  priorConfidence: number;
  finalConfidence: number;
  confidenceDelta: number;
  contributors: readonly ConfidenceContributor[];
};

export type BridgeReasoningInputs = {
  evidenceUsed: readonly string[];
  evidenceIgnored: readonly string[];
  conflicts: readonly string[];
  unknowns: readonly string[];
};

export type ResearchSignals = {
  unansweredQuestions: readonly MarketQuestionId[];
  conflicts: readonly string[];
  anomalies: readonly string[];
};

export type MtfDirection = "UP" | "DOWN" | "FLAT" | "UNCLEAR";

export type MtfAlignment = "ALIGNED" | "CONFLICTING" | "UNCLEAR";

export type RegimeHint = "TRENDING" | "RANGING" | "CHOPPING" | "STRESSED" | "UNCLEAR";

export type CrossVenueAgreement = "AGREE" | "DISAGREE" | "PARTIAL" | "UNAVAILABLE";

export type SpotPosture = "TRADE" | "WAIT" | "REDUCE_RISK" | "PRESERVE_CAPITAL" | "NO_TRADE";

export type CrossVenueTriangulation = {
  agreement: CrossVenueAgreement;
  binanceDeltaBps: number | null;
  bybitDeltaBps: number | null;
  triangulationConfidence: number;
  reasonCodes: readonly string[];
};

export type GlobalContextPosture = "SUPPORTIVE" | "NEUTRAL" | "HOSTILE" | "UNAVAILABLE";

export type CrowdPsychologyPosture = "EXTREME" | "ELEVATED" | "NEUTRAL" | "UNAVAILABLE";

export type LiquiditySufficiency = "SUFFICIENT" | "THIN" | "UNKNOWN";

export type MarketUnderstandingSnapshot = {
  schemaVersion: typeof MARKET_UNDERSTANDING_SCHEMA_VERSION;
  instrumentId: InstrumentId;
  evaluatedAt: string;
  questionEvaluations: readonly MarketQuestionEvaluation[];
  knowledgeGaps: readonly KnowledgeGapSnapshot[];
  confidenceAttribution: ConfidenceAttribution;
  reasoningInputs: BridgeReasoningInputs;
  mtfBackdrop: Partial<Record<BarInterval, MtfDirection>>;
  mtfAlignment: MtfAlignment;
  regimeHint: RegimeHint;
  crossVenue: CrossVenueTriangulation;
  globalContext: GlobalContextPosture;
  crowdPsychology: CrowdPsychologyPosture;
  liquiditySufficiency: LiquiditySufficiency;
  dataQualitySufficient: boolean;
  dataQualityReasonCodes: readonly string[];
  asianCorridorPresent: boolean;
  spotPosture: SpotPosture;
  postureRationale: readonly string[];
  understandingConfidence: number;
};

export function provenanceId(ref: {
  providerId: string;
  feedKind: string;
  eventTimeUtc: string;
}): string {
  return `${ref.providerId}:${ref.feedKind}:${ref.eventTimeUtc}`;
}
