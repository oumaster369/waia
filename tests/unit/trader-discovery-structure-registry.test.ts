import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { insertDiscoveryStructureClusterPostgres } from "@/lib/trader/discovery/discovery-registry-postgres";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { clusterStructureSignatures } from "@/lib/trader/discovery/structure-clusterer";
import type { InsertStructureClusterRow } from "@/lib/trader/discovery/discovery-record.types";
import type { ObservationRecord } from "@/lib/trader/discovery/observation.types";

const CAMPAIGN = {
  campaignId: "campaign-registry",
  campaignDigest: "a".repeat(64),
  state: "ACTIVE" as const,
};
const pgDialect = new PgDialect();

function observation(): ObservationRecord {
  return {
    schemaVersion: "waia.trader.discovery-observation.v1",
    observationId: "observation-registry",
    campaignRef: { ...CAMPAIGN },
    barWindow: {
      symbol: "BTCUSDT",
      interval: "1m",
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-01T00:02:00.000Z",
      barCount: 2,
    },
    observedRegimes: ["TREND"],
    tradeRefs: [
      {
        fillId: "fill-1",
        symbol: "BTCUSDT",
        executedAt: "2026-01-01T00:01:00.000Z",
        regimeLabel: "TREND",
      },
      {
        fillId: "fill-2",
        symbol: "BTCUSDT",
        executedAt: "2026-01-01T00:02:00.000Z",
        regimeLabel: "TREND",
      },
    ],
    patternRefs: [],
    eventRefs: [],
    contentDigest: "observation-digest",
    createdAt: "2026-01-01T00:03:00.000Z",
  };
}

function registryExecutor(
  organizationId = "org-registry",
  campaigns: Array<Record<string, unknown>> = [],
) {
  const inserted: Record<string, unknown>[] = [];
  let campaignReads = 0;
  let campaignWhereParams: unknown[] = [];
  const executor = {
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        inserted.push(value);
      },
    }),
    select: (projection?: unknown) => {
      if (projection) campaignReads += 1;
      return {
        from: () => ({
          where: (condition: unknown) => ({
            limit: async () => {
              if (projection) {
                campaignWhereParams = pgDialect.sqlToQuery(condition as SQL).params;
                return campaigns.filter(
                  (campaign) =>
                    campaign.id === CAMPAIGN.campaignId &&
                    campaign.organizationId === organizationId,
                );
              }
              return inserted;
            },
          }),
        }),
      };
    },
  };
  return {
    executor: executor as never,
    inserted,
    getCampaignReads: () => campaignReads,
    getCampaignWhereParams: () => campaignWhereParams,
  };
}

