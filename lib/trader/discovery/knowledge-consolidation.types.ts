import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";

export const KNOWLEDGE_CONSOLIDATION_SCHEMA_VERSION =
  "waia.trader.discovery-knowledge-consolidation.v1" as const;

export type KnowledgeConsolidationAction =
  | "archive_hypothesis"
  | "retire_assumption"
  | "consolidate_duplicate"
  | "mark_campaign_consolidated";

export type ConsolidationRecord = {
  schemaVersion: typeof KNOWLEDGE_CONSOLIDATION_SCHEMA_VERSION;
  id: string;
  organizationId: string;
  campaignRef: ResearchCampaignRef;
  action: KnowledgeConsolidationAction;
  sourceRefs: readonly string[];
  canonicalRef: string | null;
  rationale: string;
  operatorAttestationDigest: string;
  contentDigest: string;
  createdAt: string;
};

export type AppendConsolidationRecordInput = {
  campaignRef: ResearchCampaignRef;
  action: KnowledgeConsolidationAction;
  sourceRefs: readonly string[];
  canonicalRef?: string | null;
  rationale: string;
  operatorAttestationDigest: string;
};
