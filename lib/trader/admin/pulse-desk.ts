import { FHV_CAMPAIGN_RUN_ID_PATTERN } from "@/lib/trader/fhv-campaign-run-id";
import {
  adminScopedHref,
  COCKPIT_FACT_KEYS,
  cockpitFactValueText,
  formatCockpitAge,
  type CockpitFact,
  type CockpitSnapshot,
} from "@/lib/trader/admin/cockpit-client";

export type PulseTransport = "live" | "reconnecting" | "poll";

/** Operator-facing stream lamp. Stale wins over the underlying transport. */
export type PulseLedState = PulseTransport | "stale";

export type RuntimeAuthorityStrip = {
  readonly availability: string;
  readonly posture: string | null;
  readonly reasonCodes: readonly string[];
};

export type PulseTapeEntry = {
  readonly id: string;
  readonly kind: "reason" | "fact";
  readonly label: string;
  readonly detail: string;
};

const FACT_LABELS: Record<(typeof COCKPIT_FACT_KEYS)[number], string> = {
  releaseIdentity: "Release",
  runtimeAuthority: "Runtime",
  observationFreshness: "Freshness",
  c3: "C3",
};

export const PULSE_TAPE_WINDOW = 48;

export function derivePulseLedState(connection: PulseTransport, stale: boolean): PulseLedState {
  return stale ? "stale" : connection;
}

export function campaignRunIdForCockpit(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !FHV_CAMPAIGN_RUN_ID_PATTERN.test(trimmed)) return "";
  return trimmed;
}

export function readRuntimeAuthorityStrip(
  fact: CockpitFact | null | undefined,
): RuntimeAuthorityStrip {
  if (!fact || fact.state !== "value" || !fact.value || typeof fact.value !== "object") {
    return { availability: "UNAVAILABLE", posture: null, reasonCodes: [] };
  }
  const record = fact.value as {
    availability?: unknown;
    posture?: unknown;
    reasonCodes?: unknown;
  };
  const reasonCodes = Array.isArray(record.reasonCodes)
    ? record.reasonCodes.filter(
        (code): code is string => typeof code === "string" && code.trim() !== "",
      )
    : [];
  return {
    availability: typeof record.availability === "string" ? record.availability : "UNAVAILABLE",
    posture: typeof record.posture === "string" && record.posture ? record.posture : null,
    reasonCodes,
  };
}

export function pulseTapeFromSnapshot(
  snapshot: CockpitSnapshot | null,
  nowMs: number,
): readonly PulseTapeEntry[] {
  if (!snapshot) return [];
  const runtime = readRuntimeAuthorityStrip(snapshot.runtimeAuthority);
  const reasons: PulseTapeEntry[] = runtime.reasonCodes.map((code) => ({
    id: `reason:${code}`,
    kind: "reason",
    label: code,
    detail: runtime.posture ? `${runtime.availability} · ${runtime.posture}` : runtime.availability,
  }));
  const facts: PulseTapeEntry[] = COCKPIT_FACT_KEYS.map((key) => {
    const fact = snapshot[key];
    return {
      id: `fact:${key}`,
      kind: "fact",
      label: FACT_LABELS[key],
      detail: `${cockpitFactValueText(fact)} · ${formatCockpitAge(fact.asOf, nowMs)}`,
    };
  });
  return [...reasons, ...facts];
}

export function nextTapeWindow(shown: number, total: number): number {
  if (shown >= total) return total;
  return Math.min(total, shown + PULSE_TAPE_WINDOW);
}

export function cockpitFactByKey(snapshot: CockpitSnapshot, factKey: string): CockpitFact | null {
  for (const key of COCKPIT_FACT_KEYS) {
    if (key === factKey) return snapshot[key];
  }
  return null;
}

export function pulseScopedHref(path: string, organizationId: string, campaignRunId = ""): string {
  const base = adminScopedHref(path, organizationId);
  const campaign = campaignRunIdForCockpit(campaignRunId);
  if (!campaign) return base;
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}campaign_run_id=${encodeURIComponent(campaign)}`;
}

export function pulseAccountObservationHref(account: {
  readonly organizationId: string;
  readonly credentialId: string;
  readonly exchangeAccountId: string;
}): string {
  const params = new URLSearchParams({
    organization_id: account.organizationId,
    credential_id: account.credentialId,
    exchange_account_id: account.exchangeAccountId,
  });
  return `/admin/account-observation?${params.toString()}`;
}

/** Deep-link into the existing read → review → trip console. Does not send a command. */
export function pulseHaltHref(organizationId: string): string {
  const params = new URLSearchParams();
  const id = organizationId.trim();
  if (id) params.set("organization_id", id);
  params.set("switch_type", "EMERGENCY_STOP");
  return `/admin/kill-switches?${params.toString()}`;
}
