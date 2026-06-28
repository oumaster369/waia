import { createAlertRouterSink } from "@/lib/observability/alerting/alert-router";

export type WatcherLogPayload = Record<string, unknown> & {
  event: "waia_payment_watcher";
  phase: string;
};

export type WatcherLogger = {
  log(payload: WatcherLogPayload): void;
};

const stdoutLineSink = createAlertRouterSink((line: string) => {
  console.log(line);
});

export function createStdoutWatcherLogger(): WatcherLogger {
  return {
    log(payload) {
      stdoutLineSink(JSON.stringify(payload));
    },
  };
}
