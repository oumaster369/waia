import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { classifyEventDeterministic } from "@/lib/trader/events/event-classifier";
import {
  createInitialEventAttributionConfidenceState,
  updateEventAttributionConfidenceState,
  type EventAttributionConfidenceState,
} from "@/lib/trader/events/event-attribution-confidence";
import { buildEventAttributionExplanationPayload } from "@/lib/trader/events/event-attribution-explanations";
import {
  computeBreakdownForSubject,
  extractEventAttributionSubjects,
  meetsEventAttributionThreshold,
} from "@/lib/trader/events/event-attribution-rules";
import {
  EVENT_ATTRIBUTION_SCHEMA_VERSION,
  type EventAttributionFeatureSnapshot,
  type EventAttributionPassResult,
  type NormalizedEventRecord,
  type OptionalPatternCoOccurrence,
} from "@/lib/trader/events/event-attribution.types";
import { recordEventKnowledgePostgres } from "@/lib/trader/knowledge/record-event-knowledge";
import type { PaperClosedTrade } from "@/lib/trader/paper/paper-strategy-eval.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type RunEventAttributionPassInput = {
  context: OrgContext;
  ex: PgWriteExecutor;
  events: readonly NormalizedEventRecord[];
  cycleResults: readonly PaperCycleResult[];
  closedTrades: readonly PaperClosedTrade[];
  patternMatches?: readonly OptionalPatternCoOccurrence[];
  newId?: () => string;
};

function featuresFromCycle(cycle: PaperCycleResult): EventAttributionFeatureSnapshot {
  return {
    close: cycle.evaluation.features.features.close,
    zscoreVsSma20: cycle.evaluation.msv.physics.zscoreVsSma20,
    realizedVol20: cycle.evaluation.msv.physics.realizedVol20,
    regime: cycle.evaluation.msv.derived.regime,
  };
}

function resolveCycleForTimestamp(
  cycleResults: readonly PaperCycleResult[],
  timestamp: Date,
): PaperCycleResult | null {
  if (cycleResults.length === 0) {
    return null;
  }
  const target = timestamp.getTime();
  let best = cycleResults[0]!;
  let bestDelta = Math.abs(new Date(best.evaluation.msv.evaluatedAt).getTime() - target);
  for (const cycle of cycleResults) {
    const delta = Math.abs(new Date(cycle.evaluation.msv.evaluatedAt).getTime() - target);
    if (delta <= bestDelta) {
      best = cycle;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Post-hoc event attribution pass — READ inputs, ANALYZE, STORE append-only artifacts.
 * Does not mutate cycle outputs, metrics, or execution semantics.
 */
export async function runEventAttributionPass(
  input: RunEventAttributionPassInput,
): Promise<EventAttributionPassResult> {
  const confidenceByEventSubject = new Map<string, EventAttributionConfidenceState>();
  let attributionsWritten = 0;
  let explanationRowsWritten = 0;
  let edgeRowsWritten = 0;

  for (const event of input.events) {
    const eventMs = new Date(event.eventTime).getTime();
    const cycle = resolveCycleForTimestamp(input.cycleResults, new Date(event.eventTime));
    const features = cycle ? featuresFromCycle(cycle) : null;
    const classification = classifyEventDeterministic({ event, features });

    const subjects = extractEventAttributionSubjects({
      event,
      classificationKind: classification.classificationKind,
      cycleResults: input.cycleResults,
      closedTrades: input.closedTrades,
      patternMatches: input.patternMatches,
    });

    let existingEventRecordId: string | undefined;

    for (const subject of subjects) {
      const breakdown = computeBreakdownForSubject({
        classificationKind: classification.classificationKind,
        eventMs,
        subject,
        features,
      });
      if (!meetsEventAttributionThreshold(breakdown.attributionStrength)) {
        continue;
      }

      const confidenceKey = `${event.eventKey}:${subject.subjectRef}`;
      const priorState =
        confidenceByEventSubject.get(confidenceKey) ??
        createInitialEventAttributionConfidenceState();
      const confidence = updateEventAttributionConfidenceState({
        state: priorState,
        outcomeTag: subject.outcomeTag,
      });
      confidenceByEventSubject.set(confidenceKey, confidence.state);

      const explanation = buildEventAttributionExplanationPayload({
        event,
        classification,
        subject,
        breakdown,
        scores: {
          attributionStrength: breakdown.attributionStrength,
          confidenceMean: confidence.confidenceMean,
          confidenceBandLow: confidence.confidenceBandLow,
          confidenceBandHigh: confidence.confidenceBandHigh,
          priorSupporting: confidence.state.priorSupporting,
          priorContradicting: confidence.state.priorContradicting,
          rationale: confidence.rationale,
        },
      });

      const result = await recordEventKnowledgePostgres(input.ex, input.context, {
        event,
        classification,
        explanation,
        recordedAt: new Date(event.eventTime),
        newId: input.newId,
        existingEventRecordId,
        windowStartMs: subject.windowStartMs,
        windowEndMs: subject.windowEndMs,
      });

      existingEventRecordId = result.eventRecordId;

      attributionsWritten += 1;
      explanationRowsWritten += 1;
      edgeRowsWritten += 1;
    }
  }

  return {
    schemaVersion: EVENT_ATTRIBUTION_SCHEMA_VERSION,
    eventsProcessed: input.events.length,
    attributionsWritten,
    explanationRowsWritten,
    edgeRowsWritten,
  };
}

export { extractEventAttributionSubjects };
