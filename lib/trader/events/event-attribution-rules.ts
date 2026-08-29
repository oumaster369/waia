import { eventClassificationKinds } from "@/lib/trader/events/event-classification-kinds";
import type { EventClassificationKind } from "@/lib/trader/events/event-classification-kinds";
import type {
  EventAttributionFeatureSnapshot,
  EventAttributionOutcomeTag,
  EventAttributionScoreBreakdown,
  EventAttributionSubject,
  EventAttributionSubjectKind,
  NormalizedEventRecord,
  OptionalPatternCoOccurrence,
} from "@/lib/trader/events/event-attribution.types";
import type { PaperClosedTrade } from "@/lib/trader/paper/paper-strategy-eval.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import {
  compareDecimal,
  divideDecimal,
  formatDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export const EVENT_ATTRIBUTION_WINDOW_MS = 3_600_000;
export const EVENT_ATTRIBUTION_MIN_STRENGTH = "0.2500";

function clampStrength(value: string): string {
  if (compareDecimal(value, "0") < 0) {
    return "0";
  }
  if (compareDecimal(value, "1") > 0) {
    return "1";
  }
  return value;
}

function timeProximityComponent(eventMs: number, subjectMs: number, windowMs: number): string {
  const delta = Math.abs(eventMs - subjectMs);
  if (delta >= windowMs) {
    return "0";
  }
  const ratio = divideDecimal(String(windowMs - delta), String(windowMs));
  return clampStrength(ratio);
}

function physicsComponentForClassification(
  classificationKind: EventClassificationKind,
  features: EventAttributionFeatureSnapshot | null,
): string {
  if (!features) {
    return "0";
  }
  if (classificationKind === eventClassificationKinds.volatilitySpike) {
    return compareDecimal(features.priceDispersion20, "1.0") >= 0 ? "1" : "0";
  }
  if (classificationKind === eventClassificationKinds.liquidationCascade) {
    return compareDecimal(features.priceDispersion20, "0.8") >= 0 ? "1" : "0.5000";
  }
  return compareDecimal(features.priceDispersion20, "0") > 0 ? "0.5000" : "0.2500";
}

function metadataComponent(classificationKind: EventClassificationKind): string {
  if (classificationKind === eventClassificationKinds.unknownExternal) {
    return "0.2500";
  }
  return "0.7500";
}

export function computeEventAttributionBreakdown(input: {
  classificationKind: EventClassificationKind;
  eventMs: number;
  subjectMs: number;
  features: EventAttributionFeatureSnapshot | null;
}): EventAttributionScoreBreakdown {
  const timeProximity = timeProximityComponent(
    input.eventMs,
    input.subjectMs,
    EVENT_ATTRIBUTION_WINDOW_MS,
  );
  const physics = physicsComponentForClassification(input.classificationKind, input.features);
  const metadata = metadataComponent(input.classificationKind);

  const weighted =
    (parseDecimal(timeProximity) * 4n + parseDecimal(physics) * 4n + parseDecimal(metadata) * 2n) /
    10n;

  return {
    timeProximityComponent: timeProximity,
    physicsComponent: physics,
    metadataComponent: metadata,
    attributionStrength: clampStrength(formatDecimal(weighted)),
  };
}

export function meetsEventAttributionThreshold(attributionStrength: string): boolean {
  return compareDecimal(attributionStrength, EVENT_ATTRIBUTION_MIN_STRENGTH) >= 0;
}

/** Derive descriptive co-occurrence tag — never from PnL sign. */
export function deriveAttributionOutcomeTag(input: {
  classificationKind: EventClassificationKind;
  breakdown: EventAttributionScoreBreakdown;
}): EventAttributionOutcomeTag {
  if (!meetsEventAttributionThreshold(input.breakdown.attributionStrength)) {
    return "neutral";
  }

  const physicsMet =
    compareDecimal(input.breakdown.physicsComponent, "0.5000") >= 0 &&
    compareDecimal(input.breakdown.timeProximityComponent, "0.3000") >= 0;

  if (
    input.classificationKind === eventClassificationKinds.volatilitySpike ||
    input.classificationKind === eventClassificationKinds.liquidationCascade
  ) {
    return physicsMet ? "supporting" : "contradicting";
  }

  if (compareDecimal(input.breakdown.metadataComponent, "0.5000") >= 0) {
    return physicsMet ? "supporting" : "neutral";
  }

  return "neutral";
}

