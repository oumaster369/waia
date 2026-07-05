import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { insertKnowledgeEdgePostgres } from "@/lib/trader/knowledge/knowledge-edge-repository-postgres";
import { insertMarketEventPostgres } from "@/lib/trader/knowledge/market-event-repository-postgres";
import {
  buildCloseKnowledgeToRef,
  buildEventKnowledgeFromRef,
  buildPatternKnowledgeToRef,
  buildPriceWindowKnowledgeToRef,
  buildRejectionKnowledgeToRef,
  eventKnowledgeRelationKinds,
  type EventKnowledgeRelationKind,
} from "@/lib/trader/knowledge/event-knowledge-relation-kinds";
import type { EventAttributionExplanationPayload } from "@/lib/trader/events/event-attribution.types";
import type { EventClassificationResult } from "@/lib/trader/events/event-attribution.types";
import type { NormalizedEventRecord } from "@/lib/trader/events/event-attribution.types";
import {
  insertEventAttributionConfidencePostgres,
  insertEventAttributionPostgres,
  insertEventClassificationPostgres,
  insertEventExplanationPostgres,
  insertEventRecordPostgres,
} from "@/lib/trader/events/event-record-repository-postgres";
import {
  buildEventAttributionContentDigest,
  buildEventClassificationContentDigest,
  buildEventExplanationContentDigest,
} from "@/lib/trader/events/serialize-event-attribution";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type RecordEventKnowledgeInput = {
  event: NormalizedEventRecord;
  classification: EventClassificationResult;
  explanation: EventAttributionExplanationPayload;
  recordedAt?: Date;
  newId?: () => string;
  /** When set, skips event + classification inserts (one record per external event). */
  existingEventRecordId?: string;
  windowStartMs?: number;
  windowEndMs?: number;
};

export type RecordEventKnowledgeResult = {
  eventRecordId: string;
  classificationId: string;
  attributionId: string;
  confidenceId: string;
  explanationId: string;
  marketEventId: string;
  knowledgeEdgeId: string;
};

function resolveRelationKind(
  subjectKind: EventAttributionExplanationPayload["subjectKind"],
): EventKnowledgeRelationKind {
  switch (subjectKind) {
    case "price_window":
      return eventKnowledgeRelationKinds.eventAttributedToPriceMove;
    case "pattern":
      return eventKnowledgeRelationKinds.eventAssociatedWithPattern;
    case "close":
      return eventKnowledgeRelationKinds.eventAssociatedWithClose;
    case "rejection":
      return eventKnowledgeRelationKinds.eventAssociatedWithRejection;
  }
}

function resolveToRef(explanation: EventAttributionExplanationPayload): string {
  if (explanation.subjectKind === "price_window") {
    const match = /^price_window:([^:]+):(\d+):(\d+)$/.exec(explanation.subjectRef);
    if (match) {
      return buildPriceWindowKnowledgeToRef({
        symbol: match[1]!,
        windowStartMs: Number(match[2]),
        windowEndMs: Number(match[3]),
      });
    }
  }
  if (explanation.subjectKind === "close") {
    const orderId = explanation.subjectRef.replace(/^close:order:/, "");
    return buildCloseKnowledgeToRef({ orderId });
  }
  if (explanation.subjectKind === "rejection") {
    const signalId = explanation.subjectRef.replace(/^signal:/, "").replace(/:rejected$/, "");
    return buildRejectionKnowledgeToRef({ strategySignalId: signalId });
  }
  if (explanation.subjectKind === "pattern") {
    const body = explanation.subjectRef.replace(/^pattern:/, "");
    const at = body.lastIndexOf("@");
    if (at > 0) {
      return buildPatternKnowledgeToRef({
        patternKey: body.slice(0, at),
        definitionDigest: body.slice(at + 1),
      });
    }
  }
  return explanation.subjectRef;
}

/**
 * Append-only event knowledge writer — inserts event tables, market event, and edge.
 * Does not update existing edges (M7 insert-only constraint).
 */
