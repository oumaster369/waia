import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";
import type { ObservationRecord } from "@/lib/trader/discovery/observation.types";

export const STRUCTURE_CLUSTER_SCHEMA_VERSION =
  "waia.trader.discovery-structure-cluster.v1" as const;

export const STRUCTURE_CLUSTER_V2_SCHEMA_VERSION =
  "waia.trader.discovery-structure-cluster.v2" as const;

export type StructureSignature = {
  /** Deterministic regime × volatility bucket key. */
  signatureKey: string;
  regimeLabel: string;
  volBucket: "low" | "medium" | "high";
  tradeCount: number;
  observationCount: number;
};

export type StructureCluster = {
  schemaVersion: typeof STRUCTURE_CLUSTER_SCHEMA_VERSION;
  clusterId: string;
  campaignRef: ResearchCampaignRef;
  signature: StructureSignature;
  memberObservationRefs: readonly string[];
  contentDigest: string;
  createdAt: string;
};

export type TradeReferenceCountBand = "low" | "medium" | "high";

export type MemberTradeReferenceCount = {
  observationRef: string;
  tradeReferenceCount: number;
};

export type StructureSignatureV2 = {
  signatureKey: string;
  regimeLabel: string;
  metricKind: "TRADE_REFERENCE_COUNT_BAND";
  tradeReferenceCountBand: TradeReferenceCountBand;
  measuredVolatilityStatus: "UNAVAILABLE";
  /** Aggregate references across all member observations; not the band input. */
  tradeCount: number;
  observationCount: number;
};

export type StructureClusterV2 = {
  schemaVersion: typeof STRUCTURE_CLUSTER_V2_SCHEMA_VERSION;
  clusterId: string;
  campaignRef: ResearchCampaignRef;
  signature: StructureSignatureV2;
  memberObservationRefs: readonly string[];
  /** Counts are aligned to the sorted memberObservationRefs array. */
  memberTradeReferenceCounts: readonly MemberTradeReferenceCount[];
  contentDigest: string;
  createdAt: string;
};

export type StructureClustererInput = {
  campaignRef: ResearchCampaignRef;
  observations: readonly ObservationRecord[];
};
