import { describe, expect, it } from "vitest";

import {
  assertFhvRehearsalEconomicFrontierPresent,
  assertFhvRehearsalEconomicFrontierQuiescent,
  buildSyntheticEconomicFrontier,
  FhvRehearsalEconomicFrontierError,
  validateFhvRehearsalEconomicFrontierBinding,
  validateFhvRehearsalEconomicFrontierDigest,
} from "@/lib/trader/observability/fhv-rehearsal-economic-frontier";

const RUN_ID = "fhv-economic-frontier-unit";
const ORG_ID = "00000000-0000-4000-8000-000000000431";
const CYCLE = 44;

function quiescentFrontier() {
  return buildSyntheticEconomicFrontier({
    runId: RUN_ID,
    organizationId: ORG_ID,
    safeResumeThroughCycleIndex: CYCLE,
  });
}

describe("FHV rehearsal economic frontier (DEE-431 R1)", () => {
  it("accepts genuine quiescent frontier", () => {
    const frontier = quiescentFrontier();
    expect(() => assertFhvRehearsalEconomicFrontierQuiescent(frontier)).not.toThrow();
    expect(() =>
      validateFhvRehearsalEconomicFrontierBinding({
        frontier,
        runId: RUN_ID,
        organizationId: ORG_ID,
        safeResumeThroughCycleIndex: CYCLE,
      }),
    ).not.toThrow();
  });

  it.each([
    ["totalOrderCount", { totalOrderCount: 1 }],
    ["openOrderCount", { openOrderCount: 1 }],
    ["submittedOrderCount", { submittedOrderCount: 1 }],
    ["fillCount", { fillCount: 1 }],
    ["openPositionCount", { openPositionCount: 1 }],
    ["pendingReconciliationCount", { pendingReconciliationCount: 1 }],
    ["realizedPnlUsdt", { realizedPnlUsdt: "1" }],
    ["markedPnlUsdt", { markedPnlUsdt: "0.01" }],
    ["feesPaidUsdt", { feesPaidUsdt: "0.001" }],
    ["cashDeltaUsdt", { cashDeltaUsdt: "-1" }],
    ["htrAccountingActive", { htrAccountingActive: true }],
    ["historicalExecutionActive", { historicalExecutionActive: true }],
    ["portfolioAccountingActive", { portfolioAccountingActive: true }],
    ["wp21RuntimeActive", { wp21RuntimeActive: true }],
  ] as const)("rejects non-quiescent %s", (_label, overrides) => {
    const frontier = buildSyntheticEconomicFrontier({
      runId: RUN_ID,
      organizationId: ORG_ID,
      safeResumeThroughCycleIndex: CYCLE,
      ...overrides,
    });
    expect(() => assertFhvRehearsalEconomicFrontierQuiescent(frontier)).toThrow(
      FhvRehearsalEconomicFrontierError,
    );
    try {
      assertFhvRehearsalEconomicFrontierQuiescent(frontier);
    } catch (error) {
      expect((error as FhvRehearsalEconomicFrontierError).code).toBe(
        "FHV_REHEARSAL_ECONOMIC_FRONTIER_NOT_QUIESCENT",
      );
    }
  });

  it("rejects missing frontier", () => {
    expect(() => assertFhvRehearsalEconomicFrontierPresent(undefined)).toThrow(
      FhvRehearsalEconomicFrontierError,
    );
    try {
      assertFhvRehearsalEconomicFrontierPresent(undefined);
    } catch (error) {
      expect((error as FhvRehearsalEconomicFrontierError).code).toBe(
        "FHV_REHEARSAL_ECONOMIC_FRONTIER_INVALID",
      );
    }
  });

  it("rejects wrong runId", () => {
    const frontier = quiescentFrontier();
    expect(() =>
      validateFhvRehearsalEconomicFrontierBinding({
        frontier,
        runId: "wrong-run",
        organizationId: ORG_ID,
        safeResumeThroughCycleIndex: CYCLE,
      }),
    ).toThrow(FhvRehearsalEconomicFrontierError);
  });

  it("rejects wrong organizationId", () => {
    const frontier = quiescentFrontier();
    expect(() =>
      validateFhvRehearsalEconomicFrontierBinding({
        frontier,
        runId: RUN_ID,
        organizationId: "00000000-0000-4000-8000-000000009999",
        safeResumeThroughCycleIndex: CYCLE,
      }),
    ).toThrow(FhvRehearsalEconomicFrontierError);
  });

  it("rejects wrong cycle frontier", () => {
    const frontier = quiescentFrontier();
    expect(() =>
      validateFhvRehearsalEconomicFrontierBinding({
        frontier,
        runId: RUN_ID,
        organizationId: ORG_ID,
        safeResumeThroughCycleIndex: 99,
      }),
    ).toThrow(FhvRehearsalEconomicFrontierError);
  });

  it("rejects digest tampering", () => {
    const frontier = quiescentFrontier();
    const tampered = { ...frontier, contentDigest: "0".repeat(64) };
    expect(() => validateFhvRehearsalEconomicFrontierDigest(tampered)).toThrow(
      FhvRehearsalEconomicFrontierError,
    );
    try {
      validateFhvRehearsalEconomicFrontierDigest(tampered);
    } catch (error) {
      expect((error as FhvRehearsalEconomicFrontierError).code).toBe(
        "FHV_REHEARSAL_ECONOMIC_FRONTIER_INVALID",
      );
    }
  });
});
