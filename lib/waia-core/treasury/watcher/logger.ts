export type TreasuryWatcherLogPayload = Record<string, unknown> & {
  event: "waia_treasury_watcher";
  phase: string;
};

export type TreasuryWatcherLogger = {
  log(payload: TreasuryWatcherLogPayload): void;
};

export function createStdoutTreasuryWatcherLogger(): TreasuryWatcherLogger {
  return {
    log(payload) {
      console.log(JSON.stringify(payload));
    },
  };
}

export function createSilentTreasuryWatcherLogger(): TreasuryWatcherLogger {
  return { log() {} };
}
