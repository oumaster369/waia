import { describe, expect, it } from "vitest";

import {
  applyCampaignSuffixToStrategyVersion,
  M9CandidateConflictError,
} from "@/lib/trader/research/m9-candidate-preflight";
import {
  assertM9BlindAuthorization,
  assertM9BlindAuthorizationV2,
  assertM9CampaignAuthorization,
  buildM9BlindAuthorizationScope,
  computeM9BlindAuthorizationDigest,
  computeM9CampaignAuthorizationDigest,
  isM9BlindAuthorizationScopeV2,
  M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE,
} from "@/lib/trader/research/m9-operator-authorization";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";

const CAMPAIGN_SCOPE = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  strategyId: "mean_reversion_v0",
  strategyVersion: "0.2.0+m9-20260705",
  symbol: "BTC/USDT",
  interval: "1m",
  vaultDir: "replay-runs/RI-P7/m9-v2-research-campaign-org0",
  metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  campaignSuffix: "m9-20260705",
};

describe("M9 candidate preflight helpers", () => {
  it("applies campaign suffix to strategy version", () => {
    expect(applyCampaignSuffixToStrategyVersion("0.1.0", "m9-test")).toBe("0.1.0+m9-test");
    expect(applyCampaignSuffixToStrategyVersion("0.1.0", undefined)).toBe("0.1.0");
  });

  it("exposes conflict error code", () => {
    const error = new M9CandidateConflictError({
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      candidateId: "cand-1",
      status: "registered",
    });
    expect(error.code).toBe("M9_CANDIDATE_CONFLICT");
  });
});

describe("M9 operator authorization digests", () => {
  it("computes stable campaign digest", () => {
    const digest = computeM9CampaignAuthorizationDigest(CAMPAIGN_SCOPE);
    expect(digest).toHaveLength(64);
    expect(digest).toBe(computeM9CampaignAuthorizationDigest(CAMPAIGN_SCOPE));
  });

  it("accepts matching campaign authorization digest", () => {
    const digest = computeM9CampaignAuthorizationDigest(CAMPAIGN_SCOPE);
    expect(() => assertM9CampaignAuthorization(digest, CAMPAIGN_SCOPE)).not.toThrow();
  });

  it("rejects mismatched campaign authorization digest", () => {
    expect(() => assertM9CampaignAuthorization("deadbeef", CAMPAIGN_SCOPE)).toThrow(
      /campaign authorization digest mismatch/,
    );
  });

  it("accepts matching blind authorization digest (legacy v1 scope)", () => {
    const blindScope = { ...CAMPAIGN_SCOPE, datasetName: "m9-v2-research-campaign-org0" };
    const digest = computeM9BlindAuthorizationDigest(blindScope);
    expect(() => assertM9BlindAuthorization(digest, blindScope)).not.toThrow();
  });
});

