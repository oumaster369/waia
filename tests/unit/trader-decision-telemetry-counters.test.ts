import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FORBIDDEN_TRADER_TELEMETRY_KEYS } from "@/lib/observability/waia-trader-telemetry";
import {
  DECISION_COUNTER_CODES,
  emitDecisionReasonCodeCounter,
  emitMsvDecisionCounters,
} from "@/lib/trader/intelligence/decision-telemetry";
import { cdeReasonCodes, type MsvEnvelope } from "@/lib/trader/intelligence/types";

const ORG_ID = "00000000-0000-4000-8000-000000000259";

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

function mockMsv(reasonCodes: unknown): MsvEnvelope {
  return {
    msvId: "msv-259-test",
    instrumentId: "BTC/USDT",
    evaluatedAt: "2026-01-01T00:25:00.000Z",
    featureSetId: "feature-set-259-test",
    physics: { close: "64000", zscoreVsSma20: "-2.5", realizedVol20: "300" },
    liquidity: { spreadBps: "1.5" },
    crowd: { fearGreedIndex: null, newsSentiment: "0" },
    futureContext: { eventRiskScore: "0" },
    derived: {
      regime: "TREND_BEAR",
      tradingPermission: "ALLOW_TRADING",
      allowedStrategyIds: ["mean_reversion_v0"],
      riskMultiplier: "1.0",
      dataQualityScore: 0.9,
      reasonCodes: reasonCodes as readonly string[],
    },
  };
}

describe("decision-telemetry counters (DEE-259)", () => {
  it("DECISION_COUNTER_CODES matches all cdeReasonCodes values", () => {
    expect(DECISION_COUNTER_CODES.size).toBe(Object.values(cdeReasonCodes).length);
    for (const code of Object.values(cdeReasonCodes)) {
      expect(DECISION_COUNTER_CODES.has(code)).toBe(true);
    }
  });

  it.each(Object.values(cdeReasonCodes))(
    "emitDecisionReasonCodeCounter emits decision domain counter for %s",
    (code) => {
      const { lines, sink } = captureSink();
      emitDecisionReasonCodeCounter({ organizationId: ORG_ID, code }, sink);

      expect(parseCounter(lines)).toMatchObject({
        event: "waia_trader_event",
        kind: "counter",
        organization_id: ORG_ID,
        outcome: "increment",
        domain: "decision",
        code,
        delta: 1,
        severity: "info",
      });
    },
  );

  it("rejects invalid decision counter codes", () => {
    expect(() =>
      emitDecisionReasonCodeCounter({
        organizationId: ORG_ID,
        code: strategyReasonCodesProxy(),
      }),
    ).toThrow(/\[decision-telemetry\] invalid decision counter code/);
  });

  it("rejects risk-domain codes", () => {
    expect(() =>
      emitDecisionReasonCodeCounter({ organizationId: ORG_ID, code: "RISK_OUTCOME_APPROVE" }),
    ).toThrow(/\[decision-telemetry\] invalid decision counter code/);
  });

  it("undefined reasonCodes is a silent no-op", () => {
    const { lines, sink } = captureSink();
    const msv = mockMsv(undefined);
    emitMsvDecisionCounters(msv, ORG_ID, sink);
    expect(lines).toHaveLength(0);
  });

  it("null reasonCodes is a silent no-op", () => {
    const { lines, sink } = captureSink();
    const msv = mockMsv(null);
    emitMsvDecisionCounters(msv, ORG_ID, sink);
    expect(lines).toHaveLength(0);
  });

  it("empty reasonCodes array is a silent no-op", () => {
    const { lines, sink } = captureSink();
    emitMsvDecisionCounters(mockMsv([]), ORG_ID, sink);
    expect(lines).toHaveLength(0);
  });

  it("non-array reasonCodes throws malformed reasonCodes", () => {
    const { sink } = captureSink();
    const msv = mockMsv("CDE_QUALITY_ALLOW_TRADING");
    expect(() => emitMsvDecisionCounters(msv, ORG_ID, sink)).toThrow(
      /\[decision-telemetry\] malformed reasonCodes/,
    );
  });

  it("non-string array element throws malformed reason code entry", () => {
    const { sink } = captureSink();
    expect(() =>
      emitMsvDecisionCounters(mockMsv([cdeReasonCodes.qualityAllowTrading, 42]), ORG_ID, sink),
    ).toThrow(/\[decision-telemetry\] malformed reason code entry/);
  });

  it("duplicate valid codes emit once per occurrence", () => {
    const { lines, sink } = captureSink();
    emitMsvDecisionCounters(
      mockMsv([cdeReasonCodes.regimeRange, cdeReasonCodes.regimeRange]),
      ORG_ID,
      sink,
    );

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).code).toBe(cdeReasonCodes.regimeRange);
    expect(JSON.parse(lines[1]!).code).toBe(cdeReasonCodes.regimeRange);
  });

  it("emitted payloads never include forbidden telemetry keys", () => {
    const forbidden = new Set<string>([
      ...FORBIDDEN_TRADER_TELEMETRY_KEYS,
      "orderId",
      "order_id",
      "clientOrderId",
      "symbol",
    ]);

    const { lines, sink } = captureSink();
    emitMsvDecisionCounters(
      mockMsv([cdeReasonCodes.qualityAllowTrading, cdeReasonCodes.regimeTrendBear]),
      ORG_ID,
      sink,
    );

    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) {
        expect(forbidden.has(key)).toBe(false);
      }
    }
  });

  it("cde-v0 remains free of decision telemetry imports", () => {
    const filePath = path.join(process.cwd(), "lib/trader/intelligence/cde-v0.ts");
    const source = readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/decision-telemetry/);
    expect(source).not.toMatch(/emitMsvDecisionCounters/);
    expect(source).not.toMatch(/incrementTraderCounter/);
  });
});

function strategyReasonCodesProxy(): string {
  return "STRAT_MR_ZSCORE_BUY";
}
