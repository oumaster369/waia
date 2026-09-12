import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  deriveValidationBootstrapRoot,
  VALIDATION_BOOTSTRAP_VERSION,
  validationBootstrapResampleV1,
} from "@/lib/trader/research/benchmark/validation-bootstrap-v1";
import { computeResearchHarnessAdmissionReceiptDigestV2 } from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";

const TRIAL = Buffer.alloc(32, 7);
const ROOT_HEX = "31d14dfeaf1df6ffb2b99e71b0fa35b386e664e88b40fc3678ff7a5371444373";

// Independent executable transcription of DEE-518 §2.4.0 / §2.6.1.
// Deliberately does not import production RNG, address or block-length helpers.
function referenceIndices(n: number, replica: number, defectiveRestartBound = false): number[] {
  let length = 1n;
  while (length * length * length < BigInt(n)) length += 1n;
  const draw = (bound: number, position: number, ordinal: number): number => {
    const modulus = BigInt(bound);
    const limit = (1n << 64n) - ((1n << 64n) % modulus);
    for (let retry = 0; retry <= 0xffff_ffff; retry += 1) {
      const address = Buffer.alloc(64);
      address.write("WAIACBR1VALBOOT1", 0, "ascii");
      Buffer.from(ROOT_HEX, "hex").copy(address, 16);
      address.writeUInt32BE(replica, 48);
      address.writeUInt32BE(position, 52);
      address.writeUInt32BE(ordinal, 56);
      address.writeUInt32BE(retry, 60);
      const word = createHash("sha256").update(address).digest().readBigUInt64BE(0);
      if (word < limit) return Number(word % modulus);
    }
    throw new Error("reference rejection exhausted");
  };
  const indices = [draw(n, 0, 0)];
  for (let j = 1; j < n; j += 1) {
    indices.push(
      draw(defectiveRestartBound ? n : Number(length), j, 1) === 0
        ? draw(n, j, 0)
        : (indices[j - 1]! + 1) % n,
    );
  }
  return indices;
}

