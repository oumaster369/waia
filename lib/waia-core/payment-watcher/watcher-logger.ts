export type WatcherLogPayload = Record<string, unknown> & {
  event: "waia_payment_watcher";
  phase: string;
};

export type WatcherLogger = {
  log(payload: WatcherLogPayload): void;
};

export function createStdoutWatcherLogger(): WatcherLogger {
  return {
    log(payload) {
      console.log(JSON.stringify(payload));
    },
  };
}
