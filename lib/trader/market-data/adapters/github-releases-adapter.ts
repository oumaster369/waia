import { GitHubReleasesClient } from "@/lib/trader/connectors/github/github-releases-client";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import { PROTOCOL_WATCHLIST } from "@/lib/trader/market-data/config/protocol-watchlist";
import {
  buildProvenanceRef,
  normalizeProtocolReleaseObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

export type GitHubReleasesAdapterConfig = {
  token?: string;
  fetchImpl?: typeof fetch;
};

export class GitHubReleasesAdapter implements MarketDataAdapter {
  readonly providerId = "github_releases" as const;
  private readonly client: GitHubReleasesClient;

  constructor(config: GitHubReleasesAdapterConfig = {}) {
    this.client = new GitHubReleasesClient({
      token: config.token,
      fetchImpl: config.fetchImpl,
    });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const observations: NormalizedObservation[] = [];
      for (const entry of PROTOCOL_WATCHLIST) {
        const timed = await timedAdapterFetch(() =>
          this.client.listReleases({
            owner: entry.owner,
            repo: entry.repo,
            perPage: 1,
          }),
        );
        const release = timed.value[0];
        if (!release) {
          continue;
        }
        observations.push(
          normalizeProtocolReleaseObservation({
            owner: entry.owner,
            repo: entry.repo,
            tagName: release.tag_name,
            releaseName: release.name,
            publishedAt: release.published_at,
            provenance: buildProvenanceRef({
              providerId: "github_releases",
              venue: "github",
              feedKind: "protocol_release",
              symbol,
              eventTimeUtc: release.published_at,
            }),
            latencyMs: timed.latencyMs,
            evaluatedAt: context.evaluatedAt,
            eventTimeUtc: release.published_at,
          }),
        );
      }
      if (observations.length === 0) {
        throw new Error("[github-releases] no releases returned");
      }
      return observations;
    } catch (error) {
      return [
        normalizeUnavailableObservation({
          kind: "protocol_release",
          provenance: buildProvenanceRef({
            providerId: "github_releases",
            venue: "github",
            feedKind: "protocol_release",
            symbol,
            eventTimeUtc: context.evaluatedAt,
          }),
          evaluatedAt: context.evaluatedAt,
          reason: error instanceof Error ? error.message : String(error),
        }),
      ];
    }
  }
}
