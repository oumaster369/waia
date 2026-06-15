import {
  incrementTraderCounter,
  type WaiaTraderTelemetrySink,
} from "@/lib/observability/waia-trader-telemetry";
import { riskReasonCodes, type RiskReasonCode } from "@/lib/trader/risk/reason-codes";

export const RISK_COUNTER_CODES = new Set<string>(Object.values(riskReasonCodes));

export const KILL_SWITCH_DATA_QUALITY_COUNTER_CODE = "auto:data_quality" as const;

function assertRiskCounterCode(code: string): asserts code is RiskReasonCode {
  if (!RISK_COUNTER_CODES.has(code)) {
    throw new Error(`[risk-telemetry] invalid risk counter code "${code}"`);
  }
}

export type EmitRiskReasonCodeCounterInput = {
  organizationId: string;
  code: string;
};

export type EmitKillSwitchDataQualityCounterInput = {
  organizationId: string;
};

export function emitRiskReasonCodeCounter(
  input: EmitRiskReasonCodeCounterInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  assertRiskCounterCode(input.code);
  incrementTraderCounter(
    {
      organization_id: input.organizationId,
      domain: "risk",
      code: input.code,
      delta: 1,
      severity: "info",
    },
    sink,
  );
}

export function emitKillSwitchDataQualityCounter(
  input: EmitKillSwitchDataQualityCounterInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  incrementTraderCounter(
    {
      organization_id: input.organizationId,
      domain: "kill_switch",
      code: KILL_SWITCH_DATA_QUALITY_COUNTER_CODE,
      delta: 1,
      severity: "critical",
    },
    sink,
  );
}
