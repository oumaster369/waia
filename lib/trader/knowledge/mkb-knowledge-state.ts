import type {
  TraderIntelligenceDecisionForecastLink,
  TraderIntelligenceDecisionRecord,
  TraderIntelligenceEntryPurposeRecord,
  TraderIntelligenceForecastRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { TraderIntelligenceCycleEnvelopeRecord } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { KnowledgeEdge, MarketPrediction } from "@/lib/trader/knowledge/knowledge.types";
import type {
  OutcomeResolutionRow,
  OutcomeResolutionVerdict,
} from "@/lib/trader/knowledge/mkb-read-model.types";

export const MKB_KNOWLEDGE_STATES = [
  "OBSERVATION_ONLY",
  "UNRESOLVED",
  "RESOLVED_CORRECT",
  "RESOLVED_INCORRECT",
  "INSUFFICIENT_EVIDENCE",
  "STALE",
  "INELIGIBLE",
] as const;

export type MkbKnowledgeState = (typeof MKB_KNOWLEDGE_STATES)[number];

/** Aging horizon measured from explicit asOf — never host clock. */
export const MKB_STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

const CAPITAL_AUTHORITY_KEYS = [
  "capitalAllocation",
  "capitalAuthority",
  "orderAuthority",
  "positionSize",
  "promoteToLive",
  "riskMultiplier",
  "tradeEligibility",
  "livePromotion",
] as const;

export class MkbCapitalAuthorityError extends Error {
  readonly code = "MKB_CAPITAL_AUTHORITY_PROHIBITED";

  constructor(message: string) {
    super(message);
    this.name = "MkbCapitalAuthorityError";
  }
}

export function isVerifiedKnowledgeState(state: MkbKnowledgeState): boolean {
  return state === "RESOLVED_CORRECT";
}

export function isObservationOnlyState(state: MkbKnowledgeState): boolean {
  return state === "OBSERVATION_ONLY";
}

export function assertNoCapitalAuthority(value: unknown, path = "root"): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCapitalAuthority(item, `${path}[${index}]`));
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((CAPITAL_AUTHORITY_KEYS as readonly string[]).includes(key)) {
      throw new MkbCapitalAuthorityError(`capital authority field prohibited at ${path}.${key}`);
    }
    assertNoCapitalAuthority(nested, `${path}.${key}`);
  }
}

export function isForecastDecisionChainComplete(input: {
  envelope: TraderIntelligenceCycleEnvelopeRecord | null;
  decision: TraderIntelligenceDecisionRecord | null;
  links: readonly TraderIntelligenceDecisionForecastLink[];
  entryPurpose: TraderIntelligenceEntryPurposeRecord | null;
}): boolean {
  if (!input.envelope || !input.decision) {
    return false;
  }

  if (input.envelope.runId !== input.decision.runId) {
    return false;
  }
  if (input.envelope.cycleId !== input.decision.cycleId) {
    return false;
  }
  if (input.envelope.symbol !== input.decision.symbol) {
    return false;
  }

  if (input.decision.decisionClass === "NO_TRADE") {
    return input.links.length === 0 && input.entryPurpose === null;
  }

  if (input.links.length === 0) {
    return false;
  }

  return input.entryPurpose !== null;
}

export function classifyOutcomeVerdict(
  verdict: OutcomeResolutionVerdict | undefined,
): MkbKnowledgeState {
  switch (verdict) {
    case "CORRECT":
      return "RESOLVED_CORRECT";
    case "INCORRECT":
      return "RESOLVED_INCORRECT";
    case "INSUFFICIENT":
      return "INSUFFICIENT_EVIDENCE";
    default:
      return "UNRESOLVED";
  }
}

export function isStaleAt(
  asOf: Date,
  anchorIso: string,
  staleAfterMs = MKB_STALE_AFTER_MS,
): boolean {
  const anchorMs = Date.parse(anchorIso);
  if (!Number.isFinite(anchorMs)) {
    return false;
  }
  return asOf.getTime() - anchorMs > staleAfterMs;
}

