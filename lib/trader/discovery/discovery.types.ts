import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export const DISCOVERY_SCHEMA_VERSION = "waia.trader.discovery.v1" as const;

export type DiscoverySchemaVersion = typeof DISCOVERY_SCHEMA_VERSION;

/** Default-off posture — discovery runs require explicit operator authorization. */
export type DiscoveryRunConfig = {
  enabled: boolean;
  campaignId?: string;
  datasetDigest?: string;
  maxCandidatesPerRun?: number;
};

export const DEFAULT_DISCOVERY_RUN_CONFIG: DiscoveryRunConfig = {
  enabled: false,
  maxCandidatesPerRun: 1,
};

/** M6 descriptive reference — scores must not be used as weights (M6-M7 boundary). */
export type DescriptivePatternRef = {
  patternKey: string;
  definitionDigest: string;
  subjectRef: string;
  /** Descriptive co-occurrence tag only — not fitness. */
  outcomeTag?: "supporting" | "contradicting" | "neutral";
};

/** M7 descriptive reference — attribution consistency only — not P(profit). */
export type DescriptiveEventRef = {
  eventRecordId: string;
  eventKey: string;
  subjectRef: string;
  classificationKind: string;
};

export type ResearchCampaignRef = {
  campaignId: string;
  campaignDigest: string;
  state: "PROPOSED" | "ACTIVE" | "PAUSED" | "CONSOLIDATING" | "CONSOLIDATED" | "ARCHIVED";
};

export type DiscoveryRunContext = {
  schemaVersion: DiscoverySchemaVersion;
  config: DiscoveryRunConfig;
  context: OrgContext;
  campaignRef: ResearchCampaignRef;
  operatorAttestationDigest: string;
};
