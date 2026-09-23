import { RssFeedClient, type RssFeedItem } from "@/lib/trader/connectors/rss/rss-feed-client";
import type { NewsDraft } from "@/lib/trader/admin-console/collectors/news-persist";

const FEEDS = [
  { source: "coindesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "decrypt", url: "https://decrypt.co/feed" },
] as const;

export async function fetchAdminNewsDrafts(
  fetchImpl: typeof fetch = fetch,
  observedAt = new Date().toISOString(),
): Promise<NewsDraft[]> {
  const client = new RssFeedClient({ fetchImpl });
  const drafts: NewsDraft[] = [];
  for (const feed of FEEDS) {
    const items = await client.fetchFeed(feed.url, 20);
    for (const item of items) drafts.push(draftFromItem(feed.source, item, observedAt));
  }
  return drafts;
}

function draftFromItem(source: string, item: RssFeedItem, observedAt: string): NewsDraft {
  const published = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
  return {
    source,
    guid: item.guid ?? null,
    url: item.canonicalLink ?? item.link,
    title: item.title,
    summary: item.summary ?? null,
    publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null,
    observedAt,
  };
}
