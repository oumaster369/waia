/** Bounded fetch helper: abort after `ms`, with explicit cleanup for timers + duplicate abort safety. */

export function createAbortTimeout(ms: number): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(id);
      controller.abort();
    },
  };
}