export async function recordEventKnowledgePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: RecordEventKnowledgeInput,
): Promise<RecordEventKnowledgeResult> {
  const newId = input.newId ?? (() => crypto.randomUUID());
  const recordedAt = input.recordedAt ?? new Date();
  const explanation = input.explanation;
  const event = input.event;
  const classification = input.classification;

  const eventRecordId = input.existingEventRecordId ?? newId();
  const classificationId = newId();
  const attributionId = newId();
  const confidenceId = newId();
  const explanationId = newId();
  const marketEventId = newId();
  const knowledgeEdgeId = newId();

  const windowStart = new Date(input.windowStartMs ?? recordedAt.getTime());
  const windowEnd = new Date(input.windowEndMs ?? recordedAt.getTime());

  if (!input.existingEventRecordId) {
    await insertEventRecordPostgres(ex, context, {
      id: eventRecordId,
      eventKey: event.eventKey,
      sourceRef: event.sourceRef,
      symbolScope: event.symbolScope,
      payloadJson: event.payloadJson,
      eventTime: new Date(event.eventTime),
      contentDigest: event.contentDigest,
      createdAt: recordedAt,
    });

    const classificationDigest = buildEventClassificationContentDigest({
      organizationId: context.organizationId,
      eventKey: event.eventKey,
      eventDigest: event.contentDigest,
      classificationKind: classification.classificationKind,
      ruleId: classification.ruleId,
    });

    await insertEventClassificationPostgres(ex, context, {
      id: classificationId,
      eventRecordId,
      classificationKind: classification.classificationKind,
      ruleId: classification.ruleId,
      confidence: classification.confidence,
      rationaleJson: JSON.stringify(classification.rationale),
      contentDigest: classificationDigest,
      createdAt: recordedAt,
    });
  }

  const attributionDigest = buildEventAttributionContentDigest({
    organizationId: context.organizationId,
    eventKey: event.eventKey,
    eventDigest: event.contentDigest,
    subjectRef: explanation.subjectRef,
    attributionStrength: explanation.breakdown.attributionStrength,
  });

  await insertEventAttributionPostgres(ex, context, {
    id: attributionId,
    eventRecordId,
    subjectRef: explanation.subjectRef,
    subjectKind: explanation.subjectKind,
    windowStart,
    windowEnd,
    attributionStrength: explanation.breakdown.attributionStrength,
    contentDigest: attributionDigest,
    createdAt: recordedAt,
  });

  const confidenceDigest = buildEventAttributionContentDigest({
    organizationId: context.organizationId,
    eventKey: event.eventKey,
    eventDigest: event.contentDigest,
    subjectRef: `${explanation.subjectRef}:confidence`,
    attributionStrength: explanation.scores.confidenceMean,
  });

  await insertEventAttributionConfidencePostgres(ex, context, {
    id: confidenceId,
    eventRecordId,
    subjectRef: explanation.subjectRef,
    confidenceMean: explanation.scores.confidenceMean,
    confidenceBandLow: explanation.scores.confidenceBandLow,
    confidenceBandHigh: explanation.scores.confidenceBandHigh,
    priorSupporting: explanation.scores.priorSupporting,
    priorContradicting: explanation.scores.priorContradicting,
    rationaleJson: JSON.stringify(explanation.scores.rationale),
    contentDigest: confidenceDigest,
    createdAt: recordedAt,
  });

  const explanationDigest = buildEventExplanationContentDigest({
    organizationId: context.organizationId,
    subjectRef: explanation.subjectRef,
    payload: explanation,
  });

  await insertEventExplanationPostgres(ex, context, {
    id: explanationId,
    subjectRef: explanation.subjectRef,
    priceMoveJson: JSON.stringify({
      symbol: explanation.symbol,
      regime: explanation.regime,
      outcomeTag: explanation.outcomeTag,
    }),
    eventRefsJson: JSON.stringify([{ eventKey: event.eventKey, eventDigest: event.contentDigest }]),
    patternRefsJson: JSON.stringify([]),
    scoreBreakdownJson: JSON.stringify({
      breakdown: explanation.breakdown,
      scores: explanation.scores,
    }),
    contentDigest: explanationDigest,
    createdAt: recordedAt,
  });

  const eventPayload = {
    schemaVersion: "event_attribution_observation_v1",
    eventKey: event.eventKey,
    eventDigest: event.contentDigest,
    classificationKind: classification.classificationKind,
    subjectRef: explanation.subjectRef,
    explanationDigest,
  };

  await insertMarketEventPostgres(ex, context, {
    id: marketEventId,
    eventKind: "event_attribution_observation",
    subjectRef: explanation.subjectRef,
    payloadJson: JSON.stringify(eventPayload),
    eventTime: recordedAt,
    confidence: explanation.scores.confidenceMean,
    contentDigest: explanationDigest,
    createdAt: recordedAt,
  });

  const fromRef = buildEventKnowledgeFromRef({
    eventKey: event.eventKey,
    eventDigest: event.contentDigest,
  });
  const toRef = resolveToRef(explanation);

  await insertKnowledgeEdgePostgres(ex, context, {
    id: knowledgeEdgeId,
    fromRef,
    toRef,
    relationKind: resolveRelationKind(explanation.subjectKind),
    confidence: explanation.scores.confidenceMean,
    strength: explanation.breakdown.attributionStrength,
    regimeScope: explanation.regime,
    failureCasesJson: "[]",
    verified: false,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  });

  return {
    eventRecordId,
    classificationId,
    attributionId,
    confidenceId,
    explanationId,
    marketEventId,
    knowledgeEdgeId,
  };
}
