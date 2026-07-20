import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import type { HistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model.types";
import {
  bindHistoricalSimulatedExchange,
  type HistoricalSimulatedExchange,
} from "@/lib/trader/execution/historical-simulated-exchange";

export const HTR_HISTORICAL_EXECUTION_PROFILE_V1 = "htr-historical-execution-profile/v1" as const;

export type HistoricalExecutionProfileV1 = {
  profileId: typeof HTR_HISTORICAL_EXECUTION_PROFILE_V1;
  model: HistoricalExecutionModelV1;
  exchange: HistoricalSimulatedExchange;
};

export function bindHistoricalExecutionModelToSession(): HistoricalExecutionProfileV1 {
  const model = createHistoricalExecutionModelV1();
  return {
    profileId: HTR_HISTORICAL_EXECUTION_PROFILE_V1,
    model,
    exchange: bindHistoricalSimulatedExchange(model),
  };
}

const HISTORICAL_EXECUTION_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT"]);

/** Maps canonical research instrument ids to WP17 execution symbols. */
export function normalizeSymbolForHistoricalExecution(symbol: string): "BTCUSDT" | "ETHUSDT" {
  const normalized = symbol.includes("/") ? symbol.replace("/", "") : symbol;
  if (HISTORICAL_EXECUTION_SYMBOLS.has(normalized)) {
    return normalized as "BTCUSDT" | "ETHUSDT";
  }
  throw new Error(`[htr/wp17] unsupported historical execution symbol: ${symbol}`);
}
