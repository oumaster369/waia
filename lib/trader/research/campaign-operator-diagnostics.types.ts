import { INVENTORY_SEMANTICS_VERSION } from "@/lib/trader/paper/inventory-semantics";

export const CAMPAIGN_OPERATOR_DIAGNOSTICS_SCHEMA_VERSION =
  "waia.trader.campaign-operator-diagnostics.v1" as const;

export type CampaignOperatorDiagnosticsInventorySnapshot = {
  semanticsVersion: typeof INVENTORY_SEMANTICS_VERSION;
  openQtyBySymbol: Record<string, string>;
};

export type CampaignOperatorDiagnosticsBody = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  errorName: string;
  errorMessage: string;
  errorStack: string | null;
  inventorySemanticsVersion: typeof INVENTORY_SEMANTICS_VERSION;
  inventorySnapshot: CampaignOperatorDiagnosticsInventorySnapshot | null;
  builderGitSha: string | null;
  crashedAt: string;
};

export type CampaignOperatorDiagnostics = {
  schemaVersion: typeof CAMPAIGN_OPERATOR_DIAGNOSTICS_SCHEMA_VERSION;
  envelope: {
    contentDigest: string;
  };
  recordBody: CampaignOperatorDiagnosticsBody;
};
