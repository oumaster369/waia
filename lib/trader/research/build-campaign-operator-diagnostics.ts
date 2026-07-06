import { createHash } from "node:crypto";

import type { CanonicalInventoryWalkResult } from "@/lib/trader/paper/derive-canonical-inventory";
import { INVENTORY_SEMANTICS_VERSION } from "@/lib/trader/paper/inventory-semantics";
import {
  CAMPAIGN_OPERATOR_DIAGNOSTICS_SCHEMA_VERSION,
  type CampaignOperatorDiagnostics,
  type CampaignOperatorDiagnosticsBody,
} from "@/lib/trader/research/campaign-operator-diagnostics.types";

export type BuildCampaignOperatorDiagnosticsInput = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  error: unknown;
  inventory?: Pick<CanonicalInventoryWalkResult, "openQtyBySymbol"> | null;
  builderGitSha?: string | null;
  crashedAt?: string;
};

function canonicalJsonString(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Map) {
      return Object.fromEntries([...item.entries()].sort(([a], [b]) => a.localeCompare(b)));
    }
    return item;
  });
}

export function computeCampaignOperatorDiagnosticsDigest(
  body: CampaignOperatorDiagnosticsBody,
): string {
  return createHash("sha256").update(canonicalJsonString(body), "utf8").digest("hex");
}

function resolveInventorySnapshot(
  inventory: Pick<CanonicalInventoryWalkResult, "openQtyBySymbol"> | null | undefined,
): CampaignOperatorDiagnostics["recordBody"]["inventorySnapshot"] {
  if (!inventory) {
    return null;
  }
  return {
    semanticsVersion: INVENTORY_SEMANTICS_VERSION,
    openQtyBySymbol: Object.fromEntries(
      [...inventory.openQtyBySymbol.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

export function buildCampaignOperatorDiagnostics(
  input: BuildCampaignOperatorDiagnosticsInput,
): CampaignOperatorDiagnostics {
  const err = input.error;
  const errorName = err instanceof Error ? err.name : "Error";
  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorStack = err instanceof Error ? (err.stack ?? null) : null;

  const recordBody: CampaignOperatorDiagnosticsBody = {
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    errorName,
    errorMessage,
    errorStack,
    inventorySemanticsVersion: INVENTORY_SEMANTICS_VERSION,
    inventorySnapshot: resolveInventorySnapshot(input.inventory),
    builderGitSha: input.builderGitSha ?? null,
    crashedAt: input.crashedAt ?? new Date().toISOString(),
  };

  return {
    schemaVersion: CAMPAIGN_OPERATOR_DIAGNOSTICS_SCHEMA_VERSION,
    envelope: { contentDigest: computeCampaignOperatorDiagnosticsDigest(recordBody) },
    recordBody,
  };
}

export function serializeCampaignOperatorDiagnostics(
  diagnostics: CampaignOperatorDiagnostics,
): string {
  return `${JSON.stringify(diagnostics, null, 2)}\n`;
}
