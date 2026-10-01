import { describe, expect, it } from "vitest";

import type { SubmitOrderResult } from "@/lib/trader/execution/execution-service.types";
import {
  emitExecutionTerminalEvent,
  emitExecutionTransitionEvent,
  emitUnresolvedExecutionAttemptV2,
} from "@/lib/trader/execution/execution-telemetry";

const ORG_ID = "00000000-0000-4000-8000-000000000254";

function captureSink() {
  const lines: string[] = [];
  return {
    lines,
    sink: (line: string) => lines.push(line),
  };
}

describe("execution-telemetry", () => {
  it("emitExecutionTerminalEvent maps each SubmitOrderResult status to outcome", () => {
    const cases: SubmitOrderResult[] = [
      { status: "risk_rejected", riskDecision: {} as never, order: null },
      { status: "submitted", order: {} as never },
      { status: "submit_blocked", order: {} as never, reason: "kill_switch" },
      { status: "connector_uncertain", order: {} as never },
      { status: "conflict", orderId: "00000000-0000-4000-8000-order-conflict" },
    ];

    for (const result of cases) {
      const { lines, sink } = captureSink();
      emitExecutionTerminalEvent(
        {
          organizationId: ORG_ID,
          executionMode: "mock",
          result,
          durationMs: 7,
        },
        sink,
      );
      const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(parsed.outcome).toBe(result.status);
      expect(parsed.kind).toBe("execution");
      expect(parsed.execution_mode).toBe("mock");
      expect(parsed.duration_ms).toBe(7);
    }
  });

  it("conflict terminal uses severity critical and omits orderId", () => {
    const { lines, sink } = captureSink();
    emitExecutionTerminalEvent(
      {
        organizationId: ORG_ID,
        executionMode: "paper",
        result: { status: "conflict", orderId: "00000000-0000-4000-8000-order-conflict" },
        durationMs: 3,
      },
      sink,
    );
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.severity).toBe("critical");
    expect(parsed.outcome).toBe("conflict");
    expect(parsed).not.toHaveProperty("orderId");
    expect(parsed).not.toHaveProperty("order_id");
  });

  it("non-conflict terminal outcomes use severity info", () => {
    const { lines, sink } = captureSink();
    emitExecutionTerminalEvent(
      {
        organizationId: ORG_ID,
        executionMode: "mock",
        result: { status: "submitted", order: {} as never },
        durationMs: 1,
      },
      sink,
    );
    expect(JSON.parse(lines[0]!).severity).toBe("info");
  });

  it("submit_blocked includes block_reason kill_switch", () => {
    const { lines, sink } = captureSink();
    emitExecutionTerminalEvent(
      {
        organizationId: ORG_ID,
        executionMode: "mock",
        result: { status: "submit_blocked", order: {} as never, reason: "kill_switch" },
        durationMs: 2,
      },
      sink,
    );
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.block_reason).toBe("kill_switch");
  });

  it("emitExecutionTransitionEvent emits state_transition shape", () => {
    const { lines, sink } = captureSink();
    emitExecutionTransitionEvent(
      {
        organizationId: ORG_ID,
        fromState: "RISK_APPROVED",
        toState: "SENT_TO_EXCHANGE",
        executionMode: "mock",
      },
      sink,
    );
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      event: "waia_trader_event",
      kind: "execution",
      organization_id: ORG_ID,
      outcome: "state_transition",
      severity: "info",
      from_state: "RISK_APPROVED",
      to_state: "SENT_TO_EXCHANGE",
      execution_mode: "mock",
    });
    expect(parsed.duration_ms).toBeUndefined();
  });

  it("emitUnresolvedExecutionAttemptV2 names the attempt and keeps secrets out", () => {
    const { lines, sink } = captureSink();
    emitUnresolvedExecutionAttemptV2(
      {
        organizationId: ORG_ID,
        executionAttemptId: "00000000-0000-4000-8000-000000000901",
        outcome: "CONNECTOR_UNCERTAIN",
      },
      sink,
    );
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed).toEqual({
      event: "waia_trader_event",
      kind: "execution",
      organization_id: ORG_ID,
      outcome: "CONNECTOR_UNCERTAIN",
      severity: "critical",
      execution_attempt_id: "00000000-0000-4000-8000-000000000901",
    });
    expect(parsed).not.toHaveProperty("secret");
    expect(parsed).not.toHaveProperty("client_order_id");
    expect(parsed).not.toHaveProperty("quantity");
    expect(parsed).not.toHaveProperty("price");
    expect(parsed).not.toHaveProperty("message");

    const reconciliation = captureSink();
    emitUnresolvedExecutionAttemptV2(
      {
        organizationId: ORG_ID,
        executionAttemptId: "00000000-0000-4000-8000-000000000902",
        outcome: "RECONCILIATION_REQUIRED",
      },
      reconciliation.sink,
    );
    expect(JSON.parse(reconciliation.lines[0]!).outcome).toBe("RECONCILIATION_REQUIRED");
  });
});
