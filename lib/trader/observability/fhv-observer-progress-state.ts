import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { FHV_OBSERVER_PROGRESS_STATE_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-observability.constants";

export type FhvObserverProgressStateV1 = Readonly<{
  schemaVersion: typeof FHV_OBSERVER_PROGRESS_STATE_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  lastBarsProcessed: number;
  lastProgressAtUtc: string | null;
  lastHeartbeatSequence: number | null;
  processRestartCount: number;
  restoredConservatively: boolean;
}>;

const PROGRESS_FILENAME = "observer-progress-state.v1.json";

export function resolveFhvObserverProgressStatePath(runRoot: string): string {
  return join(runRoot, "control", PROGRESS_FILENAME);
}

export function loadFhvObserverProgressState(runRoot: string): FhvObserverProgressStateV1 | null {
  const path = resolveFhvObserverProgressStatePath(runRoot);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FhvObserverProgressStateV1;
  } catch {
    return null;
  }
}

export function saveFhvObserverProgressState(
  runRoot: string,
  state: FhvObserverProgressStateV1,
): void {
  mkdirSync(join(runRoot, "control"), { recursive: true });
  writeFileAtomic(
    resolveFhvObserverProgressStatePath(runRoot),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

export function initializeFhvObserverProgressState(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
}): FhvObserverProgressStateV1 {
  const existing = loadFhvObserverProgressState(input.runRoot);
  if (
    existing &&
    existing.schemaVersion === FHV_OBSERVER_PROGRESS_STATE_SCHEMA_VERSION &&
    existing.runId === input.runId &&
    existing.organizationId === input.organizationId
  ) {
    return existing;
  }
  return {
    schemaVersion: FHV_OBSERVER_PROGRESS_STATE_SCHEMA_VERSION,
    runId: input.runId,
    organizationId: input.organizationId,
    lastBarsProcessed: 0,
    lastProgressAtUtc: null,
    lastHeartbeatSequence: null,
    processRestartCount: 0,
    restoredConservatively: true,
  };
}

export function persistFhvObserverProgressFromTick(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  lastBarsProcessed: number;
  lastProgressAtUtc: string | null;
  lastHeartbeatSequence: number | null;
  processRestartCount: number;
  restoredConservatively: boolean;
}): void {
  saveFhvObserverProgressState(input.runRoot, {
    schemaVersion: FHV_OBSERVER_PROGRESS_STATE_SCHEMA_VERSION,
    runId: input.runId,
    organizationId: input.organizationId,
    lastBarsProcessed: input.lastBarsProcessed,
    lastProgressAtUtc: input.lastProgressAtUtc,
    lastHeartbeatSequence: input.lastHeartbeatSequence,
    processRestartCount: input.processRestartCount,
    restoredConservatively: input.restoredConservatively,
  });
}
