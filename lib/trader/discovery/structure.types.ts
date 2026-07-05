import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";
import type { ObservationRecord } from "@/lib/trader/discovery/observation.types";

export const STRUCTURE_CLUSTER_SCHEMA_VERSION =
  "waia.trader.discovery-structure-cluster.v1" as const;

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

export type StructureClustererInput = {
  campaignRef: ResearchCampaignRef;
  observations: readonly ObservationRecord[];
};
