import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeSidecarContentDigest } from "@/lib/trader/market-data/replay/sidecar-content-digest";
import {
  loadM9ProviderSidecar,
  parseM9Flags,
  resolveM9ProviderSidecarPath,
} from "@/lib/trader/research/m9-campaign-flags";
import {
  buildM9BlindAuthorizationScope,
  computeM9BlindAuthorizationDigest,
  computeM9CampaignAuthorizationDigest,
  M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE,
} from "@/lib/trader/research/m9-operator-authorization";

const FIXED_BLIND_DIGEST = "a".repeat(64);

function resolveSidecarContentDigestForVault(
  flags: Map<string, string>,
  vaultDir: string,
): string | null {
  const providerSidecar = loadM9ProviderSidecar(resolveM9ProviderSidecarPath(flags, vaultDir));
  return providerSidecar ? computeSidecarContentDigest(providerSidecar) : null;
}

vi.mock("@/db/postgres-client", () => ({
  getPostgresDrizzle: () => ({}),
}));

vi.mock("@/lib/trader/research/m9-dataset-seal-preview", () => ({
  computeM9DatasetSealPreviewPostgres: vi.fn(async () => ({
    bars: [],
    splits: { train: [], validation: [], blind: [] },
    sealed: {
      trainBarCount: 10,
      validationBarCount: 4,
      blindBarCount: 4,
      trainDigest: "train-digest",
      validationDigest: "validation-digest",
      blindDigest: FIXED_BLIND_DIGEST,
      sealedAt: "2026-01-01T00:00:00.000Z",
    },
  })),
}));

describe("M9 operator digest scope builder (DEE-398 canonical builder)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds default institutional campaign scope with absolute vaultDir", async () => {
    const { buildM9OperatorDigestScope } = await import("@/scripts/trader/m9-operator-digest");
    const flags = parseM9Flags([
      "--verify-scope",
      "--strategy-version=0.1.1",
      "--vault-dir=./replay-runs/RI-P7/m9-v2-research-campaign-org0",
    ]);
    const { campaignScope, blindScope } = await buildM9OperatorDigestScope(flags);

    expect(campaignScope.strategyVersion).toBe("0.1.1");
    expect(campaignScope.metricsSchemaVersion).toBe("2.0.0");
    expect(campaignScope.vaultDir).toBe(
      resolve("./replay-runs/RI-P7/m9-v2-research-campaign-org0"),
    );
    expect(blindScope.datasetName).toBe("m9-v2-research-campaign-org0");
    expect(blindScope.blindDigest).toBe(FIXED_BLIND_DIGEST);
    expect(blindScope.sidecarContentDigest).toBe(
      resolveSidecarContentDigestForVault(flags, campaignScope.vaultDir) ??
        M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE,
    );
  });

  it("produces stable digests for fixed scope", async () => {
    const { buildM9OperatorDigestScope } = await import("@/scripts/trader/m9-operator-digest");
    const flags = parseM9Flags([
      "--org-id=00000000-0000-4000-8000-000000000001",
      "--strategy-version=0.1.1",
      "--vault-dir=replay-runs/RI-P7/m9-v2-research-campaign-org0",
    ]);
    const { campaignScope, blindScope } = await buildM9OperatorDigestScope(flags);
    const campaignDigest = computeM9CampaignAuthorizationDigest(campaignScope);
    const blindDigest = computeM9BlindAuthorizationDigest(blindScope);

    expect(campaignDigest).toHaveLength(64);
    expect(blindDigest).toHaveLength(64);
    expect(campaignDigest).toBe(computeM9CampaignAuthorizationDigest(campaignScope));
    expect(blindDigest).toBe(computeM9BlindAuthorizationDigest(blindScope));
  });

  it("uses the same canonical scope builder as the campaign script (no duplicated construction)", async () => {
    const { buildM9OperatorDigestScope } = await import("@/scripts/trader/m9-operator-digest");
    const flags = parseM9Flags([
      "--org-id=00000000-0000-4000-8000-000000000002",
      "--strategy-version=0.1.7",
      "--vault-dir=replay-runs/RI-P7/m9-v2-research-campaign-org0",
      "--dataset-name=m9-v2-research-campaign-org0",
    ]);
    const { campaignScope, blindScope } = await buildM9OperatorDigestScope(flags);

    // The campaign script builds its blind scope through the exact same
    // buildM9BlindAuthorizationScope() call with the same inputs — verify the digest helper's
    // output is indistinguishable from what the campaign would build for identical content.
    const campaignSideScope = buildM9BlindAuthorizationScope({
      campaignScope,
      datasetName: "m9-v2-research-campaign-org0",
      blindDigest: FIXED_BLIND_DIGEST,
      sidecarContentDigest: resolveSidecarContentDigestForVault(flags, campaignScope.vaultDir),
    });

    expect(blindScope).toEqual(campaignSideScope);
    expect(computeM9BlindAuthorizationDigest(blindScope)).toBe(
      computeM9BlindAuthorizationDigest(campaignSideScope),
    );
  });
});
