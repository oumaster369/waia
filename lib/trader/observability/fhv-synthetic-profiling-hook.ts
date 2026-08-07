/**
 * Explicit synthetic-scale profiling hook (default off).
 * When unset, the official launch path is unchanged (NOOP observer).
 * Measurement-only — must not alter economic/evidence semantics.
 */
import type { ReplayBenchmarkObserver } from "@/lib/trader/backtest/replay-benchmark-instrumentation";

export type FhvSyntheticProfilingMode = "P0" | "P1" | "P2" | "P3" | "P4" | "P5";

export type FhvSyntheticProfilingHooks = Readonly<{
  mode: FhvSyntheticProfilingMode;
  observer?: ReplayBenchmarkObserver;
  onCycle?: (input: { cycleCount: number; cycleIndex: number }) => void;
}>;

let activeHooks: FhvSyntheticProfilingHooks | null = null;

export function setFhvSyntheticProfilingHooks(hooks: FhvSyntheticProfilingHooks | null): void {
  activeHooks = hooks;
}

export function getFhvSyntheticProfilingHooks(): FhvSyntheticProfilingHooks | null {
  return activeHooks;
}

export function clearFhvSyntheticProfilingHooks(): void {
  activeHooks = null;
}
