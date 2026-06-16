import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { evaluateMeanReversionV0 } from "@/lib/trader/intelligence/strategies/mean-reversion-v0";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";

const ORG = "00000000-0000-4000-8000-0000000257a";

type FixtureFile = {
  bars: Bar[];
  latestQuote: Quote;
};

function loadFixture(): FixtureFile {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as FixtureFile;
}

describe("trader intelligence mean reversion v0 (DEE-257)", () => {
  it("emits SIGNAL on golden fixture", () => {
    const fixture = loadFixture();
    const result = runEvaluationCycle({
      organizationId: ORG,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "id-mr-golden",
    });

    expect(result.signal.outcome).toBe("SIGNAL");
    expect(result.signal.side).toBe("buy");
    expect(result.signal.strategyId).toBe("mean_reversion_v0");
    expect(result.signal.msvId).toBe(result.msv.msvId);
    expect(result.signal.featureSetId).toBe(result.features.featureSetId);
  });

  it("emits NO_SIGNAL when trading permission is STOP_TRADING", () => {
    const fixture = loadFixture();
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
      newId: () => "feature-set-stop",
    });
    const msv = buildMsvEnvelope({ features, newId: () => "msv-stop" });
    const blockedMsv = {
      ...msv,
      derived: {
        ...msv.derived,
        tradingPermission: "STOP_TRADING" as const,
      },
    };

    const signal = evaluateMeanReversionV0(blockedMsv, features, {
      organizationId: ORG,
      newId: () => "signal-stop",
    });

    expect(signal.outcome).toBe("NO_SIGNAL");
  });
});
