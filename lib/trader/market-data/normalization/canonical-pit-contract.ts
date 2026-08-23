import {
  GATEWAY_PRIMITIVE_DISPOSITION_V1,
  type CanonicalExternalObservationKindV1,
  type CanonicalGatewayRejectionReasonV1,
  type CanonicalSourceLogicalIdentityV1,
} from "@/lib/trader/mi/canonical-observation-v1";
import {
  OBSERVATION_SCHEMA_VERSION,
  type NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
import {
  getMarketDataProvider,
  isRegisteredMarketDataProvider,
} from "@/lib/trader/market-data/provider-registry";

export type CanonicalPrimitiveContractDecisionV1 =
  | {
      status: "AVAILABLE";
      kind: CanonicalExternalObservationKindV1;
      source: CanonicalSourceLogicalIdentityV1;
      reason: null;
    }
  | {
      status: "UNAVAILABLE" | "REJECTED";
      kind: CanonicalExternalObservationKindV1 | null;
      source: CanonicalSourceLogicalIdentityV1 | null;
      reason: CanonicalGatewayRejectionReasonV1;
    };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidIso(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function hasValidPayload(observation: NormalizedObservation): boolean {
  const payload = observation.payload;
  switch (observation.kind) {
    case "ohlcv_bar":
      return (
        Number.isSafeInteger(payload.barCount) &&
        Number(payload.barCount) > 0 &&
        isNonEmptyString(payload.latestClose) &&
        isValidIso(payload.latestBarCloseTime)
      );
    case "quote_l1":
      return (
        isNonEmptyString(payload.bid) &&
        isNonEmptyString(payload.ask) &&
        isNonEmptyString(payload.last) &&
        isValidIso(payload.timestamp)
      );
    case "order_book_snapshot":
      return (
        isNonEmptyString(payload.symbol) &&
        Number.isSafeInteger(payload.bidLevels) &&
        Number(payload.bidLevels) > 0 &&
        Number.isSafeInteger(payload.askLevels) &&
        Number(payload.askLevels) > 0 &&
        isFinitePositive(payload.bestBid) &&
        isFinitePositive(payload.bestAsk) &&
        isValidIso(payload.eventTimeUtc)
      );
    case "market_trades_snapshot":
      return (
        isNonEmptyString(payload.symbol) &&
        Number.isSafeInteger(payload.tradeCount) &&
        Number(payload.tradeCount) > 0 &&
        isFinitePositive(payload.latestPrice) &&
        isFinitePositive(payload.latestAmount) &&
        isValidIso(payload.eventTimeUtc)
      );
    case "fear_greed_index":
      return Number.isFinite(payload.value) && isNonEmptyString(payload.classification);
    case "news_headline":
      return (
        isNonEmptyString(payload.headline) &&
        isNonEmptyString(payload.url) &&
        isNonEmptyString(payload.source) &&
        (payload.publishedAt === undefined || isValidIso(payload.publishedAt))
      );
    default:
      return false;
  }
}

function mapSource(
  observation: NormalizedObservation,
  kind: CanonicalExternalObservationKindV1,
): CanonicalSourceLogicalIdentityV1 | null {
  const provenance = observation.provenance;
  if (
    !isNonEmptyString(provenance.venue) ||
    !isNonEmptyString(provenance.feedKind) ||
    !isNonEmptyString(provenance.symbol)
  ) {
    return null;
  }
  if (!isRegisteredMarketDataProvider(provenance.providerId)) {
    return null;
  }
  const provider = getMarketDataProvider(provenance.providerId);
  if (
    provider.venue !== provenance.venue ||
    provenance.feedKind !== kind ||
    !provider.kinds.includes(kind)
  ) {
    return null;
  }
  return {
    providerId: provenance.providerId,
    venue: provenance.venue,
    feedKind: kind,
    symbol: provenance.symbol,
  };
}

export function validateCanonicalPrimitiveContractV1(
  observation: NormalizedObservation,
): CanonicalPrimitiveContractDecisionV1 {
  const disposition = GATEWAY_PRIMITIVE_DISPOSITION_V1[observation.kind];
  if (disposition.disposition === "EXCLUDED_UNMODELED") {
    return { status: "REJECTED", kind: null, source: null, reason: "EXCLUDED_UNMODELED" };
  }

  const kind = disposition.observationKind;
  if (observation.schemaVersion !== OBSERVATION_SCHEMA_VERSION) {
    return { status: "REJECTED", kind, source: null, reason: "INVALID_SCHEMA_VERSION" };
  }

  const source = mapSource(observation, kind);
  if (!source) {
    return { status: "REJECTED", kind, source: null, reason: "PROVIDER_KIND_MISMATCH" };
  }

  if (
    !isValidIso(observation.provenance.eventTimeUtc) ||
    !isValidIso(observation.provenance.ingestTimeUtc)
  ) {
    return { status: "REJECTED", kind, source, reason: "INVALID_CHRONOLOGY" };
  }

  if (
    !isFiniteNonNegative(observation.freshnessMs) ||
    !isFiniteNonNegative(observation.latencyMs) ||
    typeof observation.confidence !== "number" ||
    !Number.isFinite(observation.confidence) ||
    observation.confidence < 0 ||
    observation.confidence > 1
  ) {
    return { status: "REJECTED", kind, source, reason: "INVALID_RELIABILITY_METADATA" };
  }

  if (observation.health === "UNAVAILABLE") {
    return { status: "UNAVAILABLE", kind, source, reason: "SOURCE_UNAVAILABLE" };
  }

  if (!hasValidPayload(observation)) {
    return { status: "REJECTED", kind, source, reason: "INVALID_PAYLOAD" };
  }

  return { status: "AVAILABLE", kind, source, reason: null };
}
