import type { FeatureSnapshot } from "@/lib/trader/intelligence/types";
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
};

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
}): RegimeHint {
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
    if (evaluation.status === "ANSWERED") {
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
        status: input.mtfAlignment === "UNCLEAR" ? "PARTIAL" : "ANSWERED",
        answerSummary,
        confidence: 0.55,
        evidenceProvenanceIds: provenanceIds,
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
      status: input.knowledgeGapDescriptions.length > 0 ? "ANSWERED" : "ANSWERED",
      answerSummary:
        input.knowledgeGapDescriptions.length > 0
          ? `${input.knowledgeGapDescriptions.length}_gaps`
          : "none",
      confidence: input.knowledgeGapDescriptions.length > 0 ? 0.75 : 0.9,
      evidenceProvenanceIds: provenanceIds,
      influencesPermission: false,
      influencesPosture: false,
    }),
    Q_DEPLOY_CAPITAL: () => ({
      questionId: "Q_DEPLOY_CAPITAL",
      status: "PARTIAL",
      answerSummary: "deferred_to_posture",
      confidence: 0.5,
      evidenceProvenanceIds: provenanceIds,
      influencesPermission: false,
      influencesPosture: true,
    }),
    Q_PRESERVE_CAPITAL: () => ({
      questionId: "Q_PRESERVE_CAPITAL",
      status: "PARTIAL",
      answerSummary: "deferred_to_posture",
      confidence: 0.5,
      evidenceProvenanceIds: provenanceIds,
      influencesPermission: false,
      influencesPosture: true,
    }),
  };

  return CANONICAL_MARKET_QUESTION_IDS.map((questionId) => questionBuilders[questionId]());
}

export function buildMarketUnderstandingBridge(
  input: BuildMarketUnderstandingBridgeInput,
): MarketUnderstandingSnapshot {
  const { fusedContext, features } = input;
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

  const deployEval = questionEvaluations.find((q) => q.questionId === "Q_DEPLOY_CAPITAL");
  const preserveEval = questionEvaluations.find((q) => q.questionId === "Q_PRESERVE_CAPITAL");
  const finalizedEvaluations = questionEvaluations.map((evaluation) => {
    if (evaluation.questionId === "Q_DEPLOY_CAPITAL") {
      return {
        ...evaluation,
        status: posture === "TRADE" ? ("ANSWERED" as const) : ("PARTIAL" as const),
        answerSummary: posture,
        confidence: finalConfidence,
      };
    }
    if (evaluation.questionId === "Q_PRESERVE_CAPITAL") {
      return {
        ...evaluation,
        status:
          posture === "PRESERVE_CAPITAL" || posture === "NO_TRADE"
            ? ("ANSWERED" as const)
            : ("PARTIAL" as const),
        answerSummary: posture,
        confidence: finalConfidence,
      };
    }
    return evaluation;
  });

  void deployEval;
  void preserveEval;

  return {
    schemaVersion: MARKET_UNDERSTANDING_SCHEMA_VERSION,
    instrumentId: fusedContext.instrumentId,
    evaluatedAt: fusedContext.fusedAtUtc,
    questionEvaluations: finalizedEvaluations,
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
