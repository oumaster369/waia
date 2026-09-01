import { describe, expect, it } from "vitest";
import { parseHistoricalSimulationBootstrapCliEnvV2 } from
  "@/lib/trader/historical-simulation-v2/bootstrap-cli-config-v2";

const valid = {
  NODE_ENV: "test",
  DATABASE_URL_POSTGRES_SESSION: "postgres://runner@db/waia",
  WAIA_RELEASE_SHA: "a".repeat(40),
  WAIA_HISTORICAL_ORGANIZATION_ID: "org",
  WAIA_HISTORICAL_ACCOUNT_ID: "account",
  WAIA_HISTORICAL_RUN_ID: "run",
  WAIA_HISTORICAL_PARTITION: "DEVELOPMENT",
  WAIA_HISTORICAL_SYMBOL: "BTCUSDT",
  FHV_DATASET_ROOT: "/dataset",
  FHV_PRE_HOLDOUT_QUALIFICATION_RECEIPT_PATH: "/dataset/qualification.json",
  FHV_RUNTIME_REQUALIFICATION_RECEIPT_PATH: "/dataset/runtime.json",
  WAIA_HISTORICAL_BOOTSTRAP_CYCLE_COUNT: "2",
} as NodeJS.ProcessEnv;

describe("Historical Simulation V2 bootstrap CLI config", () => {
  it("accepts a bounded pre-holdout preparation", () => {
    expect(parseHistoricalSimulationBootstrapCliEnvV2(valid)).toMatchObject({
      partition: "DEVELOPMENT", symbol: "BTCUSDT", initialRecordIndex: 0, cycleCount: 2,
    });
  });

  it.each([
    { WAIA_RELEASE_SHA: "bad" },
    { WAIA_HISTORICAL_PARTITION: "BLIND_HOLDOUT" },
    { WAIA_HISTORICAL_SYMBOL: "DOGEUSDT" },
    { FHV_RUNTIME_REQUALIFICATION_RECEIPT_PATH: "" },
    { WAIA_HISTORICAL_BOOTSTRAP_CYCLE_COUNT: "0" },
    { WAIA_HISTORICAL_BOOTSTRAP_CYCLE_COUNT: "10001" },
    { WAIA_HISTORICAL_INITIAL_RECORD_INDEX: "-1" },
  ])("rejects unsafe or incomplete configuration %#", (patch) => {
    expect(() => parseHistoricalSimulationBootstrapCliEnvV2({ ...valid, ...patch }))
      .toThrow("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED");
  });
});
