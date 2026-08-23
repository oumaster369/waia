import type { NormalizedObservationKind } from "@/lib/trader/market-data/observation-types";

export const CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION =
  "mi-canonical-pit-observation-v1" as const;
export const CANONICAL_GATEWAY_RECEIPT_SCHEMA_VERSION =
  "mi-canonical-gateway-receipt-v1" as const;

export const CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1 = [
  "msv_envelope",
  "ohlcv_bar",
  "quote_l1",
  "order_book_snapshot",
  "market_trades_snapshot",
  "fear_greed_index",
  "news_headline",
] as const;

export type CanonicalPrimitiveObservationKindV1 =
  (typeof CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1)[number];

export const CANONICAL_EXTERNAL_OBSERVATION_KINDS_V1 = [
  "ohlcv_bar",
  "quote_l1",
  "order_book_snapshot",
  "market_trades_snapshot",
  "fear_greed_index",
  "news_headline",
] as const satisfies readonly NormalizedObservationKind[];

export type CanonicalExternalObservationKindV1 =
  (typeof CANONICAL_EXTERNAL_OBSERVATION_KINDS_V1)[number];

export const EXCLUDED_UNMODELED_GATEWAY_KINDS_V1 = [
  "global_market_stats",
  "cross_exchange_confirmation",
  "macro_series",
  "macro_calendar_event",
  "macro_probability",
  "news_event_cluster",
  "exchange_announcement",
  "protocol_release",
  "blockchain_network_stats",
  "regulatory_filing",
  "mempool_stats",
] as const satisfies readonly NormalizedObservationKind[];

export type ExcludedUnmodeledGatewayKindV1 =
  (typeof EXCLUDED_UNMODELED_GATEWAY_KINDS_V1)[number];

export const DOWNSTREAM_MEASUREMENT_CATEGORIES_V1 = [
  "cross_exchange_confirmation",
  "news_event_cluster",
] as const;

export type DownstreamMeasurementCategoryV1 =
  (typeof DOWNSTREAM_MEASUREMENT_CATEGORIES_V1)[number];

export type GatewayPrimitiveDispositionV1 =
  | {
      disposition: "ADMITTED_PRIMITIVE";
      observationKind: CanonicalExternalObservationKindV1;
      downstreamMeasurementCategory: null;
    }
  | {
      disposition: "EXCLUDED_UNMODELED";
      observationKind: null;
      downstreamMeasurementCategory: DownstreamMeasurementCategoryV1 | null;
    };

export const GATEWAY_PRIMITIVE_DISPOSITION_V1 = {
  ohlcv_bar: {
    disposition: "ADMITTED_PRIMITIVE",
    observationKind: "ohlcv_bar",
    downstreamMeasurementCategory: null,
  },
  quote_l1: {
    disposition: "ADMITTED_PRIMITIVE",
    observationKind: "quote_l1",
    downstreamMeasurementCategory: null,
  },
  order_book_snapshot: {
    disposition: "ADMITTED_PRIMITIVE",
    observationKind: "order_book_snapshot",
    downstreamMeasurementCategory: null,
  },
  market_trades_snapshot: {
    disposition: "ADMITTED_PRIMITIVE",
    observationKind: "market_trades_snapshot",
    downstreamMeasurementCategory: null,
  },
  fear_greed_index: {
    disposition: "ADMITTED_PRIMITIVE",
    observationKind: "fear_greed_index",
    downstreamMeasurementCategory: null,
  },
  news_headline: {
    disposition: "ADMITTED_PRIMITIVE",
    observationKind: "news_headline",
    downstreamMeasurementCategory: null,
  },
  global_market_stats: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: null,
  },
  cross_exchange_confirmation: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: "cross_exchange_confirmation",
  },
  macro_series: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: null,
  },
  macro_calendar_event: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: null,
  },
  macro_probability: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: null,
  },
  news_event_cluster: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: "news_event_cluster",
  },
  exchange_announcement: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: null,
  },
  protocol_release: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: null,
  },
  blockchain_network_stats: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: null,
  },
  regulatory_filing: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: null,
  },
  mempool_stats: {
    disposition: "EXCLUDED_UNMODELED",
    observationKind: null,
    downstreamMeasurementCategory: null,
  },
} as const satisfies Record<NormalizedObservationKind, GatewayPrimitiveDispositionV1>;

export type CanonicalGatewayAvailabilityV1 = "AVAILABLE" | "UNAVAILABLE" | "REJECTED";

export type CanonicalGatewayRejectionReasonV1 =
  | "EXCLUDED_UNMODELED"
  | "INVALID_SCHEMA_VERSION"
  | "INVALID_PROVENANCE"
  | "PROVIDER_KIND_MISMATCH"
  | "INVALID_CHRONOLOGY"
  | "INVALID_RELIABILITY_METADATA"
  | "INVALID_PAYLOAD"
  | "SOURCE_UNAVAILABLE"
  | "STALE_INPUT"
  | "TRUST_AS_OF_UNKNOWN";

export type CanonicalSourceLogicalIdentityV1 = {
  providerId: string;
  venue: string;
  feedKind: CanonicalExternalObservationKindV1;
  symbol: string | null;
};

export function isCanonicalExternalObservationKindV1(
  value: NormalizedObservationKind,
): value is CanonicalExternalObservationKindV1 {
  return (CANONICAL_EXTERNAL_OBSERVATION_KINDS_V1 as readonly string[]).includes(value);
}
