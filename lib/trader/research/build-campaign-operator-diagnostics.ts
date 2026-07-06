import { createHash } from "node:crypto";

import type { CanonicalInventoryWalkResult } from "@/lib/trader/paper/derive-canonical-inventory";
import { INVENTORY_SEMANTICS_VERSION } from "@/lib/trader/paper/inventory-semantics";
import {
  CAMPAIGN_OPERATOR_DIAGNOSTICS_SCHEMA_VERSION,
  type CampaignOperatorDiagnostics,
  type CampaignOperatorDiagnosticsBody,
  type CampaignOperatorDiagnosticsInventorySnapshot,
} from "@/lib/trader/research/campaign-operator-diagnostics.types";

export type BuildCampaignOperatorDiagnosticsInput = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  outcomeKind: CampaignOperatorDiagnosticsBody["outcomeKind"];
  error?: unknown;
  inventory?: Pick<CanonicalInventoryWalkResult, "openQtyBySymbol"> | null;
  parityStatus?: CampaignOperatorDiagnosticsBody["parityStatus"];
  parityMessage?: string | null;
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
): CampaignOperatorDiagnosticsInventorySnapshot | null {
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

function resolveErrorFields(error: unknown | undefined): {
  errorName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
} {
  if (error === undefined || error === null) {
    return { errorName: null, errorMessage: null, errorStack: null };
  }
  return {
    errorName: error instanceof Error ? error.name : "Error",
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? (error.stack ?? null) : null,
  };
}

export function buildCampaignOperatorDiagnostics(
  input: BuildCampaignOperatorDiagnosticsInput,
): CampaignOperatorDiagnostics {
  const errorFields = resolveErrorFields(input.error);

  const recordBody: CampaignOperatorDiagnosticsBody = {
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    outcomeKind: input.outcomeKind,
    parityStatus: input.parityStatus ?? (input.outcomeKind === "crash" ? "not_checked" : "ok"),
    parityMessage: input.parityMessage ?? null,
    errorName: errorFields.errorName,
    errorMessage: errorFields.errorMessage,
    errorStack: errorFields.errorStack,
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
