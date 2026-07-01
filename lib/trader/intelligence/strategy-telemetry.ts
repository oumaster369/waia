import {
  incrementTraderCounter,
  type WaiaTraderTelemetrySink,
} from "@/lib/observability/waia-trader-telemetry";
import {
  liquiditySweepReasonCodes,
  strategyReasonCodes,
  trendMomentumReasonCodes,
  type StrategySignal,
} from "@/lib/trader/intelligence/types";

export const STRATEGY_COUNTER_CODES = new Set<string>([
  ...Object.values(strategyReasonCodes),
  ...Object.values(liquiditySweepReasonCodes),
  ...Object.values(trendMomentumReasonCodes),
]);

function assertStrategyCounterCode(code: string): void {
  if (!STRATEGY_COUNTER_CODES.has(code)) {
    throw new Error(`[strategy-telemetry] invalid strategy counter code "${code}"`);
  }
}

export type EmitStrategyReasonCodeCounterInput = {
  organizationId: string;
  code: string;
};

export function emitStrategyReasonCodeCounter(
  input: EmitStrategyReasonCodeCounterInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  assertStrategyCounterCode(input.code);
  incrementTraderCounter(
    {
      organization_id: input.organizationId,
      domain: "strategy",
      code: input.code,
      delta: 1,
      severity: "info",
    },
    sink,
  );
}

export function emitStrategySignalCounters(
  signal: StrategySignal,
  sink?: WaiaTraderTelemetrySink,
): void {
  for (const code of signal.reasonCodes) {
    emitStrategyReasonCodeCounter({ organizationId: signal.organizationId, code }, sink);
  }
}
