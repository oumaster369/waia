export type WatcherLogPayload = Record<string, unknown> & {
  event: "waia_payment_watcher";
  phase: string;
};

export type WatcherLogger = {
  log(payload: WatcherLogPayload): void;
};

/** Cron-safe stdout logger (avoid alert-router sink interop in workerd bundles). */
export function createStdoutWatcherLogger(): WatcherLogger {
  return {
    log(payload) {
      console.log(JSON.stringify(payload));
    },
  };
}
