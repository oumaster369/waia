import type { AdminReleaseFact } from "@/lib/trader/admin-console/release";
import type { JobCatalogEntry } from "@/lib/trader/admin-console/jobs/job-catalog";
export type SystemJob = JobCatalogEntry & {
  lastRun: {
    at: string;
    finishedAt: string | null;
    status: string;
    errorClass: string | null;
  } | null;
  state: "ok" | "stale" | "unavailable";
  reason: string | null;
};
export type SystemSource = {
  source: string;
  kind: string;
  observedAt: string | null;
  total: number;
  fresh: number | null;
  state: "ok" | "partial" | "stale" | "unavailable";
};
export type SystemReadModel = {
  release: AdminReleaseFact;
  jobs: SystemJob[];
  recentRuns: { jobKey: string; startedAtMs: number; status: string }[];
  missedMinuteJobs: string[];
  diagnosticScope: "fleet";
  assistant: { enabled: boolean; mode: "enabled" | "disabled"; telemetryReason: string };
  sources?: SystemSource[];
  controls?: {
    killSwitches: {
      id: string;
      organizationId: string | null;
      scope: string;
      type: string;
      enforcement: string;
      state: string;
      origin: string;
      version: string;
      at: string | null;
    }[];
    liveEnable: {
      organizationId: string;
      state: string;
      cap: string;
      currency: "USDT";
      at: string | null;
      coolingOffEndsAt: string | null;
    }[];
    runtimeAuthority: {
      organizationId: string;
      id: string;
      instance: string;
      posture: string;
      at: string | null;
    }[];
    risk: {
      organizationId: string;
      accountId: string;
      posture: string;
      reconciliation: string;
      killState: string;
      limit: string;
      reserved: string;
      currency: string;
      at: string | null;
      version: string;
    }[];
    accountBindingReason: string | null;
    truncated: boolean;
  };
  audit?: {
    items: {
      id: string;
      organizationId: string | null;
      actorType: string;
      action: string;
      entityType: string;
      entityId: string | null;
      at: string | null;
    }[];
    total: number | null;
    reason: string | null;
  };
  researchReasoning: { state: "unavailable"; reason: "RESEARCH_REASONING_NOT_IN_CONSOLE" };
  holdout: { state: "unavailable"; reason: string };
};