export function classifyForecastKnowledgeState(input: {
  forecast: TraderIntelligenceForecastRecord;
  decision: TraderIntelligenceDecisionRecord | null;
  envelope: TraderIntelligenceCycleEnvelopeRecord | null;
  links: readonly TraderIntelligenceDecisionForecastLink[];
  entryPurpose: TraderIntelligenceEntryPurposeRecord | null;
  asOf: Date;
  outcome?: OutcomeResolutionRow;
}): MkbKnowledgeState {
  if (
    !isForecastDecisionChainComplete({
      envelope: input.envelope,
      decision: input.decision,
      links: input.links,
      entryPurpose: input.entryPurpose,
    })
  ) {
    return "INELIGIBLE";
  }

  if (input.decision?.costEvidenceState === "UNAVAILABLE") {
    return "INSUFFICIENT_EVIDENCE";
  }

  const targetWindowEndMs = Date.parse(input.forecast.targetWindowEndAt);
  if (Number.isFinite(targetWindowEndMs) && input.asOf.getTime() < targetWindowEndMs) {
    return "UNRESOLVED";
  }

  const baseState = classifyOutcomeVerdict(input.outcome?.verdict);
  if (baseState === "UNRESOLVED" && isStaleAt(input.asOf, input.forecast.targetWindowEndAt)) {
    return "STALE";
  }

  if (
    (baseState === "RESOLVED_CORRECT" || baseState === "RESOLVED_INCORRECT") &&
    isStaleAt(input.asOf, input.outcome?.resolvedAt ?? input.forecast.targetWindowEndAt)
  ) {
    return "STALE";
  }

  return baseState;
}

export function classifyLegacyPredictionKnowledgeState(
  prediction: MarketPrediction,
  asOf: Date,
): MkbKnowledgeState {
  if (prediction.subjectRef.trim().length === 0) {
    return "INELIGIBLE";
  }

  if (prediction.predictedAt.getTime() > asOf.getTime()) {
    return "INELIGIBLE";
  }

  if (prediction.verifiedAt === null || prediction.verificationResult === null) {
    return "OBSERVATION_ONLY";
  }

  if (prediction.verifiedAt.getTime() > asOf.getTime()) {
    return "OBSERVATION_ONLY";
  }

  switch (prediction.verificationResult) {
    case "confirmed":
      return "RESOLVED_CORRECT";
    case "rejected":
      return "RESOLVED_INCORRECT";
    case "inconclusive":
      return "INSUFFICIENT_EVIDENCE";
    default:
      return "INELIGIBLE";
  }
}

export function classifyKnowledgeEdgeState(edge: KnowledgeEdge, asOf: Date): MkbKnowledgeState {
  if (edge.createdAt.getTime() > asOf.getTime()) {
    return "INELIGIBLE";
  }

  if (edge.verified) {
    if (isStaleAt(asOf, edge.updatedAt.toISOString())) {
      return "STALE";
    }
    return "RESOLVED_CORRECT";
  }

  if (isStaleAt(asOf, edge.updatedAt.toISOString())) {
    return "STALE";
  }

  return "UNRESOLVED";
}

export function classifyMarketEventState(eventTime: Date, asOf: Date): MkbKnowledgeState {
  if (eventTime.getTime() > asOf.getTime()) {
    return "INELIGIBLE";
  }
  return "OBSERVATION_ONLY";
}

export function classifyNoTradeObservationState(input: {
  envelope: TraderIntelligenceCycleEnvelopeRecord | null;
  decision: TraderIntelligenceDecisionRecord;
  links: readonly TraderIntelligenceDecisionForecastLink[];
  entryPurpose: TraderIntelligenceEntryPurposeRecord | null;
}): MkbKnowledgeState {
  if (
    !isForecastDecisionChainComplete({
      envelope: input.envelope,
      decision: input.decision,
      links: input.links,
      entryPurpose: input.entryPurpose,
    })
  ) {
    return "INELIGIBLE";
  }
  return "OBSERVATION_ONLY";
}
