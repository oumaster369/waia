export type HistoricalSimulationProductionCliConfigV2 = Readonly<{
  databaseUrl: string; organizationId: string; accountId: string; runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD"; symbol: "BTCUSDT" | "ETHUSDT";
  initialCycleSequence: number; terminalCycleSequenceExclusive: number;
}>;
type CliEnvironment = Readonly<Record<string, string | undefined>>;
function required(env: CliEnvironment, key: string): string {
  const value = env[key]?.trim(); if (!value) throw new Error(`HISTORICAL_SIMULATION_V2_CLI_REFUSED:${key}`); return value;
}
export function parseHistoricalSimulationProductionCliEnvV2(env: CliEnvironment): HistoricalSimulationProductionCliConfigV2 {
  const databaseUrl = env.DATABASE_URL_POSTGRES_SESSION?.trim() || env.DATABASE_URL_POSTGRES?.trim();
  if (!databaseUrl) throw new Error("HISTORICAL_SIMULATION_V2_CLI_REFUSED:DATABASE_URL_POSTGRES");
  const releaseSha = required(env, "WAIA_RELEASE_SHA").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error("HISTORICAL_SIMULATION_V2_CLI_REFUSED:WAIA_RELEASE_SHA");
  const partition = required(env, "WAIA_HISTORICAL_PARTITION");
  const symbol = required(env, "WAIA_HISTORICAL_SYMBOL");
  const sequence = Number(env.WAIA_HISTORICAL_INITIAL_CYCLE_SEQUENCE ?? "0");
  const terminalSequence = Number(required(env, "WAIA_HISTORICAL_TERMINAL_CYCLE_SEQUENCE"));
  if (!["DEVELOPMENT", "WALK_FORWARD"].includes(partition) || !["BTCUSDT", "ETHUSDT"].includes(symbol) ||
      !Number.isSafeInteger(sequence) || sequence < 0 ||
      !Number.isSafeInteger(terminalSequence) || terminalSequence < sequence) {
    throw new Error("HISTORICAL_SIMULATION_V2_CLI_REFUSED:CONFIG");
  }
  return Object.freeze({ databaseUrl, organizationId: required(env, "WAIA_HISTORICAL_ORGANIZATION_ID"),
    accountId: required(env, "WAIA_HISTORICAL_ACCOUNT_ID"), runId: required(env, "WAIA_HISTORICAL_RUN_ID"),
    partition: partition as "DEVELOPMENT" | "WALK_FORWARD", symbol: symbol as "BTCUSDT" | "ETHUSDT",
    initialCycleSequence: sequence, terminalCycleSequenceExclusive: terminalSequence });
}
