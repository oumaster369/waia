import {
  emitTraderTelemetry,
  type WaiaTraderTelemetrySink,
} from "@/lib/observability/waia-trader-telemetry";
import type { SubmitOrderResult } from "@/lib/trader/execution/execution-service.types";
import type { OrderExecutionMode, OrderState } from "@/lib/trader/execution/types";

export type ExecutionTerminalEventInput = {
  organizationId: string;
  executionMode: OrderExecutionMode;
  result: SubmitOrderResult;
  durationMs: number;
};

export type ExecutionTransitionEventInput = {
  organizationId: string;
  fromState: OrderState;
  toState: OrderState;
  executionMode: OrderExecutionMode;
};

function terminalSeverity(result: SubmitOrderResult): "info" | "critical" {
  return result.status === "conflict" ? "critical" : "info";
}

export function emitExecutionTerminalEvent(
  input: ExecutionTerminalEventInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  const payload: Parameters<typeof emitTraderTelemetry>[0] = {
    event: "waia_trader_event",
    kind: "execution",
    organization_id: input.organizationId,
    outcome: input.result.status,
    severity: terminalSeverity(input.result),
    duration_ms: input.durationMs,
    execution_mode: input.executionMode,
  };

  if (input.result.status === "submit_blocked") {
    payload.block_reason = input.result.reason;
  }

  emitTraderTelemetry(payload, sink);
}

export function emitExecutionTransitionEvent(
  input: ExecutionTransitionEventInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  emitTraderTelemetry(
    {
      event: "waia_trader_event",
      kind: "execution",
      organization_id: input.organizationId,
      outcome: "state_transition",
      severity: "info",
      from_state: input.fromState,
      to_state: input.toState,
      execution_mode: input.executionMode,
    },
    sink,
  );
}
