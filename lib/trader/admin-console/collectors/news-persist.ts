import { createHash } from "node:crypto";
import { adminNewsText } from "@/lib/trader/admin-console/news-text";

import {
  canonicalNewsUrl,
  newsClusterKey,
  newsDedupeKey,
} from "@/lib/trader/admin-console/collectors/news-normalize";

export type NewsDraft = {
  source: string;
  guid: string | null;
  url: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  observedAt: string;
};

export type NewsVersionRow = {
  version: number;
  title: string;
  summary: string | null;
  contentHash: string;
  observedAt: string;
};

export type NewsWrite =
  | { action: "unchanged"; dedupeKey: string }
  | {
      action: "insert";
      dedupeKey: string;
      clusterKey: string;
      source: string;
      url: string;
      publishedAt: string | null;
      firstObservedAt: string;
      symbols: string[];
      category: "news";
      version: NewsVersionRow;
    }
  | {
      action: "version";
      dedupeKey: string;
      newsItemId: string;
      version: NewsVersionRow;
    };

export function clipNewsText(value: string, max = 500): string {
  const trimmed = adminNewsText(value);
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function newsContentHash(title: string, summary: string | null): string {
  return createHash("sha256")
    .update(`${title}\n${summary ?? ""}`)
    .digest("hex");
}

export function newsSymbols(title: string): string[] {
  const symbols: string[] = [];
  if (/\b(btc|bitcoin)\b/i.test(title)) symbols.push("BTC");
  if (/\b(eth|ethereum)\b/i.test(title)) symbols.push("ETH");
  return symbols;
}

export function planNewsWrite(
  existing: { id: string; contentHash: string; currentVersion: number } | null,
  draft: NewsDraft,
): NewsWrite | null {
  let url: string;
  try {
    url = canonicalNewsUrl(draft.url);
  } catch {
    return null;
  }
  const title = clipNewsText(draft.title);
  if (title.length === 0) return null;
  const summary = draft.summary === null ? null : clipNewsText(draft.summary);
  const contentHash = newsContentHash(title, summary);
  const dedupeKey = newsDedupeKey(draft.source, draft.guid, url);
  if (existing && existing.contentHash === contentHash) {
    return { action: "unchanged", dedupeKey };
  }
  const version: NewsVersionRow = {
    version: existing ? existing.currentVersion + 1 : 1,
    title,
    summary,
    contentHash,
    observedAt: draft.observedAt,
  };
  if (!existing) {
    return {
      action: "insert",
      dedupeKey,
      clusterKey: newsClusterKey(title),
      source: draft.source,
      url,
      publishedAt: draft.publishedAt,
      firstObservedAt: draft.observedAt,
      symbols: newsSymbols(title),
      category: "news",
      version,
    };
  }
  return { action: "version", dedupeKey, newsItemId: existing.id, version };
}
