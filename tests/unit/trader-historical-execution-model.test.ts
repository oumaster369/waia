import { describe, expect, it } from "vitest";

import {
  assertModelMatchesD5,
  createHistoricalExecutionModelV1,
  InvalidHistoricalExecutionModelError,
} from "@/lib/trader/execution/historical-execution-model";
import {
  EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
  HISTORICAL_EXECUTION_MODEL_ID,
  HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
} from "@/lib/trader/execution/historical-execution-model.types";
import { bindHistoricalExecutionModelToSession } from "@/lib/trader/backtest/historical-execution-profile";

describe("HTR-WP17 historical execution model (D-5 binding)", () => {
  it("binds approved D-5 economics and window parameters", () => {
    const model = createHistoricalExecutionModelV1();

    expect(model.modelId).toBe(HISTORICAL_EXECUTION_MODEL_ID);
    expect(model.schemaVersion).toBe(HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION);
    expect(model.takerFeeBps).toBe("20");
    expect(model.makerFeeBps).toBe("20");
    expect(model.halfSpreadBpsPerSide).toBe("5");
    expect(model.impactValueBps).toBe("10");
    expect(model.participationCapFraction).toBe("0.10");
    expect(model.maxEligibleClosedBars).toBe(3);
    expect(model.firstEligibleBar).toBe("N+1");
    expect(model.executionFactKind).toBe(EXECUTION_FACT_KIND_HISTORICAL_SIMULATED);
    expect(model.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(model.rounding).toBe("ROUND_HALF_UP");
    expect(model.decimalScale).toBe(8);
  });

  it("assertModelMatchesD5 accepts the canonical model", () => {
    const model = createHistoricalExecutionModelV1();
    expect(() => assertModelMatchesD5(model)).not.toThrow();
  });

  it("assertModelMatchesD5 rejects drift from approved D-5", () => {
    const model = createHistoricalExecutionModelV1();
    const drifted = { ...model, takerFeeBps: "21" };
    expect(() => assertModelMatchesD5(drifted)).toThrow(InvalidHistoricalExecutionModelError);
  });

  it("session profile binds model and exchange from D-5 factory", () => {
    const profile = bindHistoricalExecutionModelToSession();
    expect(() => assertModelMatchesD5(profile.model)).not.toThrow();
    expect(profile.exchange).toBeDefined();
    expect(profile.exchange.registerOrder).toBeTypeOf("function");
    expect(profile.exchange.advanceOnClosedBar).toBeTypeOf("function");
  });
});
