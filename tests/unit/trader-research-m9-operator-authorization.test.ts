import { describe, expect, it } from "vitest";

import {
  applyCampaignSuffixToStrategyVersion,
  M9CandidateConflictError,
} from "@/lib/trader/research/m9-candidate-preflight";
import {
  assertM9BlindAuthorization,
  assertM9CampaignAuthorization,
  computeM9BlindAuthorizationDigest,
  computeM9CampaignAuthorizationDigest,
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

  it("accepts matching blind authorization digest", () => {
    const blindScope = { ...CAMPAIGN_SCOPE, datasetName: "m9-v2-research-campaign-org0" };
    const digest = computeM9BlindAuthorizationDigest(blindScope);
    expect(() => assertM9BlindAuthorization(digest, blindScope)).not.toThrow();
  });
});
