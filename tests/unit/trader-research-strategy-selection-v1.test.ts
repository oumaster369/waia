import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as strategyRegistry from "@/lib/trader/intelligence/strategies/registry";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  MEAN_REVERSION_V0,
  TREND_MOMENTUM_V0,
  type Bar,
  type Quote,
} from "@/lib/trader/intelligence/types";

type Fixture = { bars: Bar[]; latestQuote: Quote };

function loadFixture(): Fixture {
  const fixturePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
}

function evaluate(miCoreEnabled: boolean, strategySignalIds?: readonly string[]) {
  const fixture = loadFixture();
  return runEvaluationCycle({
    organizationId: "research-selection-test-org",
    bars: fixture.bars,
    quote: fixture.latestQuote,
    evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
    miCoreEnabled,
    strategySignalIds,
    newId: () => "research-selection-test-id",
  });
}

afterEach(() => vi.restoreAllMocks());

describe("research strategy selection remains bounded to registered MVP evaluators", () => {
  it.each([false, true])("forwards the exact selected ID with miCoreEnabled=%s", (miCoreEnabled) => {
    const result = evaluate(miCoreEnabled, [MEAN_REVERSION_V0]);
    expect(result.signals.map(({ strategyId }) => strategyId)).toEqual([MEAN_REVERSION_V0]);
  });

  it.each([false, true])(
    "rejects an unregistered research ID before evaluating any strategy with miCoreEnabled=%s",
    (miCoreEnabled) => {
      const evaluator = vi.spyOn(strategyRegistry, "evaluateRegisteredStrategies");
      expect(() => evaluate(miCoreEnabled, ["research.mean-reversion-lookback.v1"]))
        .toThrow("[trader/intelligence] unknown strategy signal ID: research.mean-reversion-lookback.v1");
      expect(evaluator).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "rejects prototype-property IDs before evaluating any strategy with miCoreEnabled=%s",
    (miCoreEnabled) => {
      const evaluator = vi.spyOn(strategyRegistry, "evaluateRegisteredStrategies");
      for (const strategyId of ["toString", "constructor", "__proto__"]) {
        expect(() => evaluate(miCoreEnabled, [strategyId]))
          .toThrow(`[trader/intelligence] unknown strategy signal ID: ${strategyId}`);
      }
      expect(evaluator).not.toHaveBeenCalled();
    },
  );

  it("refuses duplicate dispatch rather than emitting two signals for one strategy", () => {
    for (const miCoreEnabled of [false, true]) {
      expect(() => evaluate(miCoreEnabled, [MEAN_REVERSION_V0, MEAN_REVERSION_V0]))
        .toThrow("duplicate strategy signal ID");
    }
  });

  it("rejects unknown IDs on the direct registry entry before a partial result", () => {
    const baseline = evaluate(false, [MEAN_REVERSION_V0]);
    const fixture = loadFixture();
    for (const unknown of ["research.mean-reversion-lookback.v1", "toString", "constructor", "__proto__"]) {
      expect(() => strategyRegistry.evaluateRegisteredStrategies(
        baseline.msv, baseline.features,
        { organizationId: "research-selection-test-org", bars: fixture.bars },
        [MEAN_REVERSION_V0, unknown] as Parameters<typeof strategyRegistry.evaluateRegisteredStrategies>[3],
      )).toThrow(`unknown strategy signal ID: ${unknown}`);
    }
  });

  it.each([
    { label: "omitted", strategySignalIds: undefined },
    { label: "empty", strategySignalIds: [] },
  ])("retains default all-strategy behavior for a $label filter", ({ strategySignalIds }) => {
    for (const miCoreEnabled of [false, true]) {
      const result = evaluate(miCoreEnabled, strategySignalIds);
      expect(result.signals.map(({ strategyId }) => strategyId).sort()).toEqual([
        LIQUIDITY_SWEEP_REVERSAL_V0,
        MEAN_REVERSION_V0,
        TREND_MOMENTUM_V0,
      ].sort());
    }
  });
});
