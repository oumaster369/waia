import { INVENTORY_SEMANTICS_VERSION } from "@/lib/trader/paper/inventory-semantics";

export const CAMPAIGN_OPERATOR_DIAGNOSTICS_SCHEMA_VERSION =
  "waia.trader.campaign-operator-diagnostics.v1" as const;

export type CampaignOperatorDiagnosticsInventorySnapshot = {
  semanticsVersion: typeof INVENTORY_SEMANTICS_VERSION;
  openQtyBySymbol: Record<string, string>;
};

export type CampaignOperatorDiagnosticsStreamingEvidence = {
  terminalState: string;
  chainDigest: string;
  expectedCycleCount: number;
  sealedThroughCycleIndex: number;
  runDir: string;
};

export type CampaignOperatorDiagnosticsBody = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  outcomeKind: "success" | "governed_reject" | "crash";
  parityStatus: "ok" | "not_checked" | "failed";
  parityMessage?: string | null;
  errorName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  inventorySemanticsVersion: typeof INVENTORY_SEMANTICS_VERSION;
  inventorySnapshot: CampaignOperatorDiagnosticsInventorySnapshot | null;
  builderGitSha: string | null;
  crashedAt: string;
  streamingEvidence?: CampaignOperatorDiagnosticsStreamingEvidence | null;
};

export type CampaignOperatorDiagnostics = {
  schemaVersion: typeof CAMPAIGN_OPERATOR_DIAGNOSTICS_SCHEMA_VERSION;
  envelope: {
    contentDigest: string;
  };
  recordBody: CampaignOperatorDiagnosticsBody;
};
