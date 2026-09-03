import { createHash } from "node:crypto";

import type { FeatureSnapshot } from "@/lib/trader/intelligence/types";
import type { ReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import { computeReconstructionContentDigest } from "@/lib/trader/intelligence/reconstruction/reconstruction-assembly";
import {
  INFORMATION_SUFFICIENCY_RUNTIME_AUTHORITY_V2_SCHEMA_VERSION,
  type InformationSufficiencyRuntimeAuthorityV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import {
  MARKET_UNDERSTANDING_QUESTION_MAPPING_V1,
  defineMarketUnderstandingArtifactV1,
  defineUnderstandingClaimV1,
  type MarketUnderstandingArtifactV1,
  type UnderstandingClaimKindV1,
  type UnderstandingClaimStateV1,
  type UnderstandingEvidenceRoleV1,
} from "@/lib/trader/intelligence/market-understanding-evidence-attribution-v1";
import { historicalInstrumentsMatch } from "@/lib/trader/symbols/historical-instrument";
import {
  CANONICAL_MARKET_QUESTION_IDS,
  provenanceId,
  type BridgeReasoningInputs,
  type ConfidenceAttribution,
  type ConfidenceContributor,
  type CrowdPsychologyPosture,
  type CrossVenueAgreement,
  type GlobalContextPosture,
  type KnowledgeGapKind,
  type KnowledgeGapSnapshot,
  type LiquiditySufficiency,
  type MarketQuestionAnswerStatus,
  type MarketQuestionEvaluation,
  type MarketQuestionId,
  type MarketUnderstandingSnapshot,
  type MtfAlignment,
  type MtfDirection,
  type RegimeHint,
  type SpotPosture,
  MARKET_UNDERSTANDING_SCHEMA_VERSION,
} from "@/lib/trader/intelligence/market-understanding.types";
import type {
  FusedMarketContext,
  NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
import { buildCrossVenueTriangulation } from "@/lib/trader/market-data/fusion/cross-venue-triangulation";
import {
  classifyMtfAlignment,
  classifyMtfBackdropFromObservations,
} from "@/lib/trader/market-data/mtf/mtf-backdrop-classifier";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { canonicalJsonString } from "@/lib/trader/research/digest";

const PARTIAL_CONFIDENCE_THRESHOLD = 0.55;
const SPREAD_THIN_BPS = 50;
const PROVIDER_COVERAGE_TRUST_THRESHOLD = 0.3;

function hasAvailableEvidence(observations?: readonly NormalizedObservation[]): boolean {
  return (observations ?? []).some((observation) => observation.health !== "UNAVAILABLE");
}

function countAvailableEvidence(observations?: readonly NormalizedObservation[]): number {
  return (observations ?? []).filter((observation) => observation.health !== "UNAVAILABLE").length;
}

function isAvailableObservation(observation?: NormalizedObservation): boolean {
  return Boolean(observation && observation.health !== "UNAVAILABLE");
}

function isFullIntegrationCycle(fusedContext: FusedMarketContext): boolean {
  if (
    fusedContext.crossExchangeConfirmation !== undefined ||
    fusedContext.fearGreed !== undefined ||
    fusedContext.globalMarket !== undefined
  ) {
    return true;
  }

  const evidenceArrays = [
    fusedContext.macroEvidence,
    fusedContext.newsEvidence,
    fusedContext.blockchainEvidence,
    fusedContext.regulatoryEvidence,
    fusedContext.protocolEvidence,
  ];
  if (evidenceArrays.some((observations) => (observations?.length ?? 0) > 0)) {
    return true;
  }

  return fusedContext.degradationReasons.some((reason) => {
    const providerPrefix = reason.split(":")[0] ?? "";
    return (
      providerPrefix.endsWith("_unavailable") &&
      !providerPrefix.startsWith("order_book") &&
      !providerPrefix.startsWith("market_trades")
    );
  });
}

export function computeProviderCoverageScore(fusedContext: FusedMarketContext): number {
  if (!isFullIntegrationCycle(fusedContext)) {
    const coreChecks = [
      Object.values(fusedContext.mtfBars).some((bars) =>
        (bars ?? []).some((observation) => observation.health !== "UNAVAILABLE"),
      ),
      isAvailableObservation(fusedContext.primaryQuote),
    ];
    const available = coreChecks.filter(Boolean).length;
    return available / coreChecks.length;
  }

  const categories = [
    hasAvailableEvidence(fusedContext.macroEvidence),
    hasAvailableEvidence(fusedContext.newsEvidence),
    hasAvailableEvidence(fusedContext.blockchainEvidence),
    hasAvailableEvidence(fusedContext.regulatoryEvidence),
    hasAvailableEvidence(fusedContext.protocolEvidence),
    isAvailableObservation(fusedContext.orderBookSnapshot),
    isAvailableObservation(fusedContext.marketTradesSnapshot),
    isAvailableObservation(fusedContext.crossExchangeConfirmation),
    isAvailableObservation(fusedContext.fearGreed),
    isAvailableObservation(fusedContext.globalMarket),
  ];
  const available = categories.filter(Boolean).length;
  return available / categories.length;
}

function buildMissingEvidenceGapDescriptions(fusedContext: FusedMarketContext): string[] {
  if (!isFullIntegrationCycle(fusedContext)) {
    return [];
  }

  const gaps: string[] = [];
  if (!hasAvailableEvidence(fusedContext.macroEvidence)) {
    gaps.push("missing_macro_evidence");
  }
  if (!hasAvailableEvidence(fusedContext.newsEvidence)) {
    gaps.push("missing_news_evidence");
  }
  if (!hasAvailableEvidence(fusedContext.blockchainEvidence)) {
    gaps.push("missing_blockchain_evidence");
  }
  if (!hasAvailableEvidence(fusedContext.regulatoryEvidence)) {
    gaps.push("missing_regulatory_evidence");
  }
  if (!hasAvailableEvidence(fusedContext.protocolEvidence)) {
    gaps.push("missing_protocol_evidence");
  }
  if (!isAvailableObservation(fusedContext.orderBookSnapshot)) {
    gaps.push("missing_order_book_snapshot");
  }
  if (!isAvailableObservation(fusedContext.marketTradesSnapshot)) {
    gaps.push("missing_market_trades_snapshot");
  }
  return gaps;
}

export type BuildMarketUnderstandingBridgeInput = {
  fusedContext: FusedMarketContext;
  features: FeatureSnapshot;
  /** PR-2 MI Core: optional reconstruction descriptors (additive). */
  reconstruction?: ReconstructionSnapshot;
};

type ProfileReceiptAuthorityV2 = Extract<
  InformationSufficiencyRuntimeAuthorityV2,
  { kind: "PROFILE_RECEIPT" }
>;

export type BuildExactMarketUnderstandingArtifactInputV1 = Readonly<{
  authority: ProfileReceiptAuthorityV2;
  organizationId: string;
  accountId: string | null;
  symbol: string;
  analyticalTimeframe: string;
  evaluatedAt: string;
  features: FeatureSnapshot;
  reconstruction?: ReconstructionSnapshot;
  questionEvaluations: readonly MarketQuestionEvaluation[];
}>;

function resolveCrossVenue(fusedContext: FusedMarketContext) {
  if (fusedContext.crossVenueTriangulation) {
    return fusedContext.crossVenueTriangulation;
  }
  return buildCrossVenueTriangulation({
    binance:
      fusedContext.crossExchangeConfirmation?.payload.confirmVenue === "binance"
        ? fusedContext.crossExchangeConfirmation
        : undefined,
    bybit:
      fusedContext.crossExchangeConfirmation?.payload.confirmVenue === "bybit"
        ? fusedContext.crossExchangeConfirmation
        : undefined,
  });
}

function classifyCrowdPsychology(fearGreed?: NormalizedObservation): CrowdPsychologyPosture {
  if (!fearGreed || fearGreed.health === "UNAVAILABLE") {
    return "UNAVAILABLE";
  }
  const value = fearGreed.payload.value;
  if (typeof value !== "number") {
    return "UNAVAILABLE";
  }
  if (value <= 20 || value >= 80) {
    return "EXTREME";
  }
  if (value <= 35 || value >= 65) {
    return "ELEVATED";
  }
  return "NEUTRAL";
}

function classifyGlobalContext(global?: NormalizedObservation): GlobalContextPosture {
  if (!global || global.health === "UNAVAILABLE") {
    return "UNAVAILABLE";
  }
  const dominance = global.payload.btcDominance;
  if (typeof dominance !== "number") {
    return "UNAVAILABLE";
  }
  if (dominance >= 58) {
    return "HOSTILE";
  }
  if (dominance <= 45) {
    return "SUPPORTIVE";
  }
  return "NEUTRAL";
}

function classifyLiquidity(
  fusedContext: FusedMarketContext,
  features: FeatureSnapshot,
): LiquiditySufficiency {
  const spreadBps = features.features.spreadBps;
  if (compareDecimal(spreadBps, String(SPREAD_THIN_BPS)) > 0) {
    return "THIN";
  }

  const orderBook = fusedContext.orderBookSnapshot;
  if (orderBook && orderBook.health !== "UNAVAILABLE") {
    const bestBid = orderBook.payload.bestBid;
    const bestAsk = orderBook.payload.bestAsk;
    if (typeof bestBid === "number" && typeof bestAsk === "number" && bestBid > 0) {
      const bookSpreadBps = ((bestAsk - bestBid) / bestBid) * 10_000;
      if (bookSpreadBps > SPREAD_THIN_BPS) {
        return "THIN";
      }
      return "SUFFICIENT";
    }
  }

  if (fusedContext.primaryQuote && fusedContext.primaryQuote.health !== "UNAVAILABLE") {
    return "SUFFICIENT";
  }
  return "UNKNOWN";
}

function classifyRegimeHint(input: {
  mtfAlignment: MtfAlignment;
  mtfBackdrop: Partial<Record<string, MtfDirection>>;
  crowd: CrowdPsychologyPosture;
  features: FeatureSnapshot;
  reconstruction?: ReconstructionSnapshot;
}): RegimeHint {
  if (input.reconstruction) {
    const regimeBias = input.reconstruction.trendStructure.regimeBias;
    if (regimeBias === "TREND") {
      return input.reconstruction.trendStructure.mtfAlignment === "CONFLICTING"
        ? "CHOPPING"
        : "TRENDING";
    }
    if (regimeBias === "RANGE") {
      return "RANGING";
    }
    if (regimeBias === "CHOP") {
      return "CHOPPING";
    }
  }
  if (input.crowd === "EXTREME") {
    return "STRESSED";
  }
  const zscore = input.features.features.zscoreVsSma20;
  if (compareDecimal(zscore, "-0.5") >= 0 && compareDecimal(zscore, "0.5") <= 0) {
    return input.mtfAlignment === "CONFLICTING" ? "CHOPPING" : "RANGING";
  }
  if (input.mtfAlignment === "ALIGNED") {
    return "TRENDING";
  }
  if (input.mtfAlignment === "CONFLICTING") {
    return "CHOPPING";
  }
  return "UNCLEAR";
}

function gapKindForStatus(status: MarketQuestionAnswerStatus): KnowledgeGapKind {
  switch (status) {
    case "UNAVAILABLE":
      return "UNAVAILABLE";
    case "CONFLICTING":
      return "CONFLICTING";
    case "PARTIAL":
      return "NEED_MORE_EVIDENCE";
    case "UNKNOWN":
      return "UNKNOWN";
    default:
      return "MISSING_CONFIRMATION";
  }
}

function buildKnowledgeGaps(
  evaluations: readonly MarketQuestionEvaluation[],
): KnowledgeGapSnapshot[] {
  const gaps: KnowledgeGapSnapshot[] = [];
  for (const evaluation of evaluations) {
    if (
      evaluation.status === "ANSWERED" ||
      evaluation.status === "NOT_REQUIRED" ||
      evaluation.status === "NOT_APPLICABLE"
    ) {
      continue;
    }
    const kind = gapKindForStatus(evaluation.status);
    gaps.push({
      kind,
      questionId: evaluation.questionId,
      description: `${evaluation.questionId}:${evaluation.status}`,
      blocksPermission:
        evaluation.influencesPermission &&
        (evaluation.status === "CONFLICTING" ||
          (evaluation.status === "UNAVAILABLE" && evaluation.questionId === "Q_DATA_TRUST") ||
          evaluation.confidence < PARTIAL_CONFIDENCE_THRESHOLD),
      reasonCode: `GAP_${evaluation.questionId}_${evaluation.status}`,
    });
  }
  return gaps;
}

function buildConfidenceAttribution(input: {
  priorConfidence: number;
  finalConfidence: number;
  fusedContext: FusedMarketContext;
  crossVenueAgreement: CrossVenueAgreement;
  dataQualitySufficient: boolean;
}): ConfidenceAttribution {
  const contributors: ConfidenceContributor[] = [];
  contributors.push({
    source: "fused_context_aggregate",
    direction: "INCREASE",
    magnitude: input.priorConfidence,
    reasonCode: "PRIOR_FUSED_CONFIDENCE",
  });

  if (input.crossVenueAgreement === "DISAGREE") {
    contributors.push({
      source: "cross_venue",
      direction: "DECREASE",
      magnitude: 0.2,
      reasonCode: "CROSS_VENUE_DISAGREE",
    });
  } else if (input.crossVenueAgreement === "PARTIAL") {
    contributors.push({
      source: "cross_venue",
      direction: "DECREASE",
      magnitude: 0.1,
      reasonCode: "CROSS_VENUE_PARTIAL",
    });
  }

  if (!input.dataQualitySufficient) {
    contributors.push({
      source: "feature_engine",
      direction: "DECREASE",
      magnitude: 0.15,
      reasonCode: "DATA_QUALITY_INSUFFICIENT",
    });
  }

  if (input.fusedContext.aggregateHealth === "DEGRADED") {
    contributors.push({
      source: "provider_health",
      direction: "DECREASE",
      magnitude: 0.1,
      reasonCode: "PROVIDER_DEGRADED",
    });
  }

  return {
    priorConfidence: input.priorConfidence,
    finalConfidence: input.finalConfidence,
    confidenceDelta: input.finalConfidence - input.priorConfidence,
    contributors,
  };
}

function buildReasoningInputs(input: {
  fusedContext: FusedMarketContext;
  evaluations: readonly MarketQuestionEvaluation[];
  gaps: readonly KnowledgeGapSnapshot[];
  crossVenue: { reasonCodes: readonly string[] };
}): BridgeReasoningInputs {
  const evidenceUsed = new Set<string>();
  const evidenceIgnored = new Set<string>();
  const usedProvenance = new Set(
    input.evaluations.flatMap((evaluation) => evaluation.evidenceProvenanceIds),
  );

  for (const ref of fusedContextProvenanceRefs(input.fusedContext)) {
    const id = provenanceId(ref);
    if (usedProvenance.has(id)) {
      evidenceUsed.add(id);
    } else {
      evidenceIgnored.add(id);
    }
  }

  return {
    evidenceUsed: [...evidenceUsed],
    evidenceIgnored: [...evidenceIgnored],
    conflicts: [
      ...input.crossVenue.reasonCodes.filter(
        (code) => code.includes("DISAGREE") || code.includes("MISMATCH"),
      ),
      ...input.gaps.filter((gap) => gap.kind === "CONFLICTING").map((gap) => gap.reasonCode),
    ],
    unknowns: input.gaps
      .filter((gap) => gap.kind === "UNKNOWN" || gap.kind === "UNAVAILABLE")
      .map((gap) => gap.reasonCode),
  };
}

function fusedContextProvenanceRefs(fusedContext: FusedMarketContext) {
  return fusedContext.provenance;
}

function resolveSpotPosture(input: {
  dataQualitySufficient: boolean;
  crossVenueAgreement: CrossVenueAgreement;
  regimeHint: RegimeHint;
  globalContext: GlobalContextPosture;
  crowd: CrowdPsychologyPosture;
  gaps: readonly KnowledgeGapSnapshot[];
  fusedHealth: FusedMarketContext["aggregateHealth"];
}): { posture: SpotPosture; rationale: string[] } {
  const rationale: string[] = [];

  if (
    !input.dataQualitySufficient ||
    input.fusedHealth === "UNAVAILABLE" ||
    input.fusedHealth === "STALE"
  ) {
    rationale.push("POSTURE_DATA_QUALITY_INSUFFICIENT");
    return { posture: "NO_TRADE", rationale };
  }

  if (input.crossVenueAgreement === "DISAGREE") {
    rationale.push("POSTURE_CROSS_VENUE_CONFLICT");
    return { posture: "WAIT", rationale };
  }

  if (input.crossVenueAgreement === "UNAVAILABLE") {
    rationale.push("POSTURE_CROSS_VENUE_UNAVAILABLE");
    return { posture: "REDUCE_RISK", rationale };
  }

  const blockingGaps = input.gaps.filter((gap) => gap.blocksPermission);
  if (blockingGaps.length > 0) {
    rationale.push("POSTURE_KNOWLEDGE_GAP_BLOCKS");
    return { posture: "WAIT", rationale };
  }

  if (
    input.regimeHint === "STRESSED" &&
    (input.globalContext === "HOSTILE" || input.crowd === "EXTREME")
  ) {
    rationale.push("POSTURE_PRESERVE_CAPITAL");
    return { posture: "PRESERVE_CAPITAL", rationale };
  }

  if (input.crossVenueAgreement === "PARTIAL" || input.fusedHealth === "DEGRADED") {
    rationale.push("POSTURE_REDUCED_RISK");
    return { posture: "REDUCE_RISK", rationale };
  }

  if (input.regimeHint === "UNCLEAR" || input.regimeHint === "CHOPPING") {
    rationale.push("POSTURE_REDUCED_RISK_UNCLEAR");
    return { posture: "REDUCE_RISK", rationale };
  }

  rationale.push("POSTURE_TRADE_ALLOWED");
  return { posture: "TRADE", rationale };
}

export function evaluateCanonicalMarketQuestions(input: {
  fusedContext: FusedMarketContext;
  features: FeatureSnapshot;
  mtfBackdrop: Partial<Record<string, MtfDirection>>;
  mtfAlignment: MtfAlignment;
  regimeHint: RegimeHint;
  crossVenueAgreement: CrossVenueAgreement;
  crossVenueConfidence: number;
  crowd: CrowdPsychologyPosture;
  liquidity: LiquiditySufficiency;
  globalContext: GlobalContextPosture;
  dataQualitySufficient: boolean;
  dataQualityReasonCodes: readonly string[];
  knowledgeGapDescriptions: readonly string[];
  providerCoverageScore?: number;
}): MarketQuestionEvaluation[] {
  const provenanceIds = input.fusedContext.provenance.map((ref) => provenanceId(ref));
  const providerCoverageScore =
    input.providerCoverageScore ?? computeProviderCoverageScore(input.fusedContext);
  const causalEvidence = [
    ...(input.fusedContext.macroEvidence ?? []),
    ...(input.fusedContext.newsEvidence ?? []),
    ...(input.fusedContext.blockchainEvidence ?? []),
    ...(input.fusedContext.regulatoryEvidence ?? []),
    ...(input.fusedContext.protocolEvidence ?? []),
  ].filter(
    (observation) => observation.health === "HEALTHY" || observation.health === "DEGRADED",
  );
  const causalProvenanceIds = [
    ...new Set(causalEvidence.map((observation) => provenanceId(observation.provenance))),
  ];

  const questionBuilders: Record<MarketQuestionId, () => MarketQuestionEvaluation> = {
    Q_WHAT_HAPPENING: () => ({
      questionId: "Q_WHAT_HAPPENING",
      status: input.regimeHint === "UNCLEAR" ? "PARTIAL" : "ANSWERED",
      answerSummary: input.regimeHint,
      confidence: input.regimeHint === "UNCLEAR" ? 0.4 : 0.8,
      evidenceProvenanceIds: provenanceIds.filter((id) => id.includes("ohlcv_bar")),
      influencesPermission: false,
      influencesPosture: true,
    }),
    Q_WHY_HAPPENING: () => {
      const macroCount = countAvailableEvidence(input.fusedContext.macroEvidence);
      const newsCount = countAvailableEvidence(input.fusedContext.newsEvidence);
      let answerSummary = `mtf_${input.mtfAlignment.toLowerCase()}`;
      if (macroCount > 0) {
        answerSummary += `|macro_${macroCount}`;
      }
      if (newsCount > 0) {
        answerSummary += `|news_${newsCount}`;
      }
      return {
        questionId: "Q_WHY_HAPPENING",
        status:
          causalEvidence.length === 0
            ? "UNKNOWN"
            : input.mtfAlignment === "UNCLEAR"
              ? "PARTIAL"
              : "ANSWERED",
        answerSummary:
          causalEvidence.length === 0 ? "causal_evidence_not_established" : answerSummary,
        confidence: causalEvidence.length === 0 ? 0 : 0.55,
        evidenceProvenanceIds: causalProvenanceIds,
        influencesPermission: false,
        influencesPosture: true,
      };
    },
    Q_HTF_ALIGNED: () => ({
      questionId: "Q_HTF_ALIGNED",
      status:
        input.mtfBackdrop["4h"] === "UNCLEAR" && input.mtfBackdrop["1d"] === "UNCLEAR"
          ? "UNKNOWN"
          : input.mtfAlignment === "CONFLICTING"
            ? "CONFLICTING"
            : "ANSWERED",
      answerSummary: `${input.mtfBackdrop["4h"] ?? "UNCLEAR"}/${input.mtfBackdrop["1d"] ?? "UNCLEAR"}`,
      confidence: input.mtfAlignment === "ALIGNED" ? 0.85 : 0.45,
      evidenceProvenanceIds: provenanceIds.filter((id) => id.includes("ohlcv_bar")),
      influencesPermission: input.mtfAlignment === "CONFLICTING",
      influencesPosture: true,
    }),
    Q_LTF_ALIGNED: () => ({
      questionId: "Q_LTF_ALIGNED",
      status:
        input.mtfBackdrop["1m"] === "UNCLEAR" && input.mtfBackdrop["15m"] === "UNCLEAR"
          ? "UNKNOWN"
          : input.mtfAlignment === "CONFLICTING"
            ? "CONFLICTING"
            : "ANSWERED",
      answerSummary: `${input.mtfBackdrop["1m"] ?? "UNCLEAR"}/${input.mtfBackdrop["15m"] ?? "UNCLEAR"}`,
      confidence: input.mtfAlignment === "ALIGNED" ? 0.8 : 0.45,
      evidenceProvenanceIds: provenanceIds.filter((id) => id.includes("ohlcv_bar")),
      influencesPermission: input.mtfAlignment === "CONFLICTING",
      influencesPosture: true,
    }),
    Q_CROSS_VENUE: () => ({
      questionId: "Q_CROSS_VENUE",
      status:
        input.crossVenueAgreement === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : input.crossVenueAgreement === "DISAGREE"
            ? "CONFLICTING"
            : input.crossVenueAgreement === "PARTIAL"
              ? "PARTIAL"
              : "ANSWERED",
      answerSummary: input.crossVenueAgreement,
      confidence: input.crossVenueConfidence,
      evidenceProvenanceIds: provenanceIds.filter((id) => id.includes("cross_exchange")),
      influencesPermission:
        input.crossVenueAgreement === "DISAGREE" || input.crossVenueAgreement === "PARTIAL",
      influencesPosture: true,
    }),
    Q_CROWD: () => ({
      questionId: "Q_CROWD",
      status: input.crowd === "UNAVAILABLE" ? "UNAVAILABLE" : "ANSWERED",
      answerSummary: input.crowd,
      confidence: input.crowd === "UNAVAILABLE" ? 0 : 0.7,
      evidenceProvenanceIds: provenanceIds.filter((id) => id.includes("fear_greed")),
      influencesPermission: input.crowd === "EXTREME",
      influencesPosture: true,
    }),
    Q_LIQUIDITY: () => ({
      questionId: "Q_LIQUIDITY",
      status: input.liquidity === "UNKNOWN" ? "PARTIAL" : "ANSWERED",
      answerSummary: input.liquidity,
      confidence: input.liquidity === "SUFFICIENT" ? 0.75 : 0.5,
      evidenceProvenanceIds: provenanceIds.filter(
        (id) =>
          id.includes("quote_l1") || id.includes("ohlcv_bar") || id.includes("order_book_snapshot"),
      ),
      influencesPermission: input.liquidity === "THIN",
      influencesPosture: true,
    }),
    Q_DATA_TRUST: () => {
      const trusted =
        input.dataQualitySufficient && providerCoverageScore >= PROVIDER_COVERAGE_TRUST_THRESHOLD;
      return {
        questionId: "Q_DATA_TRUST",
        status: trusted ? "ANSWERED" : "PARTIAL",
        answerSummary: trusted ? "TRUSTED" : "DEGRADED",
        confidence: trusted
          ? Math.min(0.85, 0.5 + providerCoverageScore * 0.5)
          : Math.min(0.35, providerCoverageScore * 0.35),
        evidenceProvenanceIds: provenanceIds,
        influencesPermission: !trusted,
        influencesPosture: true,
      };
    },
    Q_UNKNOWN: () => ({
      questionId: "Q_UNKNOWN",
      status: input.knowledgeGapDescriptions.length > 0 ? "ANSWERED" : "UNKNOWN",
      answerSummary:
        input.knowledgeGapDescriptions.length > 0
          ? `${input.knowledgeGapDescriptions.length}_gaps`
          : "unknowns_not_established",
      confidence: input.knowledgeGapDescriptions.length > 0 ? 0.75 : 0,
      evidenceProvenanceIds: provenanceIds,
      influencesPermission: false,
      influencesPosture: false,
    }),
    Q_HISTORICAL_ANALOGUES: () => ({
      questionId: "Q_HISTORICAL_ANALOGUES",
      status: "NOT_REQUIRED",
      answerSummary: "requires_profile_declared_non_holdout_analogue_evidence",
      confidence: 0,
      evidenceProvenanceIds: [],
      influencesPermission: false,
      influencesPosture: false,
    }),
    Q_DEPLOY_CAPITAL: () => ({
      questionId: "Q_DEPLOY_CAPITAL",
      status: "NOT_APPLICABLE",
      answerSummary: "outside_market_understanding_authority",
      confidence: 0,
      evidenceProvenanceIds: [],
      influencesPermission: false,
      influencesPosture: true,
    }),
    Q_PRESERVE_CAPITAL: () => ({
      questionId: "Q_PRESERVE_CAPITAL",
      status: "NOT_APPLICABLE",
      answerSummary: "outside_market_understanding_authority",
      confidence: 0,
      evidenceProvenanceIds: [],
      influencesPermission: false,
      influencesPosture: true,
    }),
  };

  return CANONICAL_MARKET_QUESTION_IDS.map((questionId) => questionBuilders[questionId]());
}

function exactUnderstandingDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}

function exactTextCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function exactClaimKind(
  questionId: MarketQuestionId,
  state: UnderstandingClaimStateV1,
): UnderstandingClaimKindV1 {
  if (
    state === "UNKNOWN" ||
    state === "UNAVAILABLE" ||
    state === "NOT_REQUIRED" ||
    state === "NOT_APPLICABLE"
  ) {
    return "UNRESOLVED";
  }
  if (questionId === "Q_WHY_HAPPENING" && state !== "CONFLICTED") {
    return "EVIDENCE_SUPPORTED_CAUSAL_ATTRIBUTION";
  }
  if (
    questionId === "Q_HTF_ALIGNED" ||
    questionId === "Q_LTF_ALIGNED" ||
    questionId === "Q_HISTORICAL_ANALOGUES"
  ) {
    return "STRUCTURAL_OR_TEMPORAL_ASSOCIATION";
  }
  return "OBSERVED_FACT";
}

function exactEvidenceRole(
  questionId: MarketQuestionId,
  evidence: ProfileReceiptAuthorityV2["receipt"]["evidenceInventory"][number],
): UnderstandingEvidenceRoleV1 {
  if (evidence.contradiction === "CONTRADICTS" || evidence.contradiction === "UNRESOLVED") {
    return "CONTRADICTING";
  }
  if (evidence.epistemicRole === "CORROBORATING") return "CORROBORATING";
  if (questionId === "Q_WHY_HAPPENING" && evidence.epistemicRole !== "CAUSAL") {
    return "CONTEXTUAL";
  }
  return "SUPPORTING";
}

function contradictionPassesEveryNonContradictionGate(
  evidence: ProfileReceiptAuthorityV2["receipt"]["evidenceInventory"][number],
  requirement: ProfileReceiptAuthorityV2["profile"]["requirements"][number],
  pitAnchor: string,
): boolean {
  const availableAtMs = Date.parse(evidence.availableAt);
  const pitAnchorMs = Date.parse(pitAnchor);
  return (
    evidence.availability === "AVAILABLE" &&
    !evidence.degradationReasonCodes.includes("SOURCE_REVISION_MISMATCH") &&
    availableAtMs <= pitAnchorMs &&
    (requirement.maxStalenessMs === null ||
      pitAnchorMs - availableAtMs <= requirement.maxStalenessMs) &&
    evidence.trust === "TRUSTED" &&
    (requirement.minimumTrustScore === null ||
      (evidence.trustScore !== null && evidence.trustScore >= requirement.minimumTrustScore)) &&
    evidence.pitQualified &&
    evidence.replayEligible &&
    (requirement.allowedObservationKinds.length === 0 ||
      requirement.allowedObservationKinds.includes(evidence.observationKind)) &&
    (requirement.allowedObservationSchemaVersions.length === 0 ||
      requirement.allowedObservationSchemaVersions.includes(evidence.observationSchemaVersion)) &&
    (requirement.allowedMeasurementDefinitionDigests.length === 0 ||
      (evidence.measurementDefinitionContentDigest !== null &&
        requirement.allowedMeasurementDefinitionDigests.includes(
          evidence.measurementDefinitionContentDigest,
        ))) &&
    (requirement.questionId !== "Q_WHY_HAPPENING" || evidence.epistemicRole === "CAUSAL") &&
    (requirement.questionId !== "Q_HISTORICAL_ANALOGUES" ||
      (evidence.epistemicRole === "HISTORICAL_ANALOGUE" &&
        ["DEVELOPMENT", "WALK_FORWARD_PREDICTIVE",
          "ADMISSIBLE_PATTERN_KNOWLEDGE"].includes(evidence.historyScope)))
  );
}

/**
 * Constructs the authoritative evidence-attribution artifact from a validated DEE-621
 * PROFILE_RECEIPT. The legacy snapshot remains a compatibility/fact projection only.
 */
export function buildExactMarketUnderstandingArtifactV1(
  input: BuildExactMarketUnderstandingArtifactInputV1,
): MarketUnderstandingArtifactV1 {
  const { authority } = input;
  if (
    authority.schemaVersion !== INFORMATION_SUFFICIENCY_RUNTIME_AUTHORITY_V2_SCHEMA_VERSION ||
    authority.kind !== "PROFILE_RECEIPT" ||
    authority.authority !== "EPISTEMIC_PREREQUISITE_ONLY" ||
    authority.purpose !== authority.profile.purpose ||
    authority.purpose !== authority.receipt.purpose ||
    authority.organizationId !== input.organizationId ||
    authority.profile.organizationId !== input.organizationId ||
    authority.receipt.organizationId !== input.organizationId ||
    authority.profile.accountId !== input.accountId ||
    authority.receipt.accountId !== input.accountId ||
    (authority.profile.symbol !== input.symbol &&
      !historicalInstrumentsMatch(authority.profile.symbol, input.symbol)) ||
    (authority.receipt.symbol !== input.symbol &&
      !historicalInstrumentsMatch(authority.receipt.symbol, input.symbol)) ||
    (input.features.instrumentId !== input.symbol &&
      !historicalInstrumentsMatch(input.features.instrumentId, input.symbol)) ||
    authority.profile.analyticalTimeframe !== input.analyticalTimeframe ||
    authority.receipt.analyticalTimeframe !== input.analyticalTimeframe ||
    authority.receipt.pitAnchor !== input.evaluatedAt ||
    input.features.evaluatedAt !== input.evaluatedAt ||
    (input.reconstruction !== undefined &&
      ((input.reconstruction.instrumentId !== input.symbol &&
        !historicalInstrumentsMatch(input.reconstruction.instrumentId, input.symbol)) ||
        input.reconstruction.evaluatedAt !== input.evaluatedAt))
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:runtimeScope");
  }
  if (input.reconstruction !== undefined) {
    const { contentDigest, ...reconstructionWithoutDigest } = input.reconstruction;
    if (computeReconstructionContentDigest(reconstructionWithoutDigest) !== contentDigest) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:reconstructionContentDigest");
    }
  }

  const evaluationsById = new Map(
    input.questionEvaluations.map((evaluation) => [evaluation.questionId, evaluation]),
  );
  if (
    input.questionEvaluations.length !== CANONICAL_MARKET_QUESTION_IDS.length ||
    evaluationsById.size !== CANONICAL_MARKET_QUESTION_IDS.length
  ) {
    throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:questionEvaluationCoverage");
  }
  const evidenceById = new Map(
    authority.receipt.evidenceInventory.map((evidence) => [evidence.evidenceId, evidence]),
  );
  const claims = CANONICAL_MARKET_QUESTION_IDS.map((marketQuestionId) => {
    const evaluation = evaluationsById.get(marketQuestionId);
    if (!evaluation) {
      throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:questionEvaluationCoverage");
    }
    const mapping = MARKET_UNDERSTANDING_QUESTION_MAPPING_V1.find(
      (candidate) => candidate.marketQuestionId === marketQuestionId,
    )!;
    const requirements = mapping.informationQuestionId
      ? authority.receipt.requirementReceipts.filter(
          (requirement) => requirement.questionId === mapping.informationQuestionId,
        )
      : [];
    const profileRequirementsById = new Map(
      authority.profile.requirements.map((requirement) => [requirement.id, requirement]),
    );
    const consumedEvidenceIdsSet = new Set<string>();
    for (const receiptRequirement of requirements) {
      const definition = profileRequirementsById.get(receiptRequirement.requirementId);
      if (!definition) {
        throw new Error("MARKET_UNDERSTANDING_ATTRIBUTION_INVALID:requirementDefinitionClosure");
      }
      const accepted = receiptRequirement.acceptedEvidenceIds
        .map((evidenceId) => evidenceById.get(evidenceId)!)
        .sort((left, right) => exactTextCompare(left.evidenceId, right.evidenceId));
      const acceptedContradictions = accepted.filter(
        (evidence) =>
          evidence.contradiction === "CONTRADICTS" || evidence.contradiction === "UNRESOLVED",
      );
      const acceptedNonContradictions = accepted.filter(
        (evidence) =>
          evidence.contradiction !== "CONTRADICTS" && evidence.contradiction !== "UNRESOLVED",
      );
      for (const evidence of acceptedContradictions) {
        consumedEvidenceIdsSet.add(evidence.evidenceId);
      }
      const selectedGroups = new Set(
        acceptedContradictions.map((evidence) => evidence.dependenceGroup),
      );
      for (const evidence of acceptedNonContradictions) {
        if (selectedGroups.has(evidence.dependenceGroup)) continue;
        consumedEvidenceIdsSet.add(evidence.evidenceId);
        selectedGroups.add(evidence.dependenceGroup);
        if (selectedGroups.size >= definition.minimumIndependentGroups) break;
      }
      if (receiptRequirement.terminalStatus === "UNRESOLVED_CONTRADICTION") {
        const contradiction = receiptRequirement.matchedEvidenceIds
          .map((evidenceId) => evidenceById.get(evidenceId)!)
          .filter(
            (evidence) =>
              (evidence.contradiction === "CONTRADICTS" ||
                evidence.contradiction === "UNRESOLVED") &&
              contradictionPassesEveryNonContradictionGate(
                evidence,
                definition,
                authority.receipt.pitAnchor,
              ),
          )
          .sort((left, right) => exactTextCompare(left.evidenceId, right.evidenceId))[0];
        if (contradiction) consumedEvidenceIdsSet.add(contradiction.evidenceId);
      }
    }
    const consumedEvidenceIds = [...consumedEvidenceIdsSet].sort(exactTextCompare);
    const hasContradiction = consumedEvidenceIds.some((evidenceId) => {
      const evidence = evidenceById.get(evidenceId)!;
      return evidence.contradiction === "CONTRADICTS" || evidence.contradiction === "UNRESOLVED";
    });
    const activeRequired = requirements.filter(
      (entry) => entry.active && entry.classification !== "OPTIONAL_ENRICHMENT",
    );
    const allActiveAnswered =
      activeRequired.length > 0 &&
      activeRequired.every((entry) => entry.terminalStatus === "ANSWERED_SUFFICIENTLY");
    let claimState: UnderstandingClaimStateV1;
    if (mapping.informationQuestionId === null) {
      claimState = "NOT_APPLICABLE";
    } else if (hasContradiction) {
      claimState = "CONFLICTED";
    } else if (allActiveAnswered) {
      claimState = "SUPPORTED";
    } else if (consumedEvidenceIds.length > 0 && !allActiveAnswered) {
      claimState = "PARTIALLY_SUPPORTED";
    } else if (
      requirements.length > 0 &&
      requirements.every((entry) => entry.terminalStatus === "NOT_REQUIRED")
    ) {
      claimState = "NOT_REQUIRED";
    } else if (requirements.some((entry) => entry.terminalStatus === "UNAVAILABLE")) {
      claimState = "UNAVAILABLE";
    } else {
      claimState = "UNKNOWN";
    }

    const questionPrefix = `question.${marketQuestionId.toLowerCase()}`;
    const questionInputPath = `${questionPrefix}.receipt_selection`;
    const computationInputs = [
      {
        path: questionInputPath,
        contentDigest: exactUnderstandingDigest({
          marketQuestionId,
          informationQuestionId: mapping.informationQuestionId,
          requirementStates: requirements.map((requirement) => ({
            requirementId: requirement.requirementId,
            terminalStatus: requirement.terminalStatus,
            blocking: requirement.blocking,
          })),
          consumedEvidenceIds,
        }),
      },
    ];
    const dependencyPaths = [questionInputPath];
    if (requirements.length > 0) {
      const computedAnswerPath = `${questionPrefix}.computed_answer`;
      computationInputs.push({
        path: computedAnswerPath,
        contentDigest: exactUnderstandingDigest({
          questionId: evaluation.questionId,
          status: evaluation.status,
          answerSummary: evaluation.answerSummary,
          confidence: evaluation.confidence,
          influencesPermission: evaluation.influencesPermission,
          influencesPosture: evaluation.influencesPosture,
        }),
      });
      dependencyPaths.push(computedAnswerPath);
    }
    if (marketQuestionId === "Q_WHAT_HAPPENING") {
      const featurePath = `${questionPrefix}.feature.zscore_vs_sma20`;
      computationInputs.push({
        path: featurePath,
        contentDigest: exactUnderstandingDigest({
          value: input.features.features.zscoreVsSma20,
        }),
      });
      dependencyPaths.push(featurePath);
      if (input.reconstruction !== undefined) {
        const reconstructionPath = `${questionPrefix}.reconstruction`;
        computationInputs.push({
          path: reconstructionPath,
          contentDigest: input.reconstruction.contentDigest,
        });
        dependencyPaths.push(reconstructionPath);
      }
    }
    if (marketQuestionId === "Q_LIQUIDITY") {
      const featurePath = `${questionPrefix}.feature.spread_bps`;
      computationInputs.push({
        path: featurePath,
        contentDigest: exactUnderstandingDigest({
          value: input.features.features.spreadBps,
        }),
      });
      dependencyPaths.push(featurePath);
    }
    if (marketQuestionId === "Q_DATA_TRUST") {
      const featurePath = `${questionPrefix}.feature.data_quality_score`;
      computationInputs.push({
        path: featurePath,
        contentDigest: exactUnderstandingDigest({
          value: input.features.dataQualityScore,
        }),
      });
      dependencyPaths.push(featurePath);
    }
    const receiptAnswerSummary =
      claimState === "NOT_APPLICABLE"
        ? "outside_market_understanding_authority"
        : claimState === "NOT_REQUIRED"
          ? "question_not_required_by_profile"
          : claimState === "UNAVAILABLE"
            ? "question_evidence_unavailable"
            : requirements.length === 0
              ? "question_requirement_not_declared"
              : claimState === "CONFLICTED"
                ? "question_conflicted_by_canonical_evidence"
                : claimState === "PARTIALLY_SUPPORTED"
                  ? "question_partially_supported_by_canonical_evidence"
                  : claimState === "SUPPORTED"
                    ? "question_supported_by_canonical_evidence"
                    : "question_evidence_unresolved";
    const answerSummary =
      requirements.length > 0 &&
      (claimState === "SUPPORTED" ||
        claimState === "PARTIALLY_SUPPORTED" ||
        claimState === "CONFLICTED")
        ? evaluation.answerSummary
        : receiptAnswerSummary;
    return defineUnderstandingClaimV1({
      profile: authority.profile,
      receipt: authority.receipt,
      computationInputs,
      marketQuestionId,
      claimState,
      claimKind: exactClaimKind(marketQuestionId, claimState),
      answerSummary,
      consumedEvidence: consumedEvidenceIds.map((evidenceId) => {
        const evidence = evidenceById.get(evidenceId)!;
        return {
          evidenceId,
          role: exactEvidenceRole(marketQuestionId, evidence),
          dependencyPaths,
        };
      }),
    });
  });

  return defineMarketUnderstandingArtifactV1({
    profile: authority.profile,
    receipt: authority.receipt,
    evaluatedAt: input.evaluatedAt,
    claims,
  });
}

export function buildMarketUnderstandingBridge(
  input: BuildMarketUnderstandingBridgeInput,
): MarketUnderstandingSnapshot {
  const { fusedContext, features, reconstruction } = input;
  const mtfBackdrop = classifyMtfBackdropFromObservations(fusedContext.mtfBars);
  const mtfAlignment = classifyMtfAlignment(mtfBackdrop);
  const crowd = classifyCrowdPsychology(fusedContext.fearGreed);
  const globalContext = classifyGlobalContext(fusedContext.globalMarket);
  const liquidity = classifyLiquidity(fusedContext, features);
  const providerCoverageScore = computeProviderCoverageScore(fusedContext);
  const crossVenue = resolveCrossVenue(fusedContext);
  const regimeHint = classifyRegimeHint({
    mtfAlignment,
    mtfBackdrop,
    crowd,
    features,
    reconstruction,
  });

  const dataQualityReasonCodes: string[] = [];
  const dataQualitySufficient =
    features.dataQualityScore >= 0.5 &&
    fusedContext.aggregateHealth !== "UNAVAILABLE" &&
    fusedContext.aggregateHealth !== "STALE";
  if (!dataQualitySufficient) {
    dataQualityReasonCodes.push("DATA_QUALITY_BELOW_THRESHOLD");
  }

  const preliminaryEvaluations = evaluateCanonicalMarketQuestions({
    fusedContext,
    features,
    mtfBackdrop,
    mtfAlignment,
    regimeHint,
    crossVenueAgreement: crossVenue.agreement,
    crossVenueConfidence: crossVenue.triangulationConfidence,
    crowd,
    liquidity,
    globalContext,
    dataQualitySufficient,
    dataQualityReasonCodes,
    knowledgeGapDescriptions: [],
    providerCoverageScore,
  });

  const knowledgeGaps = buildKnowledgeGaps(preliminaryEvaluations);
  const missingEvidenceGaps = buildMissingEvidenceGapDescriptions(fusedContext);

  const questionEvaluations = evaluateCanonicalMarketQuestions({
    fusedContext,
    features,
    mtfBackdrop,
    mtfAlignment,
    regimeHint,
    crossVenueAgreement: crossVenue.agreement,
    crossVenueConfidence: crossVenue.triangulationConfidence,
    crowd,
    liquidity,
    globalContext,
    dataQualitySufficient,
    dataQualityReasonCodes,
    knowledgeGapDescriptions: [
      ...knowledgeGaps.map((gap) => gap.description),
      ...missingEvidenceGaps,
    ],
    providerCoverageScore,
  });

  const priorConfidence = fusedContext.aggregateConfidence;
  let finalConfidence = Math.min(
    priorConfidence,
    features.dataQualityScore,
    crossVenue.triangulationConfidence,
  );
  if (!dataQualitySufficient) {
    finalConfidence = Math.min(finalConfidence, 0.35);
  }
  if (knowledgeGaps.some((gap) => gap.blocksPermission)) {
    finalConfidence = Math.min(finalConfidence, 0.45);
  }

  const confidenceAttribution = buildConfidenceAttribution({
    priorConfidence,
    finalConfidence,
    fusedContext,
    crossVenueAgreement: crossVenue.agreement,
    dataQualitySufficient,
  });

  const reasoningInputs = buildReasoningInputs({
    fusedContext,
    evaluations: questionEvaluations,
    gaps: knowledgeGaps,
    crossVenue,
  });

  const { posture, rationale } = resolveSpotPosture({
    dataQualitySufficient,
    crossVenueAgreement: crossVenue.agreement,
    regimeHint,
    globalContext,
    crowd,
    gaps: knowledgeGaps,
    fusedHealth: fusedContext.aggregateHealth,
  });

  return {
    schemaVersion: MARKET_UNDERSTANDING_SCHEMA_VERSION,
    instrumentId: fusedContext.instrumentId,
    evaluatedAt: fusedContext.fusedAtUtc,
    questionEvaluations,
    knowledgeGaps,
    confidenceAttribution,
    reasoningInputs,
    mtfBackdrop,
    mtfAlignment,
    regimeHint,
    crossVenue,
    globalContext,
    crowdPsychology: crowd,
    liquiditySufficiency: liquidity,
    dataQualitySufficient,
    dataQualityReasonCodes,
    asianCorridorPresent: Boolean(fusedContext.asianRangeCorridor?.isResearchSeedOnly),
    spotPosture: posture,
    postureRationale: rationale,
    understandingConfidence: finalConfidence,
  };
}

export function buildResearchSignals(
  understanding: MarketUnderstandingSnapshot,
): import("@/lib/trader/intelligence/market-understanding.types").ResearchSignals {
  return {
    unansweredQuestions: understanding.questionEvaluations
      .filter((evaluation) => evaluation.status !== "ANSWERED")
      .map((evaluation) => evaluation.questionId),
    conflicts: [
      ...understanding.reasoningInputs.conflicts,
      ...understanding.knowledgeGaps
        .filter((gap) => gap.kind === "CONFLICTING")
        .map((gap) => gap.reasonCode),
    ],
    anomalies: [
      ...(understanding.mtfAlignment === "CONFLICTING" ? ["MTF_ALIGNMENT_CONFLICT"] : []),
      ...(understanding.crowdPsychology === "EXTREME" && understanding.regimeHint === "TRENDING"
        ? ["CROWD_EXTREME_WITH_TREND"]
        : []),
    ],
  };
}
