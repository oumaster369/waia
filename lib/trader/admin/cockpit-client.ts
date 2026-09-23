export const COCKPIT_STREAM_STALE_AFTER_MS = 20_000;

export type CockpitAsOf =
  | { readonly state: "known"; readonly at: string | number }
  | { readonly state: "unknown" };

export type CockpitFact = {
  readonly state: "value" | "unavailable";
  readonly source: string;
  readonly asOf: CockpitAsOf;
  readonly value?: unknown;
  readonly operatorCampaignRunId?: string;
};

export type CockpitSnapshot = {
  readonly organizationId: string;
  readonly releaseIdentity: CockpitFact;
  readonly runtimeAuthority: CockpitFact;
  readonly observationFreshness: CockpitFact;
  readonly c3: CockpitFact;
};

export const COCKPIT_FACT_KEYS = [
  "releaseIdentity",
  "runtimeAuthority",
  "observationFreshness",
  "c3",
] as const;

export function adminScopedHref(path: string, organizationId: string): string {
  const id = organizationId.trim();
  if (!id) return path;
  return `${path}?organization_id=${encodeURIComponent(id)}`;
}

export function cockpitStreamIsStale(lastContactMs: number | null, nowMs: number): boolean {
  return lastContactMs !== null && nowMs - lastContactMs >= COCKPIT_STREAM_STALE_AFTER_MS;
}

export function formatCockpitAge(asOf: CockpitAsOf, nowMs: number): string {
  if (asOf.state !== "known") return "Age unknown";
  const atMs = typeof asOf.at === "number" ? asOf.at : Date.parse(asOf.at);
  if (!Number.isFinite(atMs)) return "Age unknown";
  const seconds = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function isAsOf(value: unknown): value is CockpitAsOf {
  if (!value || typeof value !== "object") return false;
  const record = value as { state?: unknown; at?: unknown };
  if (record.state === "unknown") return true;
  return (
    record.state === "known" && (typeof record.at === "string" || typeof record.at === "number")
  );
}

function isFact(value: unknown): value is CockpitFact {
  if (!value || typeof value !== "object") return false;
  const record = value as {
    state?: unknown;
    source?: unknown;
    asOf?: unknown;
    operatorCampaignRunId?: unknown;
  };
  if (record.state !== "value" && record.state !== "unavailable") return false;
  if (typeof record.source !== "string" || record.source.trim() === "") return false;
  if (!isAsOf(record.asOf)) return false;
  if (record.state === "value" && !("value" in record)) return false;
  if (
    record.operatorCampaignRunId !== undefined &&
    typeof record.operatorCampaignRunId !== "string"
  ) {
    return false;
  }
  return true;
}

export function parseCockpitSnapshot(raw: string, organizationId: string): CockpitSnapshot | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.organizationId !== organizationId) return null;
  const facts = {} as Record<(typeof COCKPIT_FACT_KEYS)[number], CockpitFact>;
  for (const key of COCKPIT_FACT_KEYS) {
    if (!isFact(record[key])) return null;
    facts[key] = record[key];
  }
  return { organizationId, ...facts };
}

export function cockpitFactValueText(fact: CockpitFact): string {
  if (fact.state === "unavailable") return "UNAVAILABLE";
  const value = fact.value;
  if (value == null) return "UNAVAILABLE";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return String(value);
  }
  if (typeof value === "object") {
    const record = value as { availability?: unknown; posture?: unknown; phase?: unknown };
    if (typeof record.availability === "string") {
      return typeof record.posture === "string" && record.posture
        ? `${record.availability} · ${record.posture}`
        : record.availability;
    }
    if (typeof record.phase === "string") return record.phase;
  }
  return JSON.stringify(value);
}
