import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FORECAST_RUNTIME_AUTHORITY_ALLOWED_CONSUMERS_V1,
  isForecastRuntimeAuthorityConsumerForbiddenV1,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-consumer-inventory-v1";

describe("DEE-757 Forecast runtime consumer and legacy firewall", () => {
  it("allows only canonical intelligence-cycle consumers and rejects protected prefixes", () => {
    expect(FORECAST_RUNTIME_AUTHORITY_ALLOWED_CONSUMERS_V1).toEqual([
      "lib/trader/intelligence/evaluation-cycle.ts",
      "lib/trader/intelligence/types.ts",
    ]);
    for (const forbidden of [
      "lib/trader/intelligence/decision-economics/x.ts",
      "lib/trader/risk/x.ts",
      "lib/trader/execution/x.ts",
      "lib/trader/live/x.ts",
      "lib/trader/capital/x.ts",
      "lib/trader/research/holdout/x.ts",
    ]) {
      expect(isForecastRuntimeAuthorityConsumerForbiddenV1(forbidden)).toBe(true);
    }
  });

  it("keeps the runtime authority free of Decision/Risk/Execution and confidence semantics", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/@\/lib\/trader\/(risk|execution|live|capital)\//);
    expect(source).not.toMatch(/@\/lib\/trader\/intelligence\/decision/);
    expect(source).not.toMatch(/StrategySignal|expectedEdge|riskMultiplier|BUY|SELL/);
  });
});
