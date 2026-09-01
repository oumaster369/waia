import { describe, expect, it } from "vitest";
import { parseHistoricalSimulationProductionCliEnvV2 } from
  "@/lib/trader/historical-simulation-v2/production-runner-cli-config-v2";
const safe = { DATABASE_URL_POSTGRES: "postgresql://example/db", WAIA_RELEASE_SHA: "a".repeat(40),
  WAIA_HISTORICAL_ORGANIZATION_ID: "org", WAIA_HISTORICAL_ACCOUNT_ID: "acct", WAIA_HISTORICAL_RUN_ID: "run",
  WAIA_HISTORICAL_PARTITION: "DEVELOPMENT", WAIA_HISTORICAL_SYMBOL: "BTCUSDT",
  WAIA_HISTORICAL_TERMINAL_CYCLE_SEQUENCE: "2" };
describe("Historical Simulation V2 runner CLI config", () => {
  it("prefers the session URL and parses the closed scope", () => {
    expect(parseHistoricalSimulationProductionCliEnvV2({ ...safe, DATABASE_URL_POSTGRES_SESSION: "postgresql://session/db" }))
      .toMatchObject({ databaseUrl: "postgresql://session/db", partition: "DEVELOPMENT", initialCycleSequence: 0,
        terminalCycleSequenceExclusive: 2 });
  });
  it.each([{ WAIA_RELEASE_SHA: "bad" }, { WAIA_HISTORICAL_PARTITION: "BLIND_HOLDOUT" },
    { WAIA_HISTORICAL_SYMBOL: "DOGEUSDT" }, { DATABASE_URL_POSTGRES: "" },
    { WAIA_HISTORICAL_TERMINAL_CYCLE_SEQUENCE: "NaN" }])("rejects unsafe env %#", (patch) => {
    expect(() => parseHistoricalSimulationProductionCliEnvV2({ ...safe, ...patch })).toThrow("CLI_REFUSED");
  });
});
