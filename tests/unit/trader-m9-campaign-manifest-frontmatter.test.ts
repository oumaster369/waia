import { describe, expect, it } from "vitest";

import { buildCampaignRunFrontmatter } from "@/lib/trader/research/campaign-run-frontmatter";
import type { M9ResearchCampaignManifest } from "../../scripts/trader/m9-v2-research-campaign";

describe("m9 campaign manifest frontmatter", () => {
  it("includes additive provenance fields on manifest shape", () => {
    const manifest: M9ResearchCampaignManifest = {
      schemaVersion: "m9_v2_research_campaign_v1",
      campaignId: "m9-v2-test",
      generatedAt: "2026-07-10T12:00:00.000Z",
      frontmatter: buildCampaignRunFrontmatter({
        runId: "backtest-run-407",
        gitSha: "deadbeef",
        dbConnectionMode: "session",
      }),
      builderGitSha: "deadbeef",
      organizationId: "3c50b4e9-1138-43a5-a29f-e65088124cfc",
      symbol: "BTC/USDT",
      interval: "1m",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.7",
      metricsSchemaVersion: "2.0.0",
      oosBarCount: 20,
      vaultDir: "replay-runs/RI-P7/m9-v2-research-campaign-org0",
      promotionAttempted: false,
      enableGuardianExits: true,
      artifactPaths: {
        evidence: "m9-research-evidence.json",
        pka: "m9-production-knowledge-asset.json",
        metricsExport: "m9-v2-metrics-export.json",
        lifecycleTrace: "m9-lifecycle-trace.json",
        guardianSample: null,
        marketUnderstandingSample: null,
        providerSidecar: null,
        providerFusion: null,
        providerCoverageMatrix: null,
        decisionTrace: null,
        operatorAuthorization: "operator-authorization-record.json",
      },
      digests: {
        evidence: "a".repeat(64),
        pka: "b".repeat(64),
        metricsExport: null,
        lifecycleTrace: null,
        guardianSample: null,
        marketUnderstandingSample: null,
        providerSidecar: null,
        providerFusion: null,
        providerCoverageMatrix: null,
        decisionTrace: null,
        campaignAuthorization: "c".repeat(64),
        blindAuthorization: "d".repeat(64),
      },
      knowledgeId: null,
      regimeSatisfiesRequirement: null,
      note: "fixture",
    };

    expect(manifest.frontmatter.runId).toBe("backtest-run-407");
    expect(manifest.frontmatter.gitSha).toBe("deadbeef");
    expect(manifest.frontmatter.dbConnectionMode).toBe("session");
    expect(manifest.frontmatter.executionOrigin).toBeTruthy();
    expect(manifest.frontmatter.environment).toBeTruthy();
  });
});
