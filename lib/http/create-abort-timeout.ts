/** Bounded fetch helper: abort after `ms`, with explicit cleanup for timers + duplicate abort safety. */

export function createAbortTimeout(ms: number): {
  signal: AbortSignal;
  /** Clears the pending timer without aborting an in-flight response body. */
  clearTimer: () => void;
  /** Clears the timer and aborts the signal (unmount / explicit cancellation). */
  cancel: () => void;
} {
  const controller = new AbortController();
  let cleared = false;
  const id = setTimeout(() => {
    if (!cleared) {
      controller.abort();
    }
  }, ms);
  const clearTimer = () => {
    cleared = true;
    clearTimeout(id);
  };
  return {
    signal: controller.signal,
    clearTimer,
    cancel: () => {
      clearTimer();
      controller.abort();
    },
  };
}
