import { createHash } from "node:crypto";

const TRACKING = new Set(["fbclid", "gclid", "ref", "mc_cid", "mc_eid"]);

export function canonicalNewsUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const kept = [...url.searchParams.entries()].filter(
    ([key]) => !key.startsWith("utm_") && !TRACKING.has(key),
  );
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  return url.toString();
}

export function newsDedupeKey(source: string, guid: string | null, url: string): string {
  const body = guid ? `${source}\n${guid}` : `${source}\n${canonicalNewsUrl(url)}`;
  return createHash("sha256").update(body).digest("hex");
}

const STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "for", "on"]);

export function newsClusterKey(title: string): string {
  const tokens = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP.has(token))
    .slice(0, 8)
    .sort();
  return createHash("sha256").update(tokens.join("\n")).digest("hex");
}
