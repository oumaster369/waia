import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { parseFhvStrictBooleanEnv } from "@/lib/trader/observability/fhv-env-config";

export const FHV_CROSS_PROCESS_PAUSE_BARRIER_READY_FILENAME =
  "cross-process-pause-ready.v1.json" as const;
export const FHV_CROSS_PROCESS_PAUSE_BARRIER_RELEASE_FILENAME =
  "cross-process-pause-release.v1.json" as const;

export const FHV_CROSS_PROCESS_PAUSE_BARRIER_DEFAULT_TIMEOUT_MS = 120_000;
export const FHV_CROSS_PROCESS_PAUSE_BARRIER_POLL_INTERVAL_MS = 25;

export type FhvCrossProcessPauseTestBarrierConfig = Readonly<{
  enabled: true;
  holdAtCycle: number;
  timeoutMs: number;
}>;

export type FhvCrossProcessPauseTestBarrierReadyMarker = Readonly<{
  schemaVersion: "fhv-cross-process-pause-ready/v1";
  cyclesProcessed: number;
  processPid: number;
  readyAtUtc: string;
}>;

export type FhvCrossProcessPauseTestBarrierReleaseMarker = Readonly<{
  schemaVersion: "fhv-cross-process-pause-release/v1";
  releasedAtUtc: string;
}>;

export type FhvCrossProcessPauseTestBarrierStatus = Readonly<{
  readyPresent: boolean;
  releasePresent: boolean;
  readyMarker: FhvCrossProcessPauseTestBarrierReadyMarker | null;
  releaseMarker: FhvCrossProcessPauseTestBarrierReleaseMarker | null;
}>;

export class FhvCrossProcessPauseTestBarrierError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvCrossProcessPauseTestBarrierError";
  }
}

function controlDir(runRoot: string): string {
  return join(runRoot, "control");
}

function readyPath(runRoot: string): string {
  return join(controlDir(runRoot), FHV_CROSS_PROCESS_PAUSE_BARRIER_READY_FILENAME);
}

function releasePath(runRoot: string): string {
  return join(controlDir(runRoot), FHV_CROSS_PROCESS_PAUSE_BARRIER_RELEASE_FILENAME);
}

function syncSleepMs(ms: number): void {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // Test-only child hold; parent controls release via marker file.
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function resolveFhvCrossProcessPauseTestBarrierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FhvCrossProcessPauseTestBarrierConfig | null {
  if (env.NODE_ENV !== "test") {
    return null;
  }
  if (!parseFhvStrictBooleanEnv(env.FHV_CROSS_PROCESS_PAUSE_BARRIER)) {
    return null;
  }
  return {
    enabled: true,
    holdAtCycle: parsePositiveInt(env.FHV_CROSS_PROCESS_PAUSE_BARRIER_CYCLE, 30),
    timeoutMs: parsePositiveInt(
      env.FHV_CROSS_PROCESS_PAUSE_BARRIER_TIMEOUT_MS,
      FHV_CROSS_PROCESS_PAUSE_BARRIER_DEFAULT_TIMEOUT_MS,
    ),
  };
}

export function readFhvCrossProcessPauseTestBarrierStatus(
  runRoot: string,
): FhvCrossProcessPauseTestBarrierStatus {
  const readyFile = readyPath(runRoot);
  const releaseFile = releasePath(runRoot);
  const readyPresent = existsSync(readyFile);
  const releasePresent = existsSync(releaseFile);
  let readyMarker: FhvCrossProcessPauseTestBarrierReadyMarker | null = null;
  let releaseMarker: FhvCrossProcessPauseTestBarrierReleaseMarker | null = null;
  if (readyPresent) {
    try {
      readyMarker = JSON.parse(
        readFileSync(readyFile, "utf8"),
      ) as FhvCrossProcessPauseTestBarrierReadyMarker;
    } catch {
      readyMarker = null;
    }
  }
  if (releasePresent) {
    try {
      releaseMarker = JSON.parse(
        readFileSync(releaseFile, "utf8"),
      ) as FhvCrossProcessPauseTestBarrierReleaseMarker;
    } catch {
      releaseMarker = null;
    }
  }
  return { readyPresent, releasePresent, readyMarker, releaseMarker };
}

export function maybeHoldFhvCrossProcessPauseTestBarrier(input: {
  runRoot: string;
  cyclesProcessed: number;
  barrier?: FhvCrossProcessPauseTestBarrierConfig | null;
}): void {
  const barrier = input.barrier ?? resolveFhvCrossProcessPauseTestBarrierFromEnv();
  if (!barrier || input.cyclesProcessed < barrier.holdAtCycle) {
    return;
  }
  if (existsSync(releasePath(input.runRoot))) {
    return;
  }

  writeFileAtomic(
    readyPath(input.runRoot),
    `${JSON.stringify(
      {
        schemaVersion: "fhv-cross-process-pause-ready/v1",
        cyclesProcessed: input.cyclesProcessed,
        processPid: process.pid,
        readyAtUtc: new Date().toISOString(),
      } satisfies FhvCrossProcessPauseTestBarrierReadyMarker,
      null,
      2,
    )}\n`,
  );

  const started = Date.now();
  while (!existsSync(releasePath(input.runRoot))) {
    if (Date.now() - started > barrier.timeoutMs) {
      throw new FhvCrossProcessPauseTestBarrierError(
        "FHV_CROSS_PROCESS_PAUSE_BARRIER_TIMEOUT",
        `Timed out waiting for cross-process pause release marker after cycle ${input.cyclesProcessed}.`,
      );
    }
    syncSleepMs(FHV_CROSS_PROCESS_PAUSE_BARRIER_POLL_INTERVAL_MS);
  }
}

export async function waitForFhvCrossProcessPauseTestBarrierReady(input: {
  runRoot: string;
  minCycle: number;
  timeoutMs?: number;
}): Promise<FhvCrossProcessPauseTestBarrierReadyMarker> {
  const timeoutMs = input.timeoutMs ?? FHV_CROSS_PROCESS_PAUSE_BARRIER_DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = readFhvCrossProcessPauseTestBarrierStatus(input.runRoot);
    if (
      status.readyMarker &&
      status.readyMarker.cyclesProcessed >= input.minCycle &&
      !status.releasePresent
    ) {
      return status.readyMarker;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, FHV_CROSS_PROCESS_PAUSE_BARRIER_POLL_INTERVAL_MS),
    );
  }
  const status = readFhvCrossProcessPauseTestBarrierStatus(input.runRoot);
  throw new FhvCrossProcessPauseTestBarrierError(
    "FHV_CROSS_PROCESS_PAUSE_BARRIER_READY_TIMEOUT",
    `Timed out waiting for cross-process pause-ready marker (minCycle=${input.minCycle}, readyPresent=${status.readyPresent}, releasePresent=${status.releasePresent}, cycles=${status.readyMarker?.cyclesProcessed ?? "none"}).`,
  );
}

export function releaseFhvCrossProcessPauseTestBarrier(runRoot: string): void {
  writeFileAtomic(
    releasePath(runRoot),
    `${JSON.stringify(
      {
        schemaVersion: "fhv-cross-process-pause-release/v1",
        releasedAtUtc: new Date().toISOString(),
      } satisfies FhvCrossProcessPauseTestBarrierReleaseMarker,
      null,
      2,
    )}\n`,
  );
}
