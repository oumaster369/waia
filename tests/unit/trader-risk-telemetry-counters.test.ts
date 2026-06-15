import { describe, expect, it } from "vitest";

import { FORBIDDEN_TRADER_TELEMETRY_KEYS } from "@/lib/observability/waia-trader-telemetry";
import { tradeAbuseReasonCodes } from "@/lib/trader/risk/reason-codes";
import {
  emitKillSwitchDataQualityCounter,
  emitRiskReasonCodeCounter,
  KILL_SWITCH_DATA_QUALITY_COUNTER_CODE,
} from "@/lib/trader/risk/risk-telemetry";

const ORG_ID = "00000000-0000-4000-8000-000000000256";

function captureSink() {
  const lines: string[] = [];
  return {
    lines,
    sink: (line: string) => lines.push(line),
  };
}

function parseCounter(lines: string[]): Record<string, unknown> {
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

describe("risk-telemetry counters (DEE-256)", () => {
  it("emitRiskReasonCodeCounter emits risk domain counter with info severity", () => {
    const { lines, sink } = captureSink();
    emitRiskReasonCodeCounter(
      { organizationId: ORG_ID, code: tradeAbuseReasonCodes.symbolNotAllowed },
      sink,
    );

    expect(parseCounter(lines)).toMatchObject({
      event: "waia_trader_event",
      kind: "counter",
      organization_id: ORG_ID,
      outcome: "increment",
      domain: "risk",
      code: tradeAbuseReasonCodes.symbolNotAllowed,
      delta: 1,
      severity: "info",
    });
  });

  it("emitKillSwitchDataQualityCounter emits kill_switch critical counter", () => {
    const { lines, sink } = captureSink();
    emitKillSwitchDataQualityCounter({ organizationId: ORG_ID }, sink);

    expect(parseCounter(lines)).toMatchObject({
      event: "waia_trader_event",
      kind: "counter",
      organization_id: ORG_ID,
      outcome: "increment",
      domain: "kill_switch",
      code: KILL_SWITCH_DATA_QUALITY_COUNTER_CODE,
      delta: 1,
      severity: "critical",
    });
  });

  it("rejects invalid risk counter codes", () => {
    expect(() =>
      emitRiskReasonCodeCounter({ organizationId: ORG_ID, code: "RISK_OUTCOME_APPROVE" }),
    ).toThrow(/invalid risk counter code/);
  });

  it("emitted payloads never include forbidden telemetry keys", () => {
    const forbidden = new Set<string>([
      ...FORBIDDEN_TRADER_TELEMETRY_KEYS,
      "orderId",
      "order_id",
      "clientOrderId",
      "symbol",
    ]);

    const sinks = [
      () => {
        const { lines, sink } = captureSink();
        emitRiskReasonCodeCounter(
          { organizationId: ORG_ID, code: tradeAbuseReasonCodes.maxNotionalExceeded },
          sink,
        );
        return lines;
      },
      () => {
        const { lines, sink } = captureSink();
        emitKillSwitchDataQualityCounter({ organizationId: ORG_ID }, sink);
        return lines;
      },
    ];

    for (const emit of sinks) {
      const parsed = parseCounter(emit());
      for (const key of Object.keys(parsed)) {
        expect(forbidden.has(key)).toBe(false);
      }
    }
  });
});
