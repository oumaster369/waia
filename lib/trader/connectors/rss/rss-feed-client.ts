import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type RssFeedItem = {
  title: string;
  link: string;
  publishedAt?: string;
  summary?: string;
};

export type RssFeedClientConfig = {
  fetchImpl?: HtxFetchFn;
};

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match?.[1]) {
    return undefined;
  }
  return decodeXmlEntities(match[1].trim());
}

function parseRssItems(xml: string): RssFeedItem[] {
  const items: RssFeedItem[] = [];
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    if (!title || !link) {
      continue;
    }
    items.push({
      title,
      link,
      publishedAt: extractTag(block, "pubDate"),
      summary: extractTag(block, "description"),
    });
  }
  return items;
}

export class RssFeedClient {
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: RssFeedClientConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async fetchFeed(feedUrl: string, limit = 10): Promise<RssFeedItem[]> {
    const response = await this.fetchImpl(feedUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(`[rss] feed HTTP ${response.status}`);
    }
    const xml = await response.text();
    return parseRssItems(xml).slice(0, limit);
  }
}
