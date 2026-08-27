import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";

function loadFixture(): { bars: Bar[]; latestQuote: Quote } {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json"),
      "utf8",
    ),
  ) as { bars: Bar[]; latestQuote: Quote };
}

describe("DEE-757 canonical evaluation-cycle Forecast V2 cutover", () => {
  it("returns an explicit typed NON_ACTIONABLE outcome when Forecast V2 input is absent", () => {
    const fixture = loadFixture();
    const result = runEvaluationCycle({
      organizationId: "00000000-0000-4000-8000-000000000001",
      bars: fixture.bars,
      quote: fixture.latestQuote,
      newId: () => "dee-757-cycle",
    });
    expect(result.forecastRuntimeOutcome).toMatchObject({
      status: "NON_ACTIONABLE",
      reason: "MISSING_OR_NOT_ADMITTED",
      capitalAuthority: "NONE",
    });
  });

  it("does not permit an explicit new Forecast path to fall back to ForecastDecisionBundle", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/trader/intelligence/evaluation-cycle.ts"),
      "utf8",
    );
    expect(source).toContain("forecastRuntimeOutcome");
    expect(source).toContain("input.forecastRuntimeInput == null");
    expect(source.indexOf("const forecastRuntimeOutcome")).toBeLessThan(
      source.indexOf("const forecastDecisionBundle"),
    );
  });
});
