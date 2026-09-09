import { describe, expect, it } from "vitest";
import { TARGET_ROLE_EXECUTION, TARGET_ROLE_TERMINAL } from "@/lib/trader/intelligence/forecast-v2/constants";
import { computeDistributionSemanticDigest, computeExecutionAndTerminalDistributionSemanticDigests,
  type DistributionSemanticDigestInput } from "@/lib/trader/intelligence/forecast-v2/distribution-semantic-digest-v1";

function fixture(): Omit<DistributionSemanticDigestInput, "targetRoleId"> {
  const boundaryValues = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE,
    0.000000005, -0.000000005, 1.234567895, -1.234567895, 1e-40, 3.141592653589793, -2.718281828459045];
  return { forecastGenerationIdentityDigestHex: "a".repeat(64), predictivePackageContentDigestHex: "b".repeat(64),
    normalizationVersionDigestHex: "c".repeat(64), k: 3, m: 4,
    samples: Array.from({ length: 3 }, (_, k) => Array.from({ length: 4 }, (_, m) =>
      boundaryValues.map((_, c) => boundaryValues[(c + k + m) % 13]!))) };
}

describe("DEE-950 exact dual-role distribution encoding", () => {
  it("matches both retained scalar streams at quantizer boundaries and keeps role separation", () => {
    const input = fixture();
    const before = structuredClone(input);
    const paired = computeExecutionAndTerminalDistributionSemanticDigests(input);
    expect(paired.execution).toEqual(computeDistributionSemanticDigest({ ...input, targetRoleId: TARGET_ROLE_EXECUTION }));
    expect(paired.terminal).toEqual(computeDistributionSemanticDigest({ ...input, targetRoleId: TARGET_ROLE_TERMINAL }));
    expect(paired.execution).not.toEqual(paired.terminal);
    expect(input).toEqual(before);
  });

  it("does not reuse a result across input mutation or change sample ordering", () => {
    const input = fixture();
    const first = computeExecutionAndTerminalDistributionSemanticDigests(input);
    input.samples = [...input.samples].reverse();
    const second = computeExecutionAndTerminalDistributionSemanticDigests(input);
    expect(second.execution).not.toEqual(first.execution);
    expect(second.execution).toEqual(computeDistributionSemanticDigest({ ...input, targetRoleId: TARGET_ROLE_EXECUTION }));
    expect(second.terminal).toEqual(computeDistributionSemanticDigest({ ...input, targetRoleId: TARGET_ROLE_TERMINAL }));
  });

  it.each([NaN, Infinity, -Infinity])("retains complete refusal for nonfinite input %s", (bad) => {
    const input = fixture();
    (input.samples[2]![3]! as number[])[12] = bad;
    expect(() => computeExecutionAndTerminalDistributionSemanticDigests(input)).toThrow(/non-finite/);
    expect(() => computeDistributionSemanticDigest({ ...input, targetRoleId: TARGET_ROLE_EXECUTION })).toThrow(/non-finite/);
  });

  it.each([12, 14])("retains13component shape guard (length%s)", (length) => {
    const input = fixture();
    (input.samples[0] as number[][])[0] = Array(length).fill(0);
    expect(() => computeExecutionAndTerminalDistributionSemanticDigests(input)).toThrow(/13 components/);
  });

  it("refuses a missing sample and invalid digest header", () => {
    const input = fixture();
    input.samples = [];
    expect(() => computeExecutionAndTerminalDistributionSemanticDigests(input)).toThrow(/13 components/);
    expect(() => computeExecutionAndTerminalDistributionSemanticDigests({ ...fixture(),
      normalizationVersionDigestHex: "invalid" })).toThrow(/64-char lowercase hex/);
  });
});
