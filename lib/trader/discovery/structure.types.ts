import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";
import type { ObservationRecord } from "@/lib/trader/discovery/observation.types";

/** Immutable legacy artifact version. New clusters use the V2 constant. */
export const STRUCTURE_CLUSTER_SCHEMA_VERSION =
  "waia.trader.discovery-structure-cluster.v1" as const;

export const STRUCTURE_CLUSTER_SCHEMA_VERSION_V1 = STRUCTURE_CLUSTER_SCHEMA_VERSION;

export const STRUCTURE_CLUSTER_SCHEMA_VERSION_V2 =
  "waia.trader.discovery-structure-cluster.v2" as const;

export const TRADE_REFERENCE_COUNT_METRIC = "trade_reference_count" as const;

export const MEASURED_VOLATILITY_UNAVAILABLE = "unavailable" as const;

/** Original descriptive cutpoints: <=1, <=5, >5. Labels name the count, not volatility. */
export const TRADE_REFERENCE_COUNT_BAND = {
  le1: "trade_ref_count_le_1",
  from2To5: "trade_ref_count_2_to_5",
  gt5: "trade_ref_count_gt_5",
} as const;

export type TradeReferenceCountBand =
  (typeof TRADE_REFERENCE_COUNT_BAND)[keyof typeof TRADE_REFERENCE_COUNT_BAND];

export type StructureSignatureV1 = {
  /** Deterministic regime × volatility-bucket key. Legacy bytes only. */
  signatureKey: string;
  regimeLabel: string;
  volBucket: "low" | "medium" | "high";
  tradeCount: number;
  observationCount: number;
};

/** Legacy descriptive cluster. Do not emit, rewrite, or reinterpret as V2. */
export type StructureClusterV1 = {
  schemaVersion: typeof STRUCTURE_CLUSTER_SCHEMA_VERSION_V1;
  clusterId: string;
  campaignRef: ResearchCampaignRef;
  signature: StructureSignatureV1;
  memberObservationRefs: readonly string[];
  contentDigest: string;
  createdAt: string;
};

export type StructureSignatureV2 = {
  /** Versioned regime × trade-reference-count-band key. */
  signatureKey: string;
  regimeLabel: string;
  metric: typeof TRADE_REFERENCE_COUNT_METRIC;
  tradeReferenceCountBand: TradeReferenceCountBand;
  measuredVolatility: typeof MEASURED_VOLATILITY_UNAVAILABLE;
  tradeCount: number;
  observationCount: number;
};

export type StructureClusterV2 = {
  schemaVersion: typeof STRUCTURE_CLUSTER_SCHEMA_VERSION_V2;
  clusterId: string;
  campaignRef: ResearchCampaignRef;
  signature: StructureSignatureV2;
  memberObservationRefs: readonly string[];
  contentDigest: string;
  createdAt: string;
};

/** Newly produced descriptive clusters. */
export type StructureCluster = StructureClusterV2;

export type StructureClustererInput = {
  campaignRef: ResearchCampaignRef;
  observations: readonly ObservationRecord[];
};
