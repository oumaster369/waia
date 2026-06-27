import {
  incrementTraderCounter,
  type WaiaTraderTelemetrySink,
} from "@/lib/observability/waia-trader-telemetry";
import { cdeReasonCodes, type MsvEnvelope } from "@/lib/trader/intelligence/types";

export const DECISION_COUNTER_CODES = new Set<string>(Object.values(cdeReasonCodes));

function assertDecisionCounterCode(code: string): void {
  if (!DECISION_COUNTER_CODES.has(code)) {
    throw new Error(`[decision-telemetry] invalid decision counter code "${code}"`);
  }
}

export type EmitDecisionReasonCodeCounterInput = {
  organizationId: string;
  code: string;
};

export function emitDecisionReasonCodeCounter(
  input: EmitDecisionReasonCodeCounterInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  assertDecisionCounterCode(input.code);
  incrementTraderCounter(
    {
      organization_id: input.organizationId,
      domain: "decision",
      code: input.code,
      delta: 1,
      severity: "info",
    },
    sink,
  );
}

export function emitMsvDecisionCounters(
  msv: MsvEnvelope,
  organizationId: string,
  sink?: WaiaTraderTelemetrySink,
): void {
  const codes = msv.derived.reasonCodes;

  if (codes == null) {
    return;
  }

  if (!Array.isArray(codes)) {
    throw new Error("[decision-telemetry] malformed reasonCodes");
  }

  if (codes.length === 0) {
    return;
  }

  for (const code of codes) {
    if (typeof code !== "string") {
      throw new Error("[decision-telemetry] malformed reason code entry");
    }
    emitDecisionReasonCodeCounter({ organizationId, code }, sink);
  }
}
