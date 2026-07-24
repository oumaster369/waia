/**
 * DEE-436 — bounded polling for T4A terminal states.
 */

import {
  readFhvRehearsalActualPauseCycle,
  readFhvRehearsalTerminalClassification,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
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

export async function waitFhvT4PausedTerminal(input: {
  runRoot: string;
  timeoutMs?: number;
  pollMs?: number;
  deps?: FhvT4BoundedWaitDeps;
}): Promise<{ classification: "REHEARSAL_PAUSED"; actualPauseCycle: number }> {
  const deps = input.deps ?? defaultDeps;
  const timeoutMs = input.timeoutMs ?? FHV_T4_BOUNDED_WAIT_DEFAULT_TIMEOUT_MS;
  const pollMs = input.pollMs ?? FHV_T4_BOUNDED_WAIT_DEFAULT_POLL_MS;
  const deadline = deps.nowMs() + timeoutMs;
  while (deps.nowMs() <= deadline) {
    const terminal = readFhvRehearsalTerminalClassification(input.runRoot);
    const actualPauseCycle = readFhvRehearsalActualPauseCycle(input.runRoot);
    if (terminal === "REHEARSAL_PAUSED" && actualPauseCycle === FHV_REHEARSAL_CHECKPOINT_CYCLE) {
      return { classification: "REHEARSAL_PAUSED", actualPauseCycle };
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
  timeoutMs?: number;
  pollMs?: number;
  deps?: FhvT4BoundedWaitDeps;
}): Promise<{ classification: "REHEARSAL_OK" }> {
  const deps = input.deps ?? defaultDeps;
  const timeoutMs = input.timeoutMs ?? FHV_T4_BOUNDED_WAIT_DEFAULT_TIMEOUT_MS;
  const pollMs = input.pollMs ?? FHV_T4_BOUNDED_WAIT_DEFAULT_POLL_MS;
  const deadline = deps.nowMs() + timeoutMs;
  while (deps.nowMs() <= deadline) {
    const terminal = readFhvRehearsalTerminalClassification(input.runRoot);
    if (terminal === "REHEARSAL_OK") {
      return { classification: "REHEARSAL_OK" };
    }
    await deps.sleepMs(pollMs);
  }
  throw new FhvT4BoundedWaitError(
    "FHV_T4_WAIT_FINAL_TIMEOUT",
    "Timed out waiting for REHEARSAL_OK.",
  );
}
