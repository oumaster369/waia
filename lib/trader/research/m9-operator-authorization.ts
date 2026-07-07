import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

export const M9_OPERATOR_AUTHORIZATION_SCHEMA_VERSION = "m9_operator_authorization_v1";

export type M9CampaignAuthorizationScope = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  symbol: string;
  interval: string;
  vaultDir: string;
  metricsSchemaVersion: string;
  campaignSuffix?: string;
};

export type M9BlindAuthorizationScope = M9CampaignAuthorizationScope & {
  datasetName: string;
  sidecarContentDigest?: string | null;
};

export type M9OperatorAuthorizationRecord = {
  schemaVersion: typeof M9_OPERATOR_AUTHORIZATION_SCHEMA_VERSION;
  generatedAt: string;
  organizationId: string;
  campaignAuthorizationDigest: string;
  blindAuthorizationDigest: string | null;
  campaignScope: M9CampaignAuthorizationScope;
  blindScope: M9BlindAuthorizationScope | null;
  operatorId: string | null;
  notes: string;
};

export function computeM9CampaignAuthorizationDigest(scope: M9CampaignAuthorizationScope): string {
  const payload = {
    kind: "m9_campaign_authorization_v1",
    ...scope,
  };
  return createHash("sha256").update(canonicalJsonString(payload), "utf8").digest("hex");
}

export function computeM9BlindAuthorizationDigest(scope: M9BlindAuthorizationScope): string {
  const payload = {
    kind: "m9_blind_authorization_v1",
    ...scope,
  };
  return createHash("sha256").update(canonicalJsonString(payload), "utf8").digest("hex");
}

export function assertM9CampaignAuthorization(
  providedDigest: string,
  scope: M9CampaignAuthorizationScope,
): void {
  const expected = computeM9CampaignAuthorizationDigest(scope);
  if (providedDigest.trim() !== expected) {
    throw new Error(
      `[m9] operator campaign authorization digest mismatch (expected ${expected.slice(0, 12)}…); ` +
        "recompute from campaign scope or obtain signed digest from operator",
    );
  }
}

export function assertM9BlindAuthorization(
  providedDigest: string,
  scope: M9BlindAuthorizationScope,
): void {
  const expected = computeM9BlindAuthorizationDigest(scope);
  if (providedDigest.trim() !== expected) {
    throw new Error(
      `[m9] operator blind authorization digest mismatch (expected ${expected.slice(0, 12)}…); ` +
        "blind holdout is single-use — obtain explicit operator authorization",
    );
  }
}

export function buildM9OperatorAuthorizationRecord(input: {
  campaignScope: M9CampaignAuthorizationScope;
  blindScope: M9BlindAuthorizationScope | null;
  campaignAuthorizationDigest: string;
  blindAuthorizationDigest: string | null;
  operatorId?: string | null;
  notes?: string;
  generatedAt?: string;
}): M9OperatorAuthorizationRecord {
  return {
    schemaVersion: M9_OPERATOR_AUTHORIZATION_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    organizationId: input.campaignScope.organizationId,
    campaignAuthorizationDigest: input.campaignAuthorizationDigest,
    blindAuthorizationDigest: input.blindAuthorizationDigest,
    campaignScope: input.campaignScope,
    blindScope: input.blindScope,
    operatorId: input.operatorId ?? null,
    notes:
      input.notes ??
      "Operator authorization record — campaign and blind digests verified at CLI preflight.",
  };
}
