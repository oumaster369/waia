import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PREDICTIVE_ADMISSION_AUTHORIZED_CONSUMERS_V1,
  isPredictiveAdmissionCapitalConsumerForbiddenV1,
} from "@/lib/trader/intelligence/predictive-admission/predictive-admission-consumer-inventory-v1";
import { LEGACY_MSV_AUTHORITY } from "@/lib/trader/intelligence/cde-v0";

describe("DEE-647 Predictive Admission consumer firewall", () => {
  it("declares legacy MSV compatibility/telemetry-only", () => {
    expect(LEGACY_MSV_AUTHORITY).toBe("COMPATIBILITY_TELEMETRY_ONLY");
  });

  it("allows only Forecast V2 and rejects capital authority prefixes", () => {
    expect(PREDICTIVE_ADMISSION_AUTHORIZED_CONSUMERS_V1).toEqual([
      "lib/trader/intelligence/forecast-v2/",
    ]);
    expect(isPredictiveAdmissionCapitalConsumerForbiddenV1("lib/trader/risk/foo.ts")).toBe(true);
    expect(
      isPredictiveAdmissionCapitalConsumerForbiddenV1(
        "lib/trader/intelligence/decision-economics/foo.ts",
      ),
    ).toBe(true);
    expect(
      isPredictiveAdmissionCapitalConsumerForbiddenV1(
        "lib/trader/intelligence/forecast-v2/runtime.ts",
      ),
    ).toBe(false);
  });

  it("keeps the authority implementation free of Decision/Risk/Execution imports", () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/trader/intelligence/predictive-admission/predictive-admission-v1.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/@\/lib\/trader\/(risk|execution|live|capital)\//);
    expect(source).not.toMatch(/@\/lib\/trader\/intelligence\/decision/);
    expect(source).not.toContain("forecast-v2/index");
    expect(source).not.toMatch(/expectedPath|riskMultiplier|allowedStrategyIds|BUY|SELL/);
  });
});
