import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseM9Flags } from "@/lib/trader/research/m9-campaign-flags";
import {
  computeM9BlindAuthorizationDigest,
  computeM9CampaignAuthorizationDigest,
} from "@/lib/trader/research/m9-operator-authorization";
import { buildM9OperatorDigestScope } from "@/scripts/trader/m9-operator-digest";

describe("M9 operator digest scope builder", () => {
  it("builds default institutional campaign scope with absolute vaultDir", () => {
    const flags = parseM9Flags([
      "--verify-scope",
      "--strategy-version=0.1.1",
      "--vault-dir=./replay-runs/RI-P7/m9-v2-research-campaign-org0",
    ]);
    const { campaignScope, blindScope } = buildM9OperatorDigestScope(flags);

    expect(campaignScope.strategyVersion).toBe("0.1.1");
    expect(campaignScope.metricsSchemaVersion).toBe("2.0.0");
    expect(campaignScope.vaultDir).toBe(
      resolve("./replay-runs/RI-P7/m9-v2-research-campaign-org0"),
    );
    expect(blindScope.datasetName).toBe("m9-v2-research-campaign-org0");
  });

  it("produces stable digests for fixed scope", () => {
    const flags = parseM9Flags([
      "--org-id=00000000-0000-4000-8000-000000000001",
      "--strategy-version=0.1.1",
      "--vault-dir=replay-runs/RI-P7/m9-v2-research-campaign-org0",
    ]);
    const { campaignScope, blindScope } = buildM9OperatorDigestScope(flags);
    const campaignDigest = computeM9CampaignAuthorizationDigest(campaignScope);
    const blindDigest = computeM9BlindAuthorizationDigest(blindScope);

    expect(campaignDigest).toHaveLength(64);
    expect(blindDigest).toHaveLength(64);
    expect(campaignDigest).toBe(computeM9CampaignAuthorizationDigest(campaignScope));
    expect(blindDigest).toBe(computeM9BlindAuthorizationDigest(blindScope));
  });
});
