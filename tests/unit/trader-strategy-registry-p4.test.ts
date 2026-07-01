import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import {
  evaluateRegisteredStrategies,
  getStrategyRegistryEntry,
  isMvpStrategyId,
  listMvpStrategyRegistry,
  resolveMvpStrategyAssignments,
} from "@/lib/trader/intelligence/strategies/registry";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  MEAN_REVERSION_V0,
  TREND_MOMENTUM_V0,
  type Bar,
  type Quote,
} from "@/lib/trader/intelligence/types";

const ORG = "00000000-0000-4000-8000-0000000203";

describe("strategy registry (DEE-203)", () => {
  it("registers all MVP strategies with version and lifecycle metadata", () => {
    const registry = listMvpStrategyRegistry();
    expect(registry).toHaveLength(3);
    expect(registry.map((entry) => entry.strategyId).sort()).toEqual(
      [LIQUIDITY_SWEEP_REVERSAL_V0, MEAN_REVERSION_V0, TREND_MOMENTUM_V0].sort(),
    );
    for (const entry of registry) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(["PAPER", "RESEARCHING"]).toContain(entry.lifecycleState);
      expect(getStrategyRegistryEntry(entry.strategyId)).toEqual(entry);
    }
  });

  it("assigns all MVP strategies to every org in MVP model", () => {
    const assignments = resolveMvpStrategyAssignments(ORG);
    expect(assignments).toHaveLength(3);
    for (const strategyId of assignments) {
      expect(isMvpStrategyId(strategyId)).toBe(true);
    }
  });
});

describe("strategy fixture replay (P4 exit criterion)", () => {
  function loadFixture(name: string): { bars: Bar[]; latestQuote: Quote } {
    const filePath = path.join(process.cwd(), "tests/fixtures/trader", name);
    return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
  }

  function evaluateFixture(name: string) {
    const fixture = loadFixture(name);
    return runEvaluationCycle({
      organizationId: ORG,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => `id-${name}`,
    });
  }

  it("reproduces mean reversion entry buy on golden entry fixture", () => {
    const result = evaluateFixture("btcusdt-1m-mean-reversion.json");
    const mr = result.signals.find((s) => s.strategyId === MEAN_REVERSION_V0);
    expect(mr?.outcome).toBe("SIGNAL");
    expect(mr?.side).toBe("buy");
  });

  it("reproduces mean reversion exit sell on golden exit fixture", () => {
    const result = evaluateFixture("btcusdt-1m-mean-reversion-exit.json");
    const mr = result.signals.find((s) => s.strategyId === MEAN_REVERSION_V0);
    expect(mr?.outcome).toBe("SIGNAL");
    expect(mr?.side).toBe("sell");
  });

  it("reproduces liquidity sweep entry buy on golden entry fixture", () => {
    const result = evaluateFixture("btcusdt-1m-liquidity-sweep-entry.json");
    const lsr = result.signals.find((s) => s.strategyId === LIQUIDITY_SWEEP_REVERSAL_V0);
    expect(lsr?.outcome).toBe("SIGNAL");
    expect(lsr?.side).toBe("buy");
  });

  it("reproduces liquidity sweep exit sell on golden exit fixture", () => {
    const result = evaluateFixture("btcusdt-1m-liquidity-sweep-exit.json");
    const lsr = result.signals.find((s) => s.strategyId === LIQUIDITY_SWEEP_REVERSAL_V0);
    expect(lsr?.outcome).toBe("SIGNAL");
    expect(lsr?.side).toBe("sell");
  });

  it("evaluates both strategies every cycle via registry dispatch", () => {
    const fixture = loadFixture("btcusdt-1m-mean-reversion.json");
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "feat-dispatch",
    });
    const msv = buildMsvEnvelope({ features, newId: () => "msv-dispatch" });
    const signals = evaluateRegisteredStrategies(msv, features, {
      organizationId: ORG,
      bars: fixture.bars,
      newId: () => "sig-dispatch",
    });
    expect(signals).toHaveLength(3);
    expect(msv.derived.allowedStrategyIds).toEqual(
      expect.arrayContaining([MEAN_REVERSION_V0, LIQUIDITY_SWEEP_REVERSAL_V0]),
    );
    expect(msv.derived.allowedStrategyIds).not.toContain(TREND_MOMENTUM_V0);
  });
});
