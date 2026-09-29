import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  neweyWestDateLag,
  standardNormalCdf,
  strategyAdmissionHolmPasses,
  studentTOneSidedUpperTail,
} from "@/lib/trader/research/strategy-admission-v1";
import { applyHolmAdjustment } from "@/lib/trader/research-v2/multiple-testing-holm-v2";
import {
  STRATEGY_ADMISSION_SPEC_SHA256,
  admissionDateNets,
  passingIsDateNets,
} from "./strategy-admission-date-nets";

const SPEC = STRATEGY_ADMISSION_SPEC_SHA256;

const SIGNAL = "2022-01-01T00:00:00.000Z";
const ENTRY = "2022-01-01T00:01:00.000Z";

function registeredJournal(spec = SPEC, familySize = 1) {
  const journal = new AppendOnlyStrategyAdmissionJournal();
  journal.registerFamily(spec, familySize);
  return journal;
}

function admit(
  overrides: Partial<Parameters<typeof assessStrategyAdmission>[0]> = {},
  observations = passingIsDateNets(2022),
) {
  const declaredFamilySize = overrides.declaredFamilySize ?? 1;
  const specSha256 = overrides.specSha256 ?? SPEC;
  const journal =
    overrides.journal ??
    (specSha256 === SPEC
      ? registeredJournal(SPEC, declaredFamilySize)
      : registeredJournal(specSha256, declaredFamilySize));
  return assessStrategyAdmission({
    specSha256: SPEC,
    declaredFamilySize,
    kind: "continuous",
    intraday: false,
    sideDeclared: "long",
    horizonBars: 1,
    split: "is",
    trials: [{ hypothesisId: "h1", observations }],
    confirmatoryIndex: 0,
    journal,
    usedForDiscovery: false,
    signalBarCloseUtc: SIGNAL,
    entryTimeUtc: ENTRY,
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
    expect(strategyAdmissionHolmPasses(Number(assessment.pHolm))).toBe(true);
    expect(Number(assessment.pRaw)).toBeGreaterThan(1e-6);
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
    expect(() =>
      journal.assertSplitAvailable({
        specSha256: SPEC,
        hypothesisId: "h1",
        split: "validation",
      }),
    ).toThrow(/split_already_used/);
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

  it("rejects Holm equality at 0.05 and uses a Student-t IS tail", () => {
    expect(strategyAdmissionHolmPasses(0.05)).toBe(false);
    expect(strategyAdmissionHolmPasses(0.049)).toBe(true);
    const student = studentTOneSidedUpperTail(1.699127, 29);
    const normal = 1 - standardNormalCdf(1.699127);
    expect(student).toBeGreaterThan(0.045);
    expect(student).toBeLessThan(0.055);
    expect(student).toBeGreaterThan(normal);
  });

  it("requires timestamps and a usedForDiscovery boolean", () => {
    expect(() => admit({ usedForDiscovery: undefined as never })).toThrow(
      /used_for_discovery_required/,
    );
    expect(() => admit({ signalBarCloseUtc: "", entryTimeUtc: ENTRY })).toThrow(/look_ahead_entry/);
  });

  it("subtracts numeric perp funding and refuses a missing or non-numeric value", () => {
    expect(() => admit({ symbol: "BTC-PERP" })).toThrow(/perp_funding_required/);
    expect(() => admit({ symbol: "BTC-PERP", fundingMean: "n/a" })).toThrow(
      /perp_funding_required/,
    );
    const funded = admit({ symbol: "BTC-PERP", fundingMean: "0.001" });
    const spot = admit();
    expect(Number(funded.netMeanDate)).toBeCloseTo(Number(spot.netMeanDate) - 0.001, 6);
  });

  it("stores a date lag for a long bar horizon and rejects the 2014-2023 stability counterexample", () => {
    expect(neweyWestDateLag({ horizonBars: 240, barIntervalMinutes: 1, nDates: 20 })).toBe(1);
    const lagged = admit({ horizonBars: 240 }, passingIsDateNets(2022));
    expect(lagged.nwLag).toBe(1);
    expect(lagged.nwLag).not.toBe(240);

    const counterexample = [];
    for (let year = 2014; year <= 2023; year += 1) {
      for (let quarter = 0; quarter < 4; quarter += 1) {
        const month = String(quarter * 3 + 1).padStart(2, "0");
        counterexample.push({
          utcDate: `${year}-${month}-15`,
          net: year <= 2015 ? "0.08" : "-0.002",
        });
      }
    }
    const assessment = admit({ horizonBars: 1, kind: "continuous" }, counterexample);
    expect(assessment.verdict).not.toBe("passed_is");
    expect(assessment.reasons).toContain("STABILITY_NOT_MET");
    expect(Number(assessment.netMeanDate)).toBeCloseTo(0.0144, 4);
  });

  it("does not award DSR 1 when trial Sharpe variance is zero", () => {
    const n = 250;
    const centered = Array.from({ length: n }, (_, index) => index - (n - 1) / 2);
    const variance = centered.reduce((sum, value) => sum + value * value, 0) / (n - 1);
    const std = Math.sqrt(variance);
    const sharpe = 0.171;
    const origin = Date.parse("2014-01-02T00:00:00.000Z");
    const observations = centered.map((value, index) => ({
      utcDate: new Date(origin + index * 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      net: (value / std + sharpe).toFixed(8),
    }));
    const familySize = 51;
    const trials = Array.from({ length: familySize }, (_, index) => ({
      hypothesisId: `trial-${index}`,
      observations,
    }));
    const assessment = admit(
      {
        declaredFamilySize: familySize,
        trials,
        confirmatoryIndex: 0,
        kind: "event",
      },
      observations,
    );
    expect(assessment.dsr).not.toBeNull();
    expect(Number(assessment.dsr)).toBeLessThan(0.95);
    expect(Number(assessment.dsr)).toBeGreaterThan(0.5);
    expect(Number(assessment.dsr)).toBeCloseTo(0.672, 1);
    expect(assessment.reasons).toContain("DEFLATED_SHARPE_NOT_PASSED");

    const flat = observations.map((row) => ({ ...row, net: "0.01" }));
    const flatTrials = trials.map((trial) => ({ ...trial, observations: flat }));
    const zeroStd = admit(
      {
        declaredFamilySize: familySize,
        trials: flatTrials,
        confirmatoryIndex: 0,
        kind: "event",
      },
      flat,
    );
    expect(zeroStd.dsr).toBe("0.00000000");
    expect(zeroStd.verdict).not.toBe("passed_is");
  });

  it("keeps a one-shot validation across a new journal on the same file", () => {
    const dir = mkdtempSync(join(tmpdir(), "waia-admission-"));
    const path = join(dir, "journal.jsonl");
    const first = AppendOnlyStrategyAdmissionJournal.openDurable(path);
    first.registerFamily(SPEC, 1);
    first.append({
      correctsRowIndex: null,
      hypothesisId: "same-hypothesis",
      specSha256: SPEC,
      split: "validation",
      familySize: 1,
      configParamsJson: "{}",
      nEvents: 20,
      nDates: 20,
      netMeanDate: "0.01000000",
      seMethod: "newey_west",
      nwLag: 1,
      t: "2.00000000",
      pRaw: "0.02000000",
      pHolm: "0.02000000",
      verdict: "passed_validation",
      verdictReason: "passed",
      flags: [],
      countsAsSplitUse: true,
    });
    const second = AppendOnlyStrategyAdmissionJournal.openDurable(path);
    expect(second.registeredFamilySize(SPEC)).toBe(1);
    expect(second.durable).toBe(true);
    expect(() =>
      second.assertSplitAvailable({
        specSha256: SPEC,
        hypothesisId: "same-hypothesis",
        split: "validation",
      }),
    ).toThrow(/split_already_used/);
    writeFileSync(join(dir, "not-a-directory"), "x");
    expect(() =>
      AppendOnlyStrategyAdmissionJournal.openDurable(join(dir, "not-a-directory", "journal.jsonl")),
    ).toThrow(/admission_journal_unavailable/);
  });

  it("marks an implausibly strong IS result audit_required", () => {
    const assessment = admit({}, admissionDateNets(2022, "0.04"));
    expect(assessment.verdict).toBe("audit_required");
    expect(assessment.reasons).toContain("AUDIT_REQUIRED");
    expect(assessment.verdict).not.toBe("passed_is");
  });
});
