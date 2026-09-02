export type HistoricalSimulationBootstrapCliConfigV2 = Readonly<{
  databaseUrl: string;
  releaseSha: string;
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  datasetRoot: string;
  qualificationReceiptPath: string;
  runtimeRequalificationReceiptPath: string;
  htxVolumeQualificationReceiptPath: string;
  initialRecordIndex: number;
  cycleCount: number;
}>;

const SHA = /^[0-9a-f]{40}$/;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:${name}`);
  return value;
}

function safeInteger(value: string, name: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:${name}`);
  }
  return parsed;
}

/** Fail-closed operator configuration. Blind holdout and unbounded preparation are not representable. */
export function parseHistoricalSimulationBootstrapCliEnvV2(
  env: NodeJS.ProcessEnv,
): HistoricalSimulationBootstrapCliConfigV2 {
  const releaseSha = required(env, "WAIA_RELEASE_SHA").toLowerCase();
  const partition = required(env, "WAIA_HISTORICAL_PARTITION");
  const symbol = required(env, "WAIA_HISTORICAL_SYMBOL");
  const initialRecordIndex = safeInteger(env.WAIA_HISTORICAL_INITIAL_RECORD_INDEX ?? "0",
    "WAIA_HISTORICAL_INITIAL_RECORD_INDEX", 0);
  const cycleCount = safeInteger(required(env, "WAIA_HISTORICAL_BOOTSTRAP_CYCLE_COUNT"),
    "WAIA_HISTORICAL_BOOTSTRAP_CYCLE_COUNT", 1);
  if (!SHA.test(releaseSha)) throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:WAIA_RELEASE_SHA");
  if (partition !== "DEVELOPMENT" && partition !== "WALK_FORWARD") {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:WAIA_HISTORICAL_PARTITION");
  }
  if (symbol !== "BTCUSDT" && symbol !== "ETHUSDT") {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:WAIA_HISTORICAL_SYMBOL");
  }
  if (cycleCount > 10_000) {
    throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:WAIA_HISTORICAL_BOOTSTRAP_CYCLE_COUNT");
  }
  const databaseUrl = env.DATABASE_URL_POSTGRES_SESSION?.trim() || env.DATABASE_URL_POSTGRES?.trim();
  if (!databaseUrl) throw new Error("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:DATABASE_URL_POSTGRES_SESSION");
  return Object.freeze({
    databaseUrl,
    releaseSha,
    organizationId: required(env, "WAIA_HISTORICAL_ORGANIZATION_ID"),
    accountId: required(env, "WAIA_HISTORICAL_ACCOUNT_ID"),
    runId: required(env, "WAIA_HISTORICAL_RUN_ID"),
    partition,
    symbol,
    datasetRoot: required(env, "FHV_DATASET_ROOT"),
    qualificationReceiptPath: required(env, "FHV_PRE_HOLDOUT_QUALIFICATION_RECEIPT_PATH"),
    runtimeRequalificationReceiptPath: required(env, "FHV_RUNTIME_REQUALIFICATION_RECEIPT_PATH"),
    htxVolumeQualificationReceiptPath: required(env, "FHV_HTX_VOLUME_QUALIFICATION_RECEIPT_PATH"),
    initialRecordIndex,
    cycleCount,
  });
}
