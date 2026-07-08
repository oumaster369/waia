import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

export const M9_OPERATOR_AUTHORIZATION_SCHEMA_VERSION = "m9_operator_authorization_v1";

/**
 * Sentinel used in place of `null`/absent when no provider sidecar is used for a run.
 * Eliminates the null-vs-absent digest divergence between the campaign script and the
 * operator digest helper (DEE-398 / ADR-0022): both callers must always pass a string.
 */
export const M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE = "none";

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

/**
 * Historical (pre-DEE-398) blind authorization scope. Binds only metadata/labels —
 * `datasetName` is a provenance label, not sealed replay content — and allows
 * `sidecarContentDigest` to be `null`, absent, or a real digest, which are three distinct
 * JSON shapes that hash differently. Retained only for backward compatibility with any
 * previously recorded v1 digests; new M9 v0.1.7+ runs must use
 * {@link M9BlindAuthorizationScopeV2} via {@link buildM9BlindAuthorizationScope}.
 */
export type M9BlindAuthorizationScopeV1 = M9CampaignAuthorizationScope & {
  datasetName: string;
  sidecarContentDigest?: string | null;
};

/**
 * Content-bound blind authorization scope (DEE-398 / ADR-0022). Binds the operator's
 * authorization to the actual sealed replay content that will execute:
 * - `blindDigest`: sealed blind-split bar-content digest (`research_dataset.blind_digest`),
 *   not just the dataset's label/name.
 * - `sidecarContentDigest`: always a string — real digest or the
 *   {@link M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE} sentinel — never `null`/absent, so the
 *   digest cannot diverge on that representation.
 *
 * `datasetName` remains present for provenance/auditability only; it is not the integrity
 * anchor — `blindDigest` is.
 */
export type M9BlindAuthorizationScopeV2 = M9CampaignAuthorizationScope & {
  datasetName: string;
  blindDigest: string;
  sidecarContentDigest: string;
};

export type M9BlindAuthorizationScope = M9BlindAuthorizationScopeV1 | M9BlindAuthorizationScopeV2;

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

/** True when `scope` carries the DEE-398 content-bound fields (`blindDigest`). */
export function isM9BlindAuthorizationScopeV2(
  scope: M9BlindAuthorizationScope,
): scope is M9BlindAuthorizationScopeV2 {
  return typeof (scope as Partial<M9BlindAuthorizationScopeV2>).blindDigest === "string";
}

/**
 * Single canonical builder for the blind authorization scope (DEE-398 / ADR-0022).
 * Both `scripts/trader/m9-operator-digest.ts` and `scripts/trader/m9-v2-research-campaign.ts`
 * must construct their blind scope through this function — no duplicated scope construction.
 * Normalizes `sidecarContentDigest` so `null`/absent/no-sidecar always hash identically.
 */
export function buildM9BlindAuthorizationScope(input: {
  campaignScope: M9CampaignAuthorizationScope;
  datasetName: string;
  blindDigest: string;
  sidecarContentDigest?: string | null;
}): M9BlindAuthorizationScopeV2 {
  const normalizedSidecarDigest = input.sidecarContentDigest?.trim()
    ? input.sidecarContentDigest.trim()
    : M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE;

  return {
    ...input.campaignScope,
    datasetName: input.datasetName,
    blindDigest: input.blindDigest,
    sidecarContentDigest: normalizedSidecarDigest,
  };
}

export function computeM9CampaignAuthorizationDigest(scope: M9CampaignAuthorizationScope): string {
  const payload = {
    kind: "m9_campaign_authorization_v1",
    ...scope,
  };
  return createHash("sha256").update(canonicalJsonString(payload), "utf8").digest("hex");
}

/**
 * Computes the blind authorization digest. Dispatches on scope shape: v2 (content-bound,
 * carries `blindDigest`) hashes under `kind: "m9_blind_authorization_v2"`; v1 (legacy,
 * metadata-only) hashes under the original `kind: "m9_blind_authorization_v1"` for backward
 * compatibility with previously recorded digests. New Repeat M9 v0.1.7 runs always produce a
 * v2 scope via {@link buildM9BlindAuthorizationScope}.
 */
export function computeM9BlindAuthorizationDigest(scope: M9BlindAuthorizationScope): string {
  const kind = isM9BlindAuthorizationScopeV2(scope)
    ? "m9_blind_authorization_v2"
    : "m9_blind_authorization_v1";
  const payload = {
    kind,
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

/**
 * Content-bound blind authorization assertion (DEE-398 / ADR-0022). Requires a v2 scope
 * (with `blindDigest`) — an incomplete v1 scope is never silently accepted for Repeat M9
 * v0.1.7+. Use this instead of {@link assertM9BlindAuthorization} on the M9 v0.1.7 run path.
 */
export function assertM9BlindAuthorizationV2(
  providedDigest: string,
  scope: M9BlindAuthorizationScope,
): asserts scope is M9BlindAuthorizationScopeV2 {
  if (!isM9BlindAuthorizationScopeV2(scope)) {
    throw new Error(
      "[m9] blind authorization scope is missing content-bound fields (blindDigest); " +
        "an incomplete v1 scope is not accepted for Repeat M9 v0.1.7 — build the scope with " +
        "buildM9BlindAuthorizationScope()",
    );
  }
  assertM9BlindAuthorization(providedDigest, scope);
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
