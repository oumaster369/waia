import type { ObservationBinding, ObservationClock, ObservationTickResult } from "./types";
import { observationBindingSchema } from "./validation";

/** Explicitly awaited runtime port. No import-time startup, browser timer, credentials or venue methods.
 * Assignments must be pre-authorized, bounded and current; repository still fences every tick.
 */
export function createObservationScheduler(deps: Readonly<{
  loadAssignments(signal: AbortSignal): Promise<readonly ObservationBinding[]>;
  tick(binding: ObservationBinding, signal: AbortSignal): Promise<ObservationTickResult>;
  clock: ObservationClock;
  report(event: "COLLECTION_FAILED" | "ASSIGNMENTS_FAILED" | "COLLECTION_COMMITTED"): void;
}>, options: Readonly<{ intervalMs: number; iterationTimeoutMs: number; maxAccounts: number }>) {
  if (![options.intervalMs, options.iterationTimeoutMs, options.maxAccounts].every(n => Number.isSafeInteger(n) && n > 0) ||
    options.intervalMs < 1000 || options.maxAccounts > 100 || options.iterationTimeoutMs > 3600000)
    throw new Error("ACCOUNT_OBSERVATION_INVALID_SCHEDULER");
  let running = false;
  // Preserve the interrupted account across bounded sweeps; never cache its authority/config.
  let resumeKey: string | null = null;
  const accountKey = (b: ObservationBinding) => JSON.stringify([b.organizationId, b.credentialId, b.exchangeAccountId]);
  const report = (event: Parameters<typeof deps.report>[0]) => {
    try { deps.report(event); } catch { /* Observer diagnostics cannot restart or authorize collection. */ }
  };
  return {
    async run(signal: AbortSignal): Promise<void> {
      if (running) throw new Error("ACCOUNT_OBSERVATION_SCHEDULER_ALREADY_RUNNING");
      running = true;
      try {
        while (!signal.aborted) {
          const cycle = new AbortController();
          const cancel = () => cycle.abort();
          signal.addEventListener("abort", cancel, { once: true });
          let timedOut = false;
          const expired = deps.clock.sleep(options.iterationTimeoutMs, cycle.signal)
            .then(() => { timedOut = true; cycle.abort(); }).catch(() => {});
          try {
            // Fail-stop if a dependency ignores cancellation: do not launch overlapping cycles.
            const bindings = await deps.loadAssignments(cycle.signal);
            if (bindings.length > options.maxAccounts) throw new Error("ASSIGNMENT_LIMIT");
            const seen = new Set<string>();
            const current: ObservationBinding[] = [];
            for (const raw of bindings) {
              const b = observationBindingSchema.parse(raw);
              const key = accountKey(b);
              if (seen.has(key)) continue;
              seen.add(key); current.push(b);
            }
            // Removed/replaced bindings cannot be revived by a stale continuation pointer.
            const start = Math.max(0, current.findIndex(b => accountKey(b) === resumeKey));
            for (let offset = 0; offset < current.length; offset++) {
              if (signal.aborted || cycle.signal.aborted) break;
              const index = (start + offset) % current.length;
              const b = current[index];
              resumeKey = accountKey(b);
              try {
                const result = await deps.tick(b, cycle.signal);
                if (result.status === "COMMITTED") report("COLLECTION_COMMITTED");
              } catch { report("COLLECTION_FAILED"); }
              // A timed-out tick receives a full first turn next sweep; completed/failed
              // non-aborted work advances fairly without starting overlapping dependencies.
              if (!signal.aborted && !cycle.signal.aborted)
                resumeKey = accountKey(current[(index + 1) % current.length]);
            }
            if (timedOut) report("COLLECTION_FAILED");
          } catch { report("ASSIGNMENTS_FAILED"); }
          finally {
            signal.removeEventListener("abort", cancel);
            cycle.abort();
            await expired;
          }
          if (!signal.aborted) await deps.clock.sleep(options.intervalMs, signal).catch(() => {});
        }
      } finally { running = false; }
    },
  };
}
