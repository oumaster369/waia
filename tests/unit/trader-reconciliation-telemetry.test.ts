import { describe, expect, it } from "vitest";

import { FORBIDDEN_TRADER_TELEMETRY_KEYS } from "@/lib/observability/waia-trader-telemetry";
import { emptyReconciliationCounts } from "@/lib/trader/execution/reconciliation.types";
import {
  CRITICAL_RECONCILIATION_CLASSIFICATIONS,
  buildReconciliationCountFields,
  emitReconciliationCriticalMismatch,
  emitReconciliationRunComplete,
  emitReconciliationStartupComplete,
  isCriticalReconciliationClassification,
} from "@/lib/trader/execution/reconciliation-telemetry";

const ORG_ID = "00000000-0000-4000-8000-000000000255";

const CANONICAL_COUNT_KEYS = [
  "count_in_sync",
  "count_venue_acked",
  "count_fill_progress",
  "count_venue_terminalized",
  "count_not_found_at_venue",
  "count_unknown_position",
  "count_ambiguous_stale",
  "count_terminal_drift",
  "count_skipped_conflict",
] as const;

function captureSink() {
  const lines: string[] = [];
  return {
    lines,
    sink: (line: string) => lines.push(line),
  };
}

describe("reconciliation-telemetry", () => {
  it("buildReconciliationCountFields emits all nine canonical keys", () => {
    const counts = emptyReconciliationCounts();
    counts.IN_SYNC = 2;
    counts.NOT_FOUND_AT_VENUE = 1;

    const fields = buildReconciliationCountFields(counts);
    for (const key of CANONICAL_COUNT_KEYS) {
      expect(fields).toHaveProperty(key);
      expect(typeof fields[key]).toBe("number");
    }
    expect(fields.count_in_sync).toBe(2);
    expect(fields.count_not_found_at_venue).toBe(1);
    expect(fields.count_unknown_position).toBe(0);
  });

  it("emitReconciliationRunComplete includes run_complete shape with open target", () => {
    const { lines, sink } = captureSink();
    const counts = emptyReconciliationCounts();
    counts.IN_SYNC = 3;

    emitReconciliationRunComplete(
      {
        organizationId: ORG_ID,
        target: { kind: "open", executionMode: "mock" },
        counts,
        durationMs: 42,
      },
      sink,
    );

    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      event: "waia_trader_event",
      kind: "reconciliation",
      organization_id: ORG_ID,
      outcome: "run_complete",
      severity: "info",
      duration_ms: 42,
      target_kind: "open",
      execution_mode: "mock",
      count_in_sync: 3,
    });
    for (const key of CANONICAL_COUNT_KEYS) {
      expect(parsed).toHaveProperty(key);
    }
    expect(parsed).not.toHaveProperty("orderId");
    expect(parsed).not.toHaveProperty("order_id");
  });

  it("emitReconciliationRunComplete omits execution_mode for order target", () => {
    const { lines, sink } = captureSink();
    emitReconciliationRunComplete(
      {
        organizationId: ORG_ID,
        target: { kind: "order", orderId: "00000000-0000-4000-8000-order-255" },
        counts: emptyReconciliationCounts(),
        durationMs: 1,
      },
      sink,
    );
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.target_kind).toBe("order");
    expect(parsed).not.toHaveProperty("execution_mode");
    expect(parsed).not.toHaveProperty("orderId");
  });

  it.each(CRITICAL_RECONCILIATION_CLASSIFICATIONS)(
    "emitReconciliationCriticalMismatch maps %s to critical severity",
    (classification) => {
      const { lines, sink } = captureSink();
      emitReconciliationCriticalMismatch(
        {
          organizationId: ORG_ID,
          classification,
          escalationKind: classification === "TERMINAL_DRIFT" ? "phantom_open" : undefined,
        },
        sink,
      );
      const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(parsed.outcome).toBe(classification);
      expect(parsed.severity).toBe("critical");
      expect(parsed.kind).toBe("reconciliation");
      expect(parsed).not.toHaveProperty("clientOrderId");
      expect(parsed).not.toHaveProperty("orderId");
    },
  );

  it("TERMINAL_DRIFT omits escalation_kind when not provided", () => {
    const { lines, sink } = captureSink();
    emitReconciliationCriticalMismatch(
      {
        organizationId: ORG_ID,
        classification: "TERMINAL_DRIFT",
      },
      sink,
    );
    expect(JSON.parse(lines[0]!)).not.toHaveProperty("escalation_kind");
  });

  it("TERMINAL_DRIFT includes escalation_kind when provided", () => {
    const { lines, sink } = captureSink();
    emitReconciliationCriticalMismatch(
      {
        organizationId: ORG_ID,
        classification: "TERMINAL_DRIFT",
        escalationKind: "terminal_fact_drift",
      },
      sink,
    );
    expect(JSON.parse(lines[0]!).escalation_kind).toBe("terminal_fact_drift");
  });

  it("isCriticalReconciliationClassification excludes informational classifications", () => {
    expect(isCriticalReconciliationClassification("IN_SYNC")).toBe(false);
    expect(isCriticalReconciliationClassification("VENUE_ACKED")).toBe(false);
    expect(isCriticalReconciliationClassification("FILL_PROGRESS")).toBe(false);
    expect(isCriticalReconciliationClassification("VENUE_TERMINALIZED")).toBe(false);
    expect(isCriticalReconciliationClassification("SKIPPED_CONFLICT")).toBe(false);
    expect(isCriticalReconciliationClassification("NOT_FOUND_AT_VENUE")).toBe(true);
  });

  it("emitReconciliationStartupComplete emits aggregate startup_complete shape", () => {
    const { lines, sink } = captureSink();
    const counts = emptyReconciliationCounts();
    counts.NOT_FOUND_AT_VENUE = 1;

    emitReconciliationStartupComplete(
      {
        organizationId: ORG_ID,
        executionMode: "paper",
        counts,
        durationMs: 99,
        escalationsAttempted: 1,
      },
      sink,
    );

    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      event: "waia_trader_event",
      kind: "reconciliation",
      organization_id: ORG_ID,
      outcome: "startup_complete",
      severity: "info",
      duration_ms: 99,
      execution_mode: "paper",
      escalations_attempted: 1,
      count_not_found_at_venue: 1,
    });
    for (const key of CANONICAL_COUNT_KEYS) {
      expect(parsed).toHaveProperty(key);
    }
    expect(parsed).not.toHaveProperty("orderId");
  });

  it("emitted payloads never include forbidden telemetry keys", () => {
    const forbidden = new Set<string>([
      ...FORBIDDEN_TRADER_TELEMETRY_KEYS,
      "orderId",
      "order_id",
      "clientOrderId",
      "exchange_order_id",
      "trade_id",
      "tradeId",
      "symbol",
      "quantity",
      "price",
    ]);
    const counts = emptyReconciliationCounts();
    counts.TERMINAL_DRIFT = 1;

    const sinks = [
      () => {
        const { lines, sink } = captureSink();
        emitReconciliationRunComplete(
          {
            organizationId: ORG_ID,
            target: { kind: "open", executionMode: "mock" },
            counts,
            durationMs: 1,
          },
          sink,
        );
        return lines;
      },
      () => {
        const { lines, sink } = captureSink();
        emitReconciliationCriticalMismatch(
          {
            organizationId: ORG_ID,
            classification: "TERMINAL_DRIFT",
            escalationKind: "phantom_open",
          },
          sink,
        );
        return lines;
      },
      () => {
        const { lines, sink } = captureSink();
        emitReconciliationStartupComplete(
          {
            organizationId: ORG_ID,
            executionMode: "mock",
            counts,
            durationMs: 1,
            escalationsAttempted: 1,
          },
          sink,
        );
        return lines;
      },
    ];

    for (const emit of sinks) {
      const parsed = JSON.parse(emit()[0]!) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) {
        expect(forbidden.has(key)).toBe(false);
      }
    }
  });
});
