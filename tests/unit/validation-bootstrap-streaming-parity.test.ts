import { describe, expect, it } from "vitest";
import { createWaiaUnbiasedIntV1, CbrngRetryOverflowError } from
  "@/lib/trader/intelligence/forecast-v2/waia-cbrng-v1";
import { validationBootstrapResampleV1, validationBootstrapPValueV1, VALIDATION_BOOTSTRAP_B,
  nullCenterPairedDifferentials, observedNullCenteredBootstrapStatistic, VALIDATION_BOOTSTRAP_VERSION } from
  "@/lib/trader/research/benchmark/validation-bootstrap-v1";
import { computeResearchHarnessAdmissionReceiptDigestV2, RESEARCH_HARNESS_ADMISSION_VERSION,
  SCIENTIFIC_ADMISSION_RECEIPT_VERSION } from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";
import { createHash } from "node:crypto";
import { independentDraw, independentValidationPValue, independentValidationResample } from
  "@/tests/unit/helpers/validation-bootstrap-independent-reference";

describe("DEE-950 exact addressed setup and streaming bootstrap", () => {
  const root = Buffer.alloc(32, 0x55);

  it.each([1, 8, 9, 27, 28, 31, 128])("matches independent corrected index vectors at n=%s", (n) => {
    const source = Array.from({ length: n }, (_, i) => (i % 2 ? -1 : 1) * (i + 1e-12));
    for (const ordinal of [0, 1, 19, 9999]) {
      const expected = independentValidationResample(source, root, ordinal);
      const actual = validationBootstrapResampleV1({ source, validationBootstrapRoot: root, resampleOrdinal: ordinal });
      expect(actual.indexVector).toEqual(expected.indices);
      expect(actual.resampled).toEqual(expected.resampled);
      expect(actual.blockLength).toBe(expected.blockLength);
      expect(Object.is(actual.resampled.reduce((sum, v) => sum + v, 0), expected.sum)).toBe(true);
    }
  });

  it("keeps full B=10000 p-value/extreme-count parity and left-to-right floating arithmetic", () => {
    const source = Array.from({ length: 31 }, (_, i) => Math.sin(i * 0.731) + (i % 3 - 1) * 1e-12);
    const expected = independentValidationPValue(source, root);
    const actual = validationBootstrapPValueV1({ differentials: source, trialIdentityDigest32: root });
    expect(VALIDATION_BOOTSTRAP_B).toBe(10_000);
    expect(actual).toEqual(expected);
    expect(Object.is(actual.dBar, expected.dBar)).toBe(true);
    expect(Object.is(actual.centeredMean, expected.centeredMean)).toBe(true);
    expect(Object.is(actual.tObs, expected.tObs)).toBe(true);
  });

  it("keeps every explicit ordinal independent of call order, caller root mutation and modulus", () => {
    for (const n of [1, 81, 525600, 4503599627370497]) {
      const seed = Buffer.from(root);
      const draw = createWaiaUnbiasedIntV1({ domain: "VALBOOT1", rootSeed: seed, n });
      seed.fill(0);
      for (const replica of [9999, 0, 17, 0]) {
        for (const position of [0, 1000, 4, 0]) {
          expect(draw(replica, position, 1)).toBe(independentDraw({ domain: "VALBOOT1", root,
            replica, position, draw: 1, n }).value);
        }
      }
    }
  });

  it("matches actual rejection/retry rather than modulo-biased output", () => {
    const n = 4503599627370497;
    const draw = createWaiaUnbiasedIntV1({ domain: "VALBOOT1", rootSeed: root, n });
    let rejectionPosition: number | null = null;
    for (let position = 0; position < 50_000; position += 1) {
      const expected = independentDraw({ domain: "VALBOOT1", root, replica: 0, position, draw: 1, n });
      if (expected.retry > 0) {
        rejectionPosition = position;
        expect(draw(0, position, 1)).toBe(expected.value);
        expect(draw(0, position, 1, expected.retry)).toBe(expected.value);
        break;
      }
    }
    expect(rejectionPosition).not.toBeNull();
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("refuses invalid bound %s", (n) => {
    expect(() => createWaiaUnbiasedIntV1({ domain: "VALBOOT1", rootSeed: root, n })).toThrow();
  });

  it("refuses invalid root/domain/address and retry overflow", () => {
    expect(() => createWaiaUnbiasedIntV1({ domain: "VALBOOT1", rootSeed: Buffer.alloc(31), n: 5 })).toThrow();
    expect(() => createWaiaUnbiasedIntV1({ domain: "VALBOOT", rootSeed: root, n: 5 })).toThrow();
    const draw = createWaiaUnbiasedIntV1({ domain: "VALBOOT1", rootSeed: root, n: 5 });
    expect(() => draw(-1, 0, 0)).toThrow();
    expect(() => draw(0, 0.5, 0)).toThrow();
    expect(() => draw(0, 0, 2 ** 32)).toThrow();
    expect(() => draw(0, 0, 0, -1)).toThrow();
    expect(() => draw(0, 0, 0, 0xffff_ffff)).toThrow(CbrngRetryOverflowError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("refuses non-finite differential %s instead of emitting a significant p-value", (invalid) => {
    expect(() => nullCenterPairedDifferentials([invalid])).toThrow("non-finite differential");
    expect(() => observedNullCenteredBootstrapStatistic([invalid])).toThrow("non-finite differential");
    expect(() => validationBootstrapPValueV1({ differentials: [invalid], trialIdentityDigest32: root }))
      .toThrow("qualification refused");
  });

  it("refuses intermediate overflow from finite inputs without rescaling or reordering", () => {
    const overflowingSum = [Number.MAX_VALUE, Number.MAX_VALUE];
    expect(() => nullCenterPairedDifferentials(overflowingSum)).toThrow("non-finite differential sum");
    expect(() => validationBootstrapPValueV1({ differentials: overflowingSum, trialIdentityDigest32: root }))
      .toThrow("qualification refused");
    expect(() => nullCenterPairedDifferentials([Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE]))
      .toThrow("non-finite centered differential");
    // Mean and centered inputs are finite; bootstrap repeated entries can still overflow.
    expect(() => validationBootstrapPValueV1({ differentials: [Number.MAX_VALUE, -Number.MAX_VALUE], trialIdentityDigest32: root }))
      .toThrow("non-finite resample sum");
  });

  it("rejects sparse differential input", () => {
    expect(() => nullCenterPairedDifferentials(new Array<number>(2))).toThrow("non-finite differential");
  });

  it("retains the corrected bootstrap law while binding the DEE-992 score amendment", () => {
    expect(VALIDATION_BOOTSTRAP_VERSION).toBe("validation-bootstrap/v2");
    expect(RESEARCH_HARNESS_ADMISSION_VERSION).toBe("research-harness-admission/v4");
    expect(SCIENTIFIC_ADMISSION_RECEIPT_VERSION).toBe("scientific-admission-receipt/v4");
    const input = { comparisonFamilyId: "family", commonAnchorSetDigestHex: "a".repeat(64),
      terminalStatus: "NO_CHALLENGER_QUALIFIES" as const, holmComparisons: [] };
    const expected = createHash("sha256").update([
      "scientific-admission-receipt/v4", "multiclass-brier-reward/v1", "terminal-multiclass-brier-reward/v1",
      "694d625c2120d3e5410a7395646bd0bae728ea08e08fc8ea93043061cdb8d8de",
      "validation-bootstrap/v2", input.comparisonFamilyId,
      input.commonAnchorSetDigestHex, input.terminalStatus,
    ].join("\n")).digest("hex");
    expect(computeResearchHarnessAdmissionReceiptDigestV2(input)).toBe(expected);
  });
});
