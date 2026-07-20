import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export type GitHubRelease = {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  assets: GitHubReleaseAsset[];
};

export type GitHubReleasesClientConfig = {
  baseUrl?: string;
  token?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://api.github.com";

function resolveGitHubToken(configToken?: string): string | undefined {
  return configToken ?? process.env.AI_TRADER_GITHUB_TOKEN;
}

export class GitHubReleasesClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: GitHubReleasesClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.token = resolveGitHubToken(config.token);
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async listReleases(input: {
    owner: string;
    repo: string;
    perPage?: number;
  }): Promise<GitHubRelease[]> {
    const params = new URLSearchParams({
      per_page: String(input.perPage ?? 5),
    });
    const url = `${this.baseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/releases?${params.toString()}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const response = await this.fetchImpl(url, { method: "GET", headers });
    if (!response.ok) {
      throw new Error(`[github] releases HTTP ${response.status}`);
    }
    return (await response.json()) as GitHubRelease[];
  }
}
