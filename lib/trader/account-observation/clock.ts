import type { ObservationClock } from "./types";

/** No timer survives an aborted wait. Shared by the collector and scheduler. */
export const accountObservationClock: ObservationClock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer); signal.removeEventListener("abort", abort);
        reject(new Error("OBSERVATION_WAIT_ABORTED"));
      };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  },
};