describe("discovery structure cluster append boundary", () => {
  it("appends a validated V2 cluster through the existing JSON payload table", async () => {
    const [cluster] = clusterStructureSignatures(
      { campaignRef: CAMPAIGN, observations: [observation()] },
      () => "cluster-registry",
      "2026-01-01T00:04:00.000Z",
    );
    const { executor, inserted, getCampaignReads, getCampaignWhereParams } = registryExecutor(
      "org-registry",
      [
        {
          id: CAMPAIGN.campaignId,
          organizationId: "org-registry",
          contentDigest: CAMPAIGN.campaignDigest,
          currentState: CAMPAIGN.state,
        },
      ],
    );

    await insertDiscoveryStructureClusterPostgres(
      executor,
      { organizationId: "org-registry" },
      { cluster },
    );

    expect(inserted).toHaveLength(1);
    expect(getCampaignReads()).toBe(1);
    expect(getCampaignWhereParams()).toEqual([CAMPAIGN.campaignId, "org-registry"]);
    expect(inserted[0]).toMatchObject({
      id: cluster.clusterId,
      organizationId: "org-registry",
      campaignId: CAMPAIGN.campaignId,
      signatureKey: cluster.signature.signatureKey,
      payloadJson: canonicalJsonString(cluster),
      contentDigest: cluster.contentDigest,
    });
  });

  it("refuses an invalid V2 payload before inserting any row", async () => {
    const [cluster] = clusterStructureSignatures(
      { campaignRef: CAMPAIGN, observations: [observation()] },
      () => "cluster-invalid-registry",
      "2026-01-01T00:04:00.000Z",
    );
    const { executor, inserted } = registryExecutor();
    const invalid = { ...cluster, contentDigest: "0".repeat(64) };

    await expect(
      insertDiscoveryStructureClusterPostgres(
        executor,
        { organizationId: "org-registry" },
        { cluster: invalid },
      ),
    ).rejects.toThrow(/STRUCTURE_CLUSTER_V2_INVALID:CONTENT_DIGEST/);
    expect(inserted).toHaveLength(0);
  });

  it.each([
    ["missing", []],
    [
      "owned by another organization",
      [
        {
          id: CAMPAIGN.campaignId,
          organizationId: "org-other",
          contentDigest: CAMPAIGN.campaignDigest,
          currentState: CAMPAIGN.state,
        },
      ],
    ],
  ] as const)("refuses V2 append when the campaign is %s", async (_reason, campaigns) => {
    const [cluster] = clusterStructureSignatures(
      { campaignRef: CAMPAIGN, observations: [observation()] },
      () => "cluster-unowned-campaign",
      "2026-01-01T00:04:00.000Z",
    );
    const { executor, inserted, getCampaignReads, getCampaignWhereParams } = registryExecutor(
      "org-registry",
      [...campaigns],
    );

    await expect(
      insertDiscoveryStructureClusterPostgres(
        executor,
        { organizationId: "org-registry" },
        { cluster },
      ),
    ).rejects.toThrow(/STRUCTURE_CLUSTER_V2_INVALID:CAMPAIGN_NOT_IN_ORG/);
    expect(inserted).toHaveLength(0);
    expect(getCampaignReads()).toBe(1);
    expect(getCampaignWhereParams()).toEqual([CAMPAIGN.campaignId, "org-registry"]);
  });

  it("refuses a V2 campaign reference whose stored digest does not match", async () => {
    const [cluster] = clusterStructureSignatures(
      { campaignRef: CAMPAIGN, observations: [observation()] },
      () => "cluster-stale-campaign",
      "2026-01-01T00:04:00.000Z",
    );
    const { executor, inserted, getCampaignReads } = registryExecutor("org-registry", [
      {
        id: CAMPAIGN.campaignId,
        organizationId: "org-registry",
        contentDigest: "b".repeat(64),
        currentState: CAMPAIGN.state,
      },
    ]);

    await expect(
      insertDiscoveryStructureClusterPostgres(
        executor,
        { organizationId: "org-registry" },
        { cluster },
      ),
    ).rejects.toThrow(/STRUCTURE_CLUSTER_V2_INVALID:CAMPAIGN_IDENTITY/);
    expect(inserted).toHaveLength(0);
    expect(getCampaignReads()).toBe(1);
  });

  it("refuses a V2 campaign reference whose stored lifecycle state does not match", async () => {
    const [cluster] = clusterStructureSignatures(
      { campaignRef: CAMPAIGN, observations: [observation()] },
      () => "cluster-stale-campaign-state",
      "2026-01-01T00:04:00.000Z",
    );
    const { executor, inserted } = registryExecutor("org-registry", [
      {
        id: CAMPAIGN.campaignId,
        organizationId: "org-registry",
        contentDigest: CAMPAIGN.campaignDigest,
        currentState: "PAUSED",
      },
    ]);

    await expect(
      insertDiscoveryStructureClusterPostgres(
        executor,
        { organizationId: "org-registry" },
        { cluster },
      ),
    ).rejects.toThrow(/STRUCTURE_CLUSTER_V2_INVALID:CAMPAIGN_IDENTITY/);
    expect(inserted).toHaveLength(0);
  });

  it("preserves the legacy scalar-row append contract", async () => {
    const { executor, inserted, getCampaignReads } = registryExecutor();
    const legacy: InsertStructureClusterRow = {
      id: "legacy-cluster",
      organizationId: "ignored-caller-org",
      campaignId: CAMPAIGN.campaignId,
      signatureKey: "TREND::medium",
      payloadJson: '{"schemaVersion":"waia.trader.discovery-structure-cluster.v1"}',
      contentDigest: "legacy-digest",
    };

    await insertDiscoveryStructureClusterPostgres(
      executor,
      { organizationId: "org-registry" },
      legacy,
    );

    expect(inserted[0]).toEqual({
      id: legacy.id,
      organizationId: "org-registry",
      campaignId: legacy.campaignId,
      signatureKey: legacy.signatureKey,
      payloadJson: legacy.payloadJson,
      contentDigest: legacy.contentDigest,
      createdAt: undefined,
    });
    expect(getCampaignReads()).toBe(0);
  });
});
