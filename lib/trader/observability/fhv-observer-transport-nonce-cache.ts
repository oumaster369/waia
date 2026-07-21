import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

type NonceEntry = Readonly<{
  nonce: string;
  organizationId: string;
  campaignRunId: string;
  seenAtMs: number;
}>;

export type FhvObserverTransportNonceCache = Readonly<{
  seenNonces: Set<string>;
  remember(input: {
    nonce: string;
    organizationId: string;
    campaignRunId: string;
    nowMs?: number;
  }): void;
  has(input: { nonce: string; organizationId: string; campaignRunId: string }): boolean;
  prune(nowMs?: number): void;
}>;

function cacheKey(organizationId: string, campaignRunId: string, nonce: string): string {
  return `${organizationId}:${campaignRunId}:${nonce}`;
}

export function createFhvObserverTransportNonceCache(input?: {
  maxSkewMs?: number;
  maxEntries?: number;
  ttlMs?: number;
  persistPath?: string;
}): FhvObserverTransportNonceCache {
  const maxSkewMs = input?.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  const maxEntries = input?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const ttlMs = input?.ttlMs ?? DEFAULT_TTL_MS;
  const persistPath = input?.persistPath;
  const entries = new Map<string, NonceEntry>();

  if (persistPath && existsSync(persistPath)) {
    try {
      const lines = readFileSync(persistPath, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        const parsed = JSON.parse(line) as NonceEntry;
        entries.set(cacheKey(parsed.organizationId, parsed.campaignRunId, parsed.nonce), parsed);
      }
    } catch {
      // fail closed on corrupt cache — start empty
    }
  }

  function persist(): void {
    if (!persistPath) {
      return;
    }
    mkdirSync(join(persistPath, ".."), { recursive: true });
    const payload = [...entries.values()].map((entry) => JSON.stringify(entry)).join("\n");
    writeFileSync(persistPath, payload.length > 0 ? `${payload}\n` : "", "utf8");
  }

  function prune(nowMs = Date.now()): void {
    for (const [key, entry] of entries) {
      if (nowMs - entry.seenAtMs > ttlMs + maxSkewMs) {
        entries.delete(key);
      }
    }
    while (entries.size > maxEntries) {
      const oldest = [...entries.entries()].sort((a, b) => a[1].seenAtMs - b[1].seenAtMs)[0];
      if (!oldest) {
        break;
      }
      entries.delete(oldest[0]);
    }
    persist();
  }

  const seenNonces = new Set<string>();

  return {
    seenNonces,
    remember({ nonce, organizationId, campaignRunId, nowMs = Date.now() }) {
      prune(nowMs);
      const key = cacheKey(organizationId, campaignRunId, nonce);
      entries.set(key, { nonce, organizationId, campaignRunId, seenAtMs: nowMs });
      seenNonces.add(nonce);
      persist();
    },
    has({ nonce, organizationId, campaignRunId }) {
      return entries.has(cacheKey(organizationId, campaignRunId, nonce));
    },
    prune,
  };
}

export function createFhvObserverTransportNonceCacheForRunRoot(
  runRoot: string,
): FhvObserverTransportNonceCache {
  return createFhvObserverTransportNonceCache({
    persistPath: join(runRoot, "control", "observer-transport-nonces.jsonl"),
  });
}
