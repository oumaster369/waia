import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as cdeModule from "@/lib/trader/intelligence/cde-v0";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import {
  liquiditySweepReasonCodes,
  trendMomentumReasonCodes,
  cdeReasonCodes,
  strategyReasonCodes,
  type Bar,
  type Quote,
} from "@/lib/trader/intelligence/types";

const ORG = "00000000-0000-4000-8000-0000000258";

type FixtureFile = {
  bars: Bar[];
  latestQuote: Quote;
};

function loadFixture(): FixtureFile {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as FixtureFile;
}

function captureSink() {
  const lines: string[] = [];
  return {
    lines,
    sink: (line: string) => lines.push(line),
  };
}

function parseCounter(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

function flatBars(count: number, close = "65000.00"): Bar[] {
  const bars: Bar[] = [];
  for (let index = 0; index < count; index += 1) {
    const openTime = new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000,
    ).toISOString();
    const closeTime = new Date(Date.parse(openTime) + 60_000).toISOString();
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      open: close,
      high: close,
      low: close,
      close,
      volume: "10.00",
      barOpenTime: openTime,
      barCloseTime: closeTime,
    });
  }
  return bars;
}

describe("trader intelligence evaluation cycle telemetry (DEE-258)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("golden fixture emits STRAT_MR_ZSCORE_BUY via telemetrySink", () => {
    const fixture = loadFixture();
    const { lines, sink } = captureSink();

    runEvaluationCycle({
      organizationId: ORG,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "id-eval-258-golden",
      telemetrySink: sink,
    });

    expect(lines).toHaveLength(6);
    expect(parseCounter(lines[0]!).domain).toBe("decision");
    expect(parseCounter(lines[1]!).domain).toBe("decision");
    expect(parseCounter(lines[2]!).domain).toBe("decision");
    const strategyLines = lines.slice(3).map(parseCounter);
    expect(strategyLines.every((line) => line.domain === "strategy")).toBe(true);
    expect(strategyLines.some((line) => line.code === strategyReasonCodes.zscoreBuy)).toBe(true);
    expect(parseCounter(lines[0]!).code).toBe(cdeReasonCodes.qualityAllowTrading);
    expect(parseCounter(lines[1]!).code).toBe(cdeReasonCodes.regimeTrendBear);
    expect(parseCounter(lines[2]!).code).toBe(cdeReasonCodes.newsSentimentDeferredPr3);
  });

  it("STOP_TRADING MSV emits STRAT_MR_PERMISSION_BLOCKED", () => {
    const fixture = loadFixture();
    const { lines, sink } = captureSink();
    const original = cdeModule.buildMsvEnvelope;

    vi.spyOn(cdeModule, "buildMsvEnvelope").mockImplementation((input) => {
      const msv = original(input);
      return {
        ...msv,
        derived: {
          ...msv.derived,
          tradingPermission: "STOP_TRADING",
        },
      };
    });

    runEvaluationCycle({
      organizationId: ORG,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "id-eval-258-stop",
      telemetrySink: sink,
    });

    expect(lines).toHaveLength(6);
    const strategyLines = lines.slice(3).map(parseCounter);
    expect(strategyLines.some((line) => line.code === strategyReasonCodes.permissionBlocked)).toBe(
      true,
    );
    expect(
      strategyLines.some((line) => line.code === liquiditySweepReasonCodes.permissionBlocked),
    ).toBe(true);
    expect(
      strategyLines.some((line) => line.code === trendMomentumReasonCodes.strategyNotAllowed),
    ).toBe(true);
  });

  it("strategy not allowed emits STRAT_MR_STRATEGY_NOT_ALLOWED", () => {
    const fixture = loadFixture();
    const { lines, sink } = captureSink();
    const original = cdeModule.buildMsvEnvelope;

    vi.spyOn(cdeModule, "buildMsvEnvelope").mockImplementation((input) => {
      const msv = original(input);
      return {
        ...msv,
        derived: {
          ...msv.derived,
          allowedStrategyIds: [],
        },
      };
    });

    runEvaluationCycle({
      organizationId: ORG,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "id-eval-258-not-allowed",
      telemetrySink: sink,
    });

    expect(lines).toHaveLength(6);
    const strategyLines = lines.slice(3).map(parseCounter);
    expect(strategyLines.some((line) => line.code === strategyReasonCodes.strategyNotAllowed)).toBe(
      true,
    );
    expect(
      strategyLines.some((line) => line.code === liquiditySweepReasonCodes.strategyNotAllowed),
    ).toBe(true);
    expect(
      strategyLines.some((line) => line.code === trendMomentumReasonCodes.strategyNotAllowed),
    ).toBe(true);
  });

  it("flat market emits mean-reversion sell exit telemetry", () => {
    const { lines, sink } = captureSink();
    const bars = flatBars(25);

    runEvaluationCycle({
      organizationId: ORG,
      bars,
      quote: {
        symbol: "BTC/USDT",
        bid: "65000.00",
        ask: "65000.00",
        last: "65000.00",
        timestamp: bars.at(-1)!.barCloseTime,
      },
      newId: () => "id-eval-258-neutral",
      telemetrySink: sink,
    });

    expect(lines).toHaveLength(6);
    const strategyLines = lines.slice(3).map(parseCounter);
    expect(strategyLines.some((line) => line.code === strategyReasonCodes.zscoreSell)).toBe(true);
  });

  it("omitted telemetrySink does not break evaluation cycle", () => {
    const fixture = loadFixture();

    const result = runEvaluationCycle({
      organizationId: ORG,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "id-eval-258-no-sink",
    });

    expect(result.signal.outcome).toBe("SIGNAL");
    expect(result.signal.reasonCodes).toContain(strategyReasonCodes.zscoreBuy);
  });
});