function featuresFromCycle(cycle: PaperCycleResult): EventAttributionFeatureSnapshot {
  return {
    close: cycle.evaluation.features.features.close,
    zscoreVsSma20: cycle.evaluation.msv.physics.zscoreVsSma20,
    priceDispersion20: cycle.evaluation.msv.physics.priceDispersion20,
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

export function buildPriceWindowSubjectRef(input: {
  symbol: string;
  windowStartMs: number;
  windowEndMs: number;
}): string {
  return `price_window:${input.symbol}:${input.windowStartMs}:${input.windowEndMs}`;
}

export function extractEventAttributionSubjects(input: {
  event: NormalizedEventRecord;
  classificationKind: EventClassificationKind;
  cycleResults: readonly PaperCycleResult[];
  closedTrades: readonly PaperClosedTrade[];
  patternMatches?: readonly OptionalPatternCoOccurrence[];
}): EventAttributionSubject[] {
  const eventMs = new Date(input.event.eventTime).getTime();
  const windowStartMs = eventMs;
  const windowEndMs = eventMs + EVENT_ATTRIBUTION_WINDOW_MS;
  const cycle = resolveCycleForTimestamp(input.cycleResults, new Date(input.event.eventTime));
  const features = cycle ? featuresFromCycle(cycle) : null;
  const regime = features?.regime ?? "RANGE";

  const priceBreakdown = computeEventAttributionBreakdown({
    classificationKind: input.classificationKind,
    eventMs,
    subjectMs: eventMs,
    features,
  });

  const subjects: EventAttributionSubject[] = [
    {
      kind: "price_window",
      subjectRef: buildPriceWindowSubjectRef({
        symbol: input.event.symbolScope,
        windowStartMs,
        windowEndMs,
      }),
      symbol: input.event.symbolScope,
      windowStartMs,
      windowEndMs,
      regime,
      outcomeTag: deriveAttributionOutcomeTag({
        classificationKind: input.classificationKind,
        breakdown: priceBreakdown,
      }),
    },
  ];

  for (const trade of input.closedTrades) {
    if (trade.symbol !== input.event.symbolScope) {
      continue;
    }
    const tradeMs = trade.executedAt.getTime();
    if (Math.abs(tradeMs - eventMs) > EVENT_ATTRIBUTION_WINDOW_MS) {
      continue;
    }
    const tradeCycle = resolveCycleForTimestamp(input.cycleResults, trade.executedAt);
    const tradeFeatures = tradeCycle ? featuresFromCycle(tradeCycle) : features;
    const breakdown = computeEventAttributionBreakdown({
      classificationKind: input.classificationKind,
      eventMs,
      subjectMs: tradeMs,
      features: tradeFeatures,
    });
    if (!meetsEventAttributionThreshold(breakdown.attributionStrength)) {
      continue;
    }
    subjects.push({
      kind: "close",
      subjectRef: `close:order:${trade.orderId}`,
      symbol: trade.symbol,
      windowStartMs: eventMs,
      windowEndMs: tradeMs,
      regime: tradeCycle?.evaluation.msv.derived.regime ?? regime,
      outcomeTag: deriveAttributionOutcomeTag({
        classificationKind: input.classificationKind,
        breakdown,
      }),
    });
  }

  for (const cycleResult of input.cycleResults) {
    for (const entry of cycleResult.strategyExecutions) {
      const rejected =
        entry.execution?.status === "risk_rejected" ||
        (entry.submitBlocked && entry.skipReason === "no_submit");
      if (!rejected || entry.signal.symbol !== input.event.symbolScope) {
        continue;
      }
      const subjectMs = new Date(cycleResult.evaluation.msv.evaluatedAt).getTime();
      if (Math.abs(subjectMs - eventMs) > EVENT_ATTRIBUTION_WINDOW_MS) {
        continue;
      }
      const breakdown = computeEventAttributionBreakdown({
        classificationKind: input.classificationKind,
        eventMs,
        subjectMs,
        features: featuresFromCycle(cycleResult),
      });
      if (!meetsEventAttributionThreshold(breakdown.attributionStrength)) {
        continue;
      }
      subjects.push({
        kind: "rejection",
        subjectRef: `signal:${entry.signal.strategySignalId}:rejected`,
        symbol: entry.signal.symbol,
        windowStartMs: eventMs,
        windowEndMs: subjectMs,
        regime: cycleResult.evaluation.msv.derived.regime,
        outcomeTag: deriveAttributionOutcomeTag({
          classificationKind: input.classificationKind,
          breakdown,
        }),
      });
    }
  }

  for (const pattern of input.patternMatches ?? []) {
    const breakdown = computeEventAttributionBreakdown({
      classificationKind: input.classificationKind,
      eventMs,
      subjectMs: eventMs,
      features,
    });
    if (!meetsEventAttributionThreshold(breakdown.attributionStrength)) {
      continue;
    }
    subjects.push({
      kind: "pattern",
      subjectRef: `pattern:${pattern.patternKey}@${pattern.definitionDigest}`,
      symbol: input.event.symbolScope,
      windowStartMs: eventMs,
      windowEndMs: windowEndMs,
      regime,
      outcomeTag: deriveAttributionOutcomeTag({
        classificationKind: input.classificationKind,
        breakdown,
      }),
    });
  }

  return subjects;
}

export function computeBreakdownForSubject(input: {
  classificationKind: EventClassificationKind;
  eventMs: number;
  subject: EventAttributionSubject;
  features: EventAttributionFeatureSnapshot | null;
}): EventAttributionScoreBreakdown {
  const subjectMs =
    input.subject.kind === "price_window" ? input.eventMs : input.subject.windowEndMs;
  return computeEventAttributionBreakdown({
    classificationKind: input.classificationKind,
    eventMs: input.eventMs,
    subjectMs,
    features: input.features,
  });
}
