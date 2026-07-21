import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { FHV_CAMPAIGN_HEARTBEAT_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";

export type FhvCampaignHeartbeatV1 = Readonly<{
  schemaVersion: typeof FHV_CAMPAIGN_HEARTBEAT_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  campaignProcessIdentity: string;
  heartbeatSequence: number;
  heartbeatAtUtc: string;
  barsProcessed: number;
  phase: string;
}>;

export const FHV_CAMPAIGN_HEARTBEAT_FILENAME = "campaign-heartbeat.v1.json";

export function resolveFhvCampaignHeartbeatPath(runRoot: string): string {
  return join(runRoot, "control", FHV_CAMPAIGN_HEARTBEAT_FILENAME);
}

export function readFhvCampaignHeartbeat(runRoot: string): FhvCampaignHeartbeatV1 | null {
  const path = resolveFhvCampaignHeartbeatPath(runRoot);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FhvCampaignHeartbeatV1;
  } catch {
    return null;
  }
}

export function writeFhvCampaignHeartbeat(
  runRoot: string,
  heartbeat: FhvCampaignHeartbeatV1,
): void {
  writeFileAtomic(
    resolveFhvCampaignHeartbeatPath(runRoot),
    `${JSON.stringify(heartbeat, null, 2)}\n`,
  );
}

export type FhvCampaignHeartbeatValidation =
  | { ok: true; heartbeat: FhvCampaignHeartbeatV1; heartbeatAgeSec: number }
  | {
      ok: false;
      heartbeatState:
        | "UNKNOWN_OR_MISSING"
        | "ORG_MISMATCH"
        | "RUN_MISMATCH"
        | "SEQUENCE_REGRESSION"
        | "INVALID";
    };

export function validateFhvCampaignHeartbeat(input: {
  runRoot: string;
  organizationId: string;
  runId: string;
  nowMs?: number;
  lastSeenSequence?: number;
}): FhvCampaignHeartbeatValidation {
  const heartbeat = readFhvCampaignHeartbeat(input.runRoot);
  if (!heartbeat) {
    return { ok: false, heartbeatState: "UNKNOWN_OR_MISSING" };
  }
  if (heartbeat.schemaVersion !== FHV_CAMPAIGN_HEARTBEAT_SCHEMA_VERSION) {
    return { ok: false, heartbeatState: "INVALID" };
  }
  if (heartbeat.organizationId !== input.organizationId) {
    return { ok: false, heartbeatState: "ORG_MISMATCH" };
  }
  if (heartbeat.runId !== input.runId) {
    return { ok: false, heartbeatState: "RUN_MISMATCH" };
  }
  const heartbeatMs = Date.parse(heartbeat.heartbeatAtUtc);
  if (!Number.isFinite(heartbeatMs)) {
    return { ok: false, heartbeatState: "INVALID" };
  }
  if (
    input.lastSeenSequence !== undefined &&
    heartbeat.heartbeatSequence < input.lastSeenSequence
  ) {
    return { ok: false, heartbeatState: "SEQUENCE_REGRESSION" };
  }
  const nowMs = input.nowMs ?? Date.now();
  const heartbeatAgeSec = Math.max(0, Math.floor((nowMs - heartbeatMs) / 1000));
  return { ok: true, heartbeat, heartbeatAgeSec };
}

export function resolveCampaignHeartbeatWrittenAtUtc(runRoot: string): string | null {
  try {
    return new Date(statSync(resolveFhvCampaignHeartbeatPath(runRoot)).mtimeMs).toISOString();
  } catch {
    return null;
  }
}
