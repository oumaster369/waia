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
