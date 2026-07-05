export const eventClassificationKinds = {
  macroEvent: "macro_event",
  exchangeOutage: "exchange_outage",
  listing: "listing",
  delisting: "delisting",
  fundingAnomaly: "funding_anomaly",
  liquidationCascade: "liquidation_cascade",
  volatilitySpike: "volatility_spike",
  scheduledEconomicRelease: "scheduled_economic_release",
  unknownExternal: "unknown_external",
} as const;

export type EventClassificationKind =
  (typeof eventClassificationKinds)[keyof typeof eventClassificationKinds];

export const EVENT_CLASSIFICATION_RULE_IDS = {
  metadataKindHint: "rule_metadata_kind_hint_v1",
  volatilityPhysics: "rule_volatility_physics_v1",
  listingMetadata: "rule_listing_metadata_v1",
  exchangeOutageMetadata: "rule_exchange_outage_metadata_v1",
  economicReleaseMetadata: "rule_economic_release_metadata_v1",
  unknownFallback: "rule_unknown_fallback_v1",
} as const;
