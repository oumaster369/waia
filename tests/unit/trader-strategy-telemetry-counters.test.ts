import { describe, expect, it } from "vitest";

import { FORBIDDEN_TRADER_TELEMETRY_KEYS } from "@/lib/observability/waia-trader-telemetry";
import {
  emitStrategyReasonCodeCounter,
  emitStrategySignalCounters,
  STRATEGY_COUNTER_CODES,
} from "@/lib/trader/intelligence/strategy-telemetry";
import {
  liquiditySweepReasonCodes,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  strategyReasonCodes,
  type StrategySignal,
} from "@/lib/trader/intelligence/types";

const ORG_ID = "00000000-0000-4000-8000-000000000258";

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

function mockStrategySignal(reasonCodes: readonly string[]): StrategySignal {
  return {
    strategySignalId: "signal-258-test",
    strategyId: MEAN_REVERSION_V0,
    strategyVersion: MEAN_REVERSION_V0_VERSION,
    organizationId: ORG_ID,
    symbol: "BTC/USDT",
    outcome: reasonCodes[0] === strategyReasonCodes.zscoreBuy ? "SIGNAL" : "NO_SIGNAL",
    reasonCodes,
    msvId: "msv-258-test",
    featureSetId: "feature-set-258-test",
    evaluatedAt: "2026-01-01T00:25:00.000Z",
  };
}

describe("strategy-telemetry counters (DEE-258)", () => {
  it("STRATEGY_COUNTER_CODES matches all strategy reason code values", () => {
    const allCodes = [
      ...Object.values(strategyReasonCodes),
      ...Object.values(liquiditySweepReasonCodes),
    ];
    expect(STRATEGY_COUNTER_CODES.size).toBe(allCodes.length);
    for (const code of allCodes) {
      expect(STRATEGY_COUNTER_CODES.has(code)).toBe(true);
    }
  });

  it.each([...Object.values(strategyReasonCodes), ...Object.values(liquiditySweepReasonCodes)])(
    "emitStrategyReasonCodeCounter emits strategy domain counter for %s",
    (code) => {
      const { lines, sink } = captureSink();
      emitStrategyReasonCodeCounter({ organizationId: ORG_ID, code }, sink);

      expect(parseCounter(lines)).toMatchObject({
        event: "waia_trader_event",
        kind: "counter",
        organization_id: ORG_ID,
        outcome: "increment",
        domain: "strategy",
        code,
        delta: 1,
        severity: "info",
      });
    },
  );

  it("rejects invalid strategy counter codes", () => {
    expect(() =>
      emitStrategyReasonCodeCounter({ organizationId: ORG_ID, code: "RISK_OUTCOME_APPROVE" }),
    ).toThrow(/\[strategy-telemetry\] invalid strategy counter code/);
  });

  it("emitStrategySignalCounters emits one counter per reason code", () => {
    const { lines, sink } = captureSink();
    emitStrategySignalCounters(
      mockStrategySignal([strategyReasonCodes.zscoreBuy, strategyReasonCodes.zscoreNeutral]),
      sink,
    );

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).code).toBe(strategyReasonCodes.zscoreBuy);
    expect(JSON.parse(lines[1]!).code).toBe(strategyReasonCodes.zscoreNeutral);
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
        emitStrategyReasonCodeCounter(
          { organizationId: ORG_ID, code: strategyReasonCodes.zscoreBuy },
          sink,
        );
        return lines;
      },
      () => {
        const { lines, sink } = captureSink();
        emitStrategySignalCounters(
          mockStrategySignal([strategyReasonCodes.permissionBlocked]),
          sink,
        );
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
