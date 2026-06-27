export type SettlementLogger = {
  log(payload: Record<string, unknown>): void;
};

export function createStdoutSettlementLogger(): SettlementLogger {
  return {
    log(payload) {
      console.log(JSON.stringify(payload));
    },
  };
}
