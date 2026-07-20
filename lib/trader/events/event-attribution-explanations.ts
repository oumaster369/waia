import {
  EVENT_ATTRIBUTION_SCHEMA_VERSION,
  type EventAttributionExplanationPayload,
  type EventAttributionSubject,
  type EventClassificationResult,
  type NormalizedEventRecord,
} from "@/lib/trader/events/event-attribution.types";
import type {
  EventAttributionScoreBreakdown,
  EventAttributionScores,
} from "@/lib/trader/events/event-attribution.types";

export function buildEventAttributionExplanationPayload(input: {
  event: NormalizedEventRecord;
  classification: EventClassificationResult;
  subject: EventAttributionSubject;
  breakdown: EventAttributionScoreBreakdown;
  scores: EventAttributionScores;
}): EventAttributionExplanationPayload {
  return {
    schemaVersion: EVENT_ATTRIBUTION_SCHEMA_VERSION,
    eventKey: input.event.eventKey,
    eventDigest: input.event.contentDigest,
    classificationKind: input.classification.classificationKind,
    subjectRef: input.subject.subjectRef,
    subjectKind: input.subject.kind,
    symbol: input.subject.symbol,
    regime: input.subject.regime,
    outcomeTag: input.subject.outcomeTag,
    breakdown: input.breakdown,
    scores: input.scores,
    explanation: [
      `event=${input.event.eventKey}`,
      `classification=${input.classification.classificationKind}`,
      `subject=${input.subject.subjectRef}`,
      `attribution_strength=${input.breakdown.attributionStrength}`,
      `outcome_tag=${input.subject.outcomeTag}`,
      "observational_correlation_only",
    ].join("; "),
  };
}
