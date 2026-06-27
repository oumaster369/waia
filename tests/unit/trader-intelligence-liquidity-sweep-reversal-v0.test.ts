import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { evaluateLiquiditySweepReversalV0 } from "@/lib/trader/intelligence/strategies/liquidity-sweep-reversal-v0";
import { liquiditySweepReasonCodes, type Bar, type Quote } from "@/lib/trader/intelligence/types";

const ORG = "00000000-0000-4000-8000-0000000332";

type FixtureFile = { bars: Bar[]; latestQuote: Quote };

function loadFixture(name: string): FixtureFile {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader", name);
  return JSON.parse(readFileSync(filePath, "utf8")) as FixtureFile;
}

describe("liquidity sweep reversal v0 (DEE-332 / NEW-5)", () => {
  it("emits buy entry on sweep golden fixture", () => {
    const fixture = loadFixture("btcusdt-1m-liquidity-sweep-entry.json");
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "lsr-entry-features",
    });
    const msv = buildMsvEnvelope({ features, newId: () => "lsr-entry-msv" });
    const signal = evaluateLiquiditySweepReversalV0(msv, features, {
      organizationId: ORG,
      bars: fixture.bars,
      newId: () => "lsr-entry-signal",
    });

    expect(signal.outcome).toBe("SIGNAL");
    expect(signal.side).toBe("buy");
    expect(signal.reasonCodes).toContain(liquiditySweepReasonCodes.sweepEntry);
  });

  it("emits sell exit on recovery golden fixture", () => {
    const fixture = loadFixture("btcusdt-1m-liquidity-sweep-exit.json");
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "lsr-exit-features",
    });
    const msv = buildMsvEnvelope({ features, newId: () => "lsr-exit-msv" });
    const signal = evaluateLiquiditySweepReversalV0(msv, features, {
      organizationId: ORG,
      bars: fixture.bars,
      newId: () => "lsr-exit-signal",
    });

    expect(signal.outcome).toBe("SIGNAL");
    expect(signal.side).toBe("sell");
    expect(signal.reasonCodes).toContain(liquiditySweepReasonCodes.recoveryExit);
  });

  it("emits NO_SIGNAL when strategy is not CDE-allowed", () => {
    const fixture = loadFixture("btcusdt-1m-liquidity-sweep-entry.json");
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "lsr-block-features",
    });
    const msv = buildMsvEnvelope({ features, newId: () => "lsr-block-msv" });
    const blocked = {
      ...msv,
      derived: { ...msv.derived, allowedStrategyIds: ["mean_reversion_v0"] },
    };
    const signal = evaluateLiquiditySweepReversalV0(blocked, features, {
      organizationId: ORG,
      bars: fixture.bars,
      newId: () => "lsr-block-signal",
    });

    expect(signal.outcome).toBe("NO_SIGNAL");
    expect(signal.reasonCodes).toContain(liquiditySweepReasonCodes.strategyNotAllowed);
  });
});
