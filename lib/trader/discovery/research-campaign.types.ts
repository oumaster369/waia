import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";

export const RESEARCH_CAMPAIGN_SCHEMA_VERSION =
  "waia.trader.discovery-research-campaign.v1" as const;

export const RESEARCH_CAMPAIGN_LIFECYCLE_STATES = [
  "PROPOSED",
  "ACTIVE",
  "PAUSED",
  "CONSOLIDATING",
  "CONSOLIDATED",
  "ARCHIVED",
] as const;

export type ResearchCampaignLifecycleState = (typeof RESEARCH_CAMPAIGN_LIFECYCLE_STATES)[number];

export type ResearchCampaignCharter = {
  campaignKey: string;
  name: string;
  researchProgram: string;
  description: string;
  symbolScope: string;
  datasetDigest: string | null;
};

export type ResearchCampaign = {
  schemaVersion: typeof RESEARCH_CAMPAIGN_SCHEMA_VERSION;
  id: string;
  organizationId: string;
  charter: ResearchCampaignCharter;
  currentState: ResearchCampaignLifecycleState;
  contentDigest: string;
  createdAt: string;
};

export type ResearchCampaignStateRecord = {
  id: string;
  organizationId: string;
  campaignId: string;
  priorState: ResearchCampaignLifecycleState | null;
  newState: ResearchCampaignLifecycleState;
  rationale: string;
  operatorAttestationDigest: string;
  contentDigest: string;
  createdAt: string;
};

export function toResearchCampaignRef(campaign: ResearchCampaign): ResearchCampaignRef {
  return {
    campaignId: campaign.id,
    campaignDigest: campaign.contentDigest,
    state: campaign.currentState,
  };
}
