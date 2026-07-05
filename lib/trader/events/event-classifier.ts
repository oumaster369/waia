import {
  EVENT_CLASSIFICATION_RULE_IDS,
  eventClassificationKinds,
  type EventClassificationKind,
} from "@/lib/trader/events/event-classification-kinds";
import type {
  EventAttributionFeatureSnapshot,
  EventClassificationResult,
  NormalizedEventRecord,
} from "@/lib/trader/events/event-attribution.types";
import { parseExternalEventMetadata } from "@/lib/trader/events/event-normalizer";
import {
  compareDecimal,
  divideDecimal,
  formatDecimal,
  parseDecimal,
} from "@/lib/trader/risk/numeric";

const CLASSIFICATION_CONFIDENCE = "0.8500";

function clampConfidence(value: string): string {
  if (compareDecimal(value, "0") < 0) {
    return "0";
  }
  if (compareDecimal(value, "1") > 0) {
    return "1";
  }
  return value;
}

function mapKindHint(raw: string): EventClassificationKind | null {
  const normalized = raw.trim().toLowerCase().replace(/-/g, "_");
  const values = Object.values(eventClassificationKinds);
  return values.includes(normalized as EventClassificationKind)
    ? (normalized as EventClassificationKind)
    : null;
}

function volatilityPhysicsConfidence(features: EventAttributionFeatureSnapshot | null): string {
  if (!features) {
    return "0.5000";
  }
  const ratio = divideDecimal(features.realizedVol20, "1.0");
  return clampConfidence(formatDecimal(parseDecimal(ratio)));
}

export function classifyEventDeterministic(input: {
  event: NormalizedEventRecord;
  features?: EventAttributionFeatureSnapshot | null;
}): EventClassificationResult {
  const metadata = parseExternalEventMetadata(input.event);
  const kindHint = typeof metadata.kindHint === "string" ? mapKindHint(metadata.kindHint) : null;

  if (kindHint) {
    return {
      classificationKind: kindHint,
      ruleId: EVENT_CLASSIFICATION_RULE_IDS.metadataKindHint,
      confidence: CLASSIFICATION_CONFIDENCE,
      rationale: [`metadata_kind_hint=${kindHint}`],
    };
  }

  if (metadata.listingAction === "list") {
    return {
      classificationKind: eventClassificationKinds.listing,
      ruleId: EVENT_CLASSIFICATION_RULE_IDS.listingMetadata,
      confidence: CLASSIFICATION_CONFIDENCE,
      rationale: ["metadata_listing_action=list"],
    };
  }

  if (metadata.listingAction === "delist") {
    return {
      classificationKind: eventClassificationKinds.delisting,
      ruleId: EVENT_CLASSIFICATION_RULE_IDS.listingMetadata,
      confidence: CLASSIFICATION_CONFIDENCE,
      rationale: ["metadata_listing_action=delist"],
    };
  }

  if (metadata.exchangeOutage === true) {
    return {
      classificationKind: eventClassificationKinds.exchangeOutage,
      ruleId: EVENT_CLASSIFICATION_RULE_IDS.exchangeOutageMetadata,
      confidence: CLASSIFICATION_CONFIDENCE,
      rationale: ["metadata_exchange_outage=true"],
    };
  }

  if (metadata.releaseKind === "economic") {
    return {
      classificationKind: eventClassificationKinds.scheduledEconomicRelease,
      ruleId: EVENT_CLASSIFICATION_RULE_IDS.economicReleaseMetadata,
      confidence: CLASSIFICATION_CONFIDENCE,
      rationale: ["metadata_release_kind=economic"],
    };
  }

  if (input.features && compareDecimal(input.features.realizedVol20, "1.0") >= 0) {
    return {
      classificationKind: eventClassificationKinds.volatilitySpike,
      ruleId: EVENT_CLASSIFICATION_RULE_IDS.volatilityPhysics,
      confidence: volatilityPhysicsConfidence(input.features),
      rationale: ["physics_realized_vol20_threshold_met"],
    };
  }

  return {
    classificationKind: eventClassificationKinds.unknownExternal,
    ruleId: EVENT_CLASSIFICATION_RULE_IDS.unknownFallback,
    confidence: "0.3000",
    rationale: ["unknown_external_fallback"],
  };
}