describe("DEE-947 frozen VALBOOT1 transition known answers", () => {
  it("preserves the frozen root bytes", () => {
    expect(deriveValidationBootstrapRoot(TRIAL).toString("hex")).toBe(ROOT_HEX);
  });

  it.each([
    { n: 1, length: 1, indices: [0] },
    { n: 8, length: 2, indices: [7, 5, 6, 1, 2, 3, 6, 4] },
    { n: 9, length: 3, indices: [5, 6, 0, 1, 2, 3, 4, 5, 6] },
    { n: 27, length: 3, indices: [23, 24, 0, 1, 2, 3, 4, 5, 6, 18, 19, 21, 13, 17, 15, 6, 7, 8, 2, 2, 17, 18, 3, 13, 14, 19, 6] },
    { n: 28, length: 4, indices: [11, 5, 6, 17, 18, 19, 20, 21, 22, 23, 9, 5, 6, 7, 8, 9, 10, 11, 18, 13, 17, 18, 19, 20, 21, 22, 23, 24] },
  ])("matches pinned and independent vectors at n=$n / L=$length", ({ n, length, indices }) => {
    expect(referenceIndices(n, 0)).toEqual(indices);
    const source = Array.from({ length: n }, (_, index) => `source-${index}`);
    const result = validationBootstrapResampleV1({
      source,
      validationBootstrapRoot: Buffer.from(ROOT_HEX, "hex"),
      resampleOrdinal: 0,
    });
    expect(result.blockLength).toBe(length);
    expect(result.indexVector).toEqual(indices);
    expect(result.resampled).toEqual(indices.map((index) => source[index]));
    if ([8, 27, 28].includes(n)) expect(indices).not.toEqual(referenceIndices(n, 0, true));
  });

  it("replays all addressed replicas identically, including circular wraps and multiplicity", () => {
    const source = Array.from({ length: 28 }, (_, index) => index);
    let observedWrap = false;
    const distinct = new Set<string>();
    for (const replica of [0, 1, 2, 31, 9999]) {
      const input = { source, validationBootstrapRoot: Buffer.from(ROOT_HEX, "hex"), resampleOrdinal: replica };
      const first = validationBootstrapResampleV1(input);
      expect(first.indexVector).toEqual(referenceIndices(source.length, replica));
      expect(validationBootstrapResampleV1(input)).toEqual(first);
      expect(new Set(first.indexVector).size).toBeLessThan(source.length);
      distinct.add(JSON.stringify(first.indexVector));
      observedWrap ||= first.indexVector.some((index, position) => position > 0 && index === 0 && first.indexVector[position - 1] === 27);
    }
    expect(distinct.size).toBe(5);
    expect(observedWrap).toBe(true);
  });

  it("still rejects invalid source, root and resample ordinal", () => {
    const input = { source: [1, 2], validationBootstrapRoot: Buffer.from(ROOT_HEX, "hex"), resampleOrdinal: 0 };
    expect(() => validationBootstrapResampleV1({ ...input, source: [] })).toThrow();
    expect(() => validationBootstrapResampleV1({ ...input, validationBootstrapRoot: Buffer.alloc(31) })).toThrow();
    expect(() => validationBootstrapResampleV1({ ...input, resampleOrdinal: -1 })).toThrow();
  });

  it("invalidates legacy evidence even when the measured p-value is unchanged", () => {
    const input = {
      comparisonFamilyId: "family",
      commonAnchorSetDigestHex: "a".repeat(64),
      holmComparisons: [{ comparisonId: "baseline", pValue: 1 / 10001 }],
      terminalStatus: "QUALIFIED" as const,
    };
    const comparisonLine = `baseline:${(1 / 10001).toFixed(12)}`;
    const legacyDigest = createHash("sha256").update([
      "scientific-admission-receipt/v2", "family", "a".repeat(64), "QUALIFIED", comparisonLine,
    ].join("\n")).digest("hex");
    const correctedDigest = createHash("sha256").update([
      "scientific-admission-receipt/v3", "validation-bootstrap/v2", "family", "a".repeat(64), "QUALIFIED", comparisonLine,
    ].join("\n")).digest("hex");
    expect(VALIDATION_BOOTSTRAP_VERSION).toBe("validation-bootstrap/v2");
    const brierDigest = createHash("sha256").update([
      "scientific-admission-receipt/v4", "multiclass-brier-reward/v1",
      "terminal-multiclass-brier-reward/v1",
      "694d625c2120d3e5410a7395646bd0bae728ea08e08fc8ea93043061cdb8d8de",
      "validation-bootstrap/v2", "family", "a".repeat(64), "QUALIFIED", comparisonLine,
    ].join("\n")).digest("hex");
    // DEE-993 binds the approved Cody amendment without changing this p-value or
    // VALBOOT1 law. Keep literal reference framing independent of runtime constants.
    const codyDigest = createHash("sha256").update([
      "scientific-admission-receipt/v5", "multiclass-brier-reward/v1",
      "terminal-multiclass-brier-reward/v1",
      "694d625c2120d3e5410a7395646bd0bae728ea08e08fc8ea93043061cdb8d8de",
      "validation-bootstrap/v2", "cdf-erf-cody715/v2",
      "7b8dfb5540833d8e915ecf2456594e366e0fc9c11c8e33f9df6a0732f3d8a09f",
      "family", "a".repeat(64), "QUALIFIED", comparisonLine,
    ].join("\n")).digest("hex");
    expect(brierDigest).toBe("708c51e6e5e80d288b11b660d4ed126022a083e7300635b0ec977ecfabdc53fe");
    expect(codyDigest).toBe("a11ddfe23c2e62a24508de3d7ba573ad96e5b8eecce859631be185075e3a8ee5");
    expect(computeResearchHarnessAdmissionReceiptDigestV2(input)).toBe(codyDigest);
    expect(new Set([legacyDigest, correctedDigest, brierDigest, codyDigest]).size).toBe(4);
    expect(brierDigest).not.toBe(correctedDigest);
    expect(correctedDigest).not.toBe(legacyDigest);
  });
});