describe("M9 content-bound blind authorization scope (DEE-398 / ADR-0022)", () => {
  const BASE_BLIND_INPUT = {
    campaignScope: CAMPAIGN_SCOPE,
    datasetName: "m9-v2-research-campaign-org0",
    blindDigest: "blind-digest-a".padEnd(64, "0"),
  };

  it("normalizes null sidecarContentDigest to the sentinel", () => {
    const scope = buildM9BlindAuthorizationScope({
      ...BASE_BLIND_INPUT,
      sidecarContentDigest: null,
    });
    expect(scope.sidecarContentDigest).toBe(M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE);
  });

  it("normalizes absent sidecarContentDigest to the sentinel", () => {
    const scope = buildM9BlindAuthorizationScope(BASE_BLIND_INPUT);
    expect(scope.sidecarContentDigest).toBe(M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE);
  });

  it("produces an identical digest for null vs absent sidecarContentDigest (no divergence)", () => {
    const withNull = buildM9BlindAuthorizationScope({
      ...BASE_BLIND_INPUT,
      sidecarContentDigest: null,
    });
    const withAbsent = buildM9BlindAuthorizationScope(BASE_BLIND_INPUT);
    expect(computeM9BlindAuthorizationDigest(withNull)).toBe(
      computeM9BlindAuthorizationDigest(withAbsent),
    );
  });

  it("is stable for an identical content scope", () => {
    const scope = buildM9BlindAuthorizationScope({
      ...BASE_BLIND_INPUT,
      sidecarContentDigest: "sidecar-digest-a",
    });
    expect(computeM9BlindAuthorizationDigest(scope)).toBe(computeM9BlindAuthorizationDigest(scope));
  });

  it("changes the digest when blindDigest changes", () => {
    const scopeA = buildM9BlindAuthorizationScope(BASE_BLIND_INPUT);
    const scopeB = buildM9BlindAuthorizationScope({
      ...BASE_BLIND_INPUT,
      blindDigest: "blind-digest-b".padEnd(64, "0"),
    });
    expect(computeM9BlindAuthorizationDigest(scopeA)).not.toBe(
      computeM9BlindAuthorizationDigest(scopeB),
    );
  });

  it("changes the digest when sidecarContentDigest changes", () => {
    const scopeA = buildM9BlindAuthorizationScope({
      ...BASE_BLIND_INPUT,
      sidecarContentDigest: "sidecar-digest-a",
    });
    const scopeB = buildM9BlindAuthorizationScope({
      ...BASE_BLIND_INPUT,
      sidecarContentDigest: "sidecar-digest-b",
    });
    expect(computeM9BlindAuthorizationDigest(scopeA)).not.toBe(
      computeM9BlindAuthorizationDigest(scopeB),
    );
  });

  it("marks a built scope as v2 (content-bound)", () => {
    const scope = buildM9BlindAuthorizationScope(BASE_BLIND_INPUT);
    expect(isM9BlindAuthorizationScopeV2(scope)).toBe(true);
  });

  it("does not mark a legacy v1 scope (no blindDigest) as v2", () => {
    const legacyScope = { ...CAMPAIGN_SCOPE, datasetName: "m9-v2-research-campaign-org0" };
    expect(isM9BlindAuthorizationScopeV2(legacyScope)).toBe(false);
  });

  it("assertM9BlindAuthorizationV2 accepts a valid content-bound scope", () => {
    const scope = buildM9BlindAuthorizationScope(BASE_BLIND_INPUT);
    const digest = computeM9BlindAuthorizationDigest(scope);
    expect(() => assertM9BlindAuthorizationV2(digest, scope)).not.toThrow();
  });

  it("assertM9BlindAuthorizationV2 rejects an incomplete v1 scope — no silent acceptance", () => {
    const legacyScope = { ...CAMPAIGN_SCOPE, datasetName: "m9-v2-research-campaign-org0" };
    const digest = computeM9BlindAuthorizationDigest(legacyScope);
    expect(() => assertM9BlindAuthorizationV2(digest, legacyScope)).toThrow(
      /missing content-bound fields/,
    );
  });

  it("assertM9BlindAuthorizationV2 rejects a mismatched digest even with a v2 scope", () => {
    const scope = buildM9BlindAuthorizationScope(BASE_BLIND_INPUT);
    expect(() => assertM9BlindAuthorizationV2("deadbeef", scope)).toThrow(
      /blind authorization digest mismatch/,
    );
  });

  it("keeps datasetName as provenance only — changing it does not change blindDigest binding semantics", () => {
    const scopeA = buildM9BlindAuthorizationScope(BASE_BLIND_INPUT);
    const scopeB = buildM9BlindAuthorizationScope({
      ...BASE_BLIND_INPUT,
      datasetName: "other-name",
    });
    // Still both valid, distinct scopes (datasetName is part of the hashed payload for
    // provenance/audit purposes) but blindDigest — the integrity anchor — is unchanged.
    expect(scopeA.blindDigest).toBe(scopeB.blindDigest);
    expect(computeM9BlindAuthorizationDigest(scopeA)).not.toBe(
      computeM9BlindAuthorizationDigest(scopeB),
    );
  });
});
