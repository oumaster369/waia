/**
 * DEE-436 — bounded polling for T4A terminal states.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  readFhvRehearsalActualPauseCycle,
  readFhvRehearsalTerminalClassification,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { readFhvRehearsalManifest } from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";

export const FHV_T4_BOUNDED_WAIT_DEFAULT_TIMEOUT_MS = 300_000 as const;
export const FHV_T4_BOUNDED_WAIT_DEFAULT_POLL_MS = 2_000 as const;

export class FhvT4BoundedWaitError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4BoundedWaitError";
  }
}

export type FhvT4BoundedWaitDeps = Readonly<{
  sleepMs: (ms: number) => Promise<void>;
  nowMs: () => number;
}>;

const defaultDeps: FhvT4BoundedWaitDeps = {
  sleepMs: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nowMs: () => Date.now(),
};

function assertWaitIdentity(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
}): void {
  const manifest = readFhvRehearsalManifest(input.runRoot);
  if (
    manifest.runId !== input.runId ||
    manifest.organizationId !== input.organizationId ||
    manifest.targetSha !== input.targetSha
  ) {
    throw new FhvT4BoundedWaitError(
      "FHV_T4_WAIT_IDENTITY_MISMATCH",
      "Terminal/manifest identity does not match wait identity.",
    );
  }
}

function assertTerminalIdentityOrAbsent(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
}): void {
  assertWaitIdentity(input);
  const terminalPath = join(input.runRoot, "fhv-rehearsal-terminal.v1.json");
  if (!existsSync(terminalPath)) {
    return;
  }
  const terminal = JSON.parse(readFileSync(terminalPath, "utf8")) as {
    runId?: string;
    organizationId?: string;
    targetSha?: string;
    classification?: string;
  };
  if (
    (terminal.runId && terminal.runId !== input.runId) ||
    (terminal.organizationId && terminal.organizationId !== input.organizationId) ||
    (terminal.targetSha && terminal.targetSha !== input.targetSha)
  ) {
    throw new FhvT4BoundedWaitError(
      "FHV_T4_WAIT_TERMINAL_IDENTITY_MISMATCH",
      "Terminal artifact belongs to another run/org/SHA.",
    );
  }
  if (
    terminal.classification &&
    terminal.classification !== "REHEARSAL_PAUSED" &&
    terminal.classification !== "REHEARSAL_OK" &&
    terminal.classification !== "REHEARSAL_FAILED" &&
    terminal.classification !== "REHEARSAL_TIMEOUT"
  ) {
    throw new FhvT4BoundedWaitError(
      "FHV_T4_WAIT_TERMINAL_UNKNOWN",
      `Unknown terminal classification: ${terminal.classification}`,
    );
  }
  if (terminal.classification === "REHEARSAL_FAILED") {
    throw new FhvT4BoundedWaitError(
      "FHV_T4_WAIT_TERMINAL_FAILED",
      "Campaign terminal is REHEARSAL_FAILED.",
    );
  }
}

export async function waitFhvT4PausedTerminal(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  timeoutMs?: number;
  pollMs?: number;
  deps?: FhvT4BoundedWaitDeps;
}): Promise<{ classification: "REHEARSAL_PAUSED"; actualPauseCycle: number }> {
  const deps = input.deps ?? defaultDeps;
  const timeoutMs = input.timeoutMs ?? FHV_T4_BOUNDED_WAIT_DEFAULT_TIMEOUT_MS;
  const pollMs = input.pollMs ?? FHV_T4_BOUNDED_WAIT_DEFAULT_POLL_MS;
  assertWaitIdentity(input);
  const deadline = deps.nowMs() + timeoutMs;
  while (deps.nowMs() <= deadline) {
    assertTerminalIdentityOrAbsent(input);
    const terminal = readFhvRehearsalTerminalClassification(input.runRoot);
    const actualPauseCycle = readFhvRehearsalActualPauseCycle(input.runRoot);
    if (terminal === "REHEARSAL_PAUSED" && actualPauseCycle === FHV_REHEARSAL_CHECKPOINT_CYCLE) {
      return { classification: "REHEARSAL_PAUSED", actualPauseCycle };
    }
    if (terminal === "REHEARSAL_FAILED" || terminal === "REHEARSAL_TIMEOUT") {
      throw new FhvT4BoundedWaitError(
        "FHV_T4_WAIT_PAUSED_FAILED_TERMINAL",
        `Unexpected terminal while waiting for pause: ${terminal}`,
      );
    }
    await deps.sleepMs(pollMs);
  }
  throw new FhvT4BoundedWaitError(
    "FHV_T4_WAIT_PAUSED_TIMEOUT",
    `Timed out waiting for REHEARSAL_PAUSED at cycle ${FHV_REHEARSAL_CHECKPOINT_CYCLE}.`,
  );
}

export async function waitFhvT4FinalTerminal(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  timeoutMs?: number;
  pollMs?: number;
  deps?: FhvT4BoundedWaitDeps;
}): Promise<{ classification: "REHEARSAL_OK" }> {
  const deps = input.deps ?? defaultDeps;
  const timeoutMs = input.timeoutMs ?? FHV_T4_BOUNDED_WAIT_DEFAULT_TIMEOUT_MS;
  const pollMs = input.pollMs ?? FHV_T4_BOUNDED_WAIT_DEFAULT_POLL_MS;
  assertWaitIdentity(input);
  const deadline = deps.nowMs() + timeoutMs;
  while (deps.nowMs() <= deadline) {
    assertTerminalIdentityOrAbsent(input);
    const terminal = readFhvRehearsalTerminalClassification(input.runRoot);
    if (terminal === "REHEARSAL_OK") {
      return { classification: "REHEARSAL_OK" };
    }
    if (terminal === "REHEARSAL_FAILED" || terminal === "REHEARSAL_TIMEOUT") {
      throw new FhvT4BoundedWaitError(
        "FHV_T4_WAIT_FINAL_FAILED_TERMINAL",
        `Unexpected terminal while waiting for final: ${terminal}`,
      );
    }
    await deps.sleepMs(pollMs);
  }
  throw new FhvT4BoundedWaitError(
    "FHV_T4_WAIT_FINAL_TIMEOUT",
    "Timed out waiting for REHEARSAL_OK.",
  );
}
