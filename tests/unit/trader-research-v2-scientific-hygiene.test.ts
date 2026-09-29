import { describe, expect, it } from "vitest";

import {
  AppendOnlyStrategyAdmissionJournal,
  STRATEGY_ADMISSION_CONTINUOUS_IS_MIN_TRADES,
  STRATEGY_ADMISSION_CONTINUOUS_VALIDATION_MIN_TRADES,
  STRATEGY_ADMISSION_EVENT_IS_MIN_DATES,
  STRATEGY_ADMISSION_EVENT_IS_MIN_EVENTS,
  STRATEGY_ADMISSION_EVENT_VALIDATION_MIN_DATES,
  STRATEGY_ADMISSION_EVENT_VALIDATION_MIN_EVENTS,
  STRATEGY_ADMISSION_VALIDATION_MIN_T,
  assessStrategyAdmission,
  assertNoLookaheadEntry,
  assertPerpFundingRecorded,
  standardNormalCdf,
} from "@/lib/trader/research/strategy-admission-v1";
import { applyHolmAdjustment } from "@/lib/trader/research-v2/multiple-testing-holm-v2";
import { STRATEGY_ADMISSION_SPEC_SHA256, admissionDateNets } from "./strategy-admission-date-nets";

const SPEC = STRATEGY_ADMISSION_SPEC_SHA256;

function admit(
  overrides: Partial<Parameters<typeof assessStrategyAdmission>[0]> = {},
  observations = admissionDateNets(2022, "0.01"),
) {
  return assessStrategyAdmission({
    specSha256: SPEC,
    declaredFamilySize: 1,
    kind: "continuous",
    intraday: false,
    sideDeclared: "long",
    horizonBars: 1,
    split: "is",
    trials: [{ hypothesisId: "h1", observations }],
    confirmatoryIndex: 0,
    ...overrides,
  });
}

describe("strategy admission v1", () => {
  it("uses the spec sample floors and Holm on a pre-declared family", () => {
    expect(STRATEGY_ADMISSION_EVENT_IS_MIN_EVENTS).toBe(30);
    expect(STRATEGY_ADMISSION_EVENT_IS_MIN_DATES).toBe(15);
    expect(STRATEGY_ADMISSION_EVENT_VALIDATION_MIN_EVENTS).toBe(20);
    expect(STRATEGY_ADMISSION_EVENT_VALIDATION_MIN_DATES).toBe(10);
    expect(STRATEGY_ADMISSION_CONTINUOUS_IS_MIN_TRADES).toBe(30);
    expect(STRATEGY_ADMISSION_CONTINUOUS_VALIDATION_MIN_TRADES).toBe(15);
    expect(STRATEGY_ADMISSION_VALIDATION_MIN_T).toBe(1.645);
    expect(standardNormalCdf(1.6448536269514722)).toBeCloseTo(0.95, 3);
    expect(applyHolmAdjustment([0.01, 0.04])).toEqual([
      expect.closeTo(0.02, 8),
      expect.closeTo(0.04, 8),
    ]);
  });

  it("passes IS from date-aggregated Newey-West evidence, not a caller verdict", () => {
    const assessment = admit();
    expect(assessment.seMethod).toBe("newey_west");
    expect(assessment.verdict).toBe("passed_is");
    expect(assessment.nEvents).toBe(32);
    expect(assessment.nDates).toBe(32);
    expect(assessment.familySize).toBe(1);
    expect(Number(assessment.netMeanDate)).toBeGreaterThan(0);
    expect(assessment.pHolm).toBe("0.00000000");
    expect(assessment).not.toHaveProperty("admitted");
  });

  it("returns insufficient_data below the sample floor and does not pass", () => {
    const assessment = admit({ kind: "event" }, admissionDateNets(2022, "0.01", 2));
    expect(assessment.verdict).toBe("insufficient_data");
    expect(assessment.reasons).toContain("INSUFFICIENT_DATA");
    expect(assessment.verdict).not.toBe("passed_is");
  });

  it("rejects a family larger than the pre-declared size and blocks a second validation", () => {
    expect(() =>
      admit({
        declaredFamilySize: 1,
        trials: [
          { hypothesisId: "h1", observations: admissionDateNets(2022, "0.01") },
          { hypothesisId: "h2", observations: admissionDateNets(2022, "0.02") },
        ],
      }),
    ).toThrow(/family_size_exceeded/);

    const journal = new AppendOnlyStrategyAdmissionJournal();
    journal.append({
      correctsRowIndex: null,
      hypothesisId: "h1",
      specSha256: SPEC,
      split: "validation",
      familySize: 1,
      configParamsJson: "{}",
      nEvents: 20,
      nDates: 20,
      netMeanDate: "0.02000000",
      seMethod: "newey_west",
      nwLag: 1,
      t: "inf",
      pRaw: "0.00000000",
      pHolm: "0.00000000",
      verdict: "passed_validation",
      verdictReason: "passed",
      flags: [],
      countsAsSplitUse: true,
    });
    expect(() => journal.assertSplitAvailable("h1", "validation")).toThrow(/split_already_used/);
    expect(journal.list()).toHaveLength(1);
  });

  it("refuses a missing spec hash, a perp without funding, lookahead entry, and discovery data as IS", () => {
    expect(() => admit({ specSha256: "" })).toThrow(/spec_sha256_required/);
    expect(() => assertPerpFundingRecorded({ symbol: "BTC-PERP", fundingMean: null })).toThrow(
      /perp_funding_required/,
    );
    expect(() =>
      assertNoLookaheadEntry({
        signalBarCloseUtc: "2026-01-01T00:01:00.000Z",
        entryTimeUtc: "2026-01-01T00:01:00.000Z",
      }),
    ).toThrow(/look_ahead_entry/);
    const discovered = admit({ usedForDiscovery: true });
    expect(discovered.verdict).toBe("rejected");
    expect(discovered.reasons).toContain("USED_FOR_DISCOVERY_NOT_IN_IS");
  });

  it("requires t >= 1.645 on the single validation pass", () => {
    const flat = admissionDateNets(2024, "0.0000001", 5).map((row, index) => ({
      ...row,
      net: index % 2 === 0 ? "0.0000001" : "-0.0000001",
    }));
    const assessment = admit({ split: "validation", kind: "continuous" }, flat);
    expect(assessment.verdict === "passed_validation").toBe(false);
    const strong = admit({ split: "validation" }, admissionDateNets(2024, "0.02", 5));
    expect(strong.verdict).toBe("passed_validation");
    expect(strong.t === "inf" || Number(strong.t) >= 1.645).toBe(true);
  });
});
