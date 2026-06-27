import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import {
  cdeReasonCodes,
  strategyReasonCodes,
  type Bar,
  type Quote,
} from "@/lib/trader/intelligence/types";

const ORG = "00000000-0000-4000-8000-000000000259";

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

describe("trader intelligence evaluation cycle decision telemetry (DEE-259)", () => {
  it("golden fixture emits 2 decision counters before 1 strategy counter", () => {
    const fixture = loadFixture();
    const { lines, sink } = captureSink();

    runEvaluationCycle({
      organizationId: ORG,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "id-eval-259-golden",
      telemetrySink: sink,
    });

    expect(lines).toHaveLength(4);
    expect(parseCounter(lines[0]!)).toMatchObject({
      domain: "decision",
      code: cdeReasonCodes.qualityAllowTrading,
    });
    expect(parseCounter(lines[1]!)).toMatchObject({
      domain: "decision",
      code: cdeReasonCodes.regimeTrendBear,
    });
    const strategyLines = lines.slice(2).map(parseCounter);
    expect(strategyLines.every((line) => line.domain === "strategy")).toBe(true);
    expect(strategyLines.some((line) => line.code === strategyReasonCodes.zscoreBuy)).toBe(true);
  });

  it("omitted telemetrySink does not break evaluation cycle", () => {
    const fixture = loadFixture();

    const result = runEvaluationCycle({
      organizationId: ORG,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "id-eval-259-no-sink",
    });

    expect(result.msv.derived.reasonCodes).toHaveLength(2);
    expect(result.signal.outcome).toBe("SIGNAL");
  });
});
