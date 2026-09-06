// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { validationBootstrapPValueNodeParallelV1 } from "../../scripts/trader/validation-bootstrap-node-pool";
import { INTERNAL_validationBootstrapOrdinalRangeV1, validationBootstrapPValueV1 } from
  "@/lib/trader/research/benchmark/validation-bootstrap-v1";
import { independentValidationPValue } from "./helpers/validation-bootstrap-independent-reference";

const fixture = () => ({ differentials: Array.from({ length: 31 }, (_, i) => Math.sin(i * 0.731)),
  trialIdentityDigest32: Buffer.alloc(32, 0x55) });

describe("DEE-950 exact Node worker ranges", () => {
  it("partitions all ordinals without changing the full scalar result", () => {
    const input = fixture();
    const expected = validationBootstrapPValueV1(input);
    const parts = [INTERNAL_validationBootstrapOrdinalRangeV1(input, 0, 3333),
      INTERNAL_validationBootstrapOrdinalRangeV1(input, 3333, 9001),
      INTERNAL_validationBootstrapOrdinalRangeV1(input, 9001, 10000)];
    expect(parts.reduce((sum, part) => sum + part.extremeCount, 0)).toBe(expected.extremeCount);
    for (const part of parts) {
      expect(part).not.toHaveProperty("pRaw");
      expect(part.dBar).toBe(expected.dBar);
      expect(part.centeredMean).toBe(expected.centeredMean);
      expect(part.tObs).toBe(expected.tObs);
    }
  });

  it.each([[0, 0], [-1, 1], [1, 10001], [0.5, 1], [5, 4]])("refuses invalid range%s..%s", (start, end) => {
    expect(() => INTERNAL_validationBootstrapOrdinalRangeV1(fixture(), start, end)).toThrow(/INVALID_ORDINAL_RANGE/);
  });

  it.each([1, 2, 4])("matches independent fullB10000 oracle with%s actual workers", async (workerCount) => {
    const input = fixture();
    const expected = independentValidationPValue(input.differentials, input.trialIdentityDigest32);
    const progress: number[] = [];
    const actual = await validationBootstrapPValueNodeParallelV1(input, { workerCount, onProgress: value => {
      expect(Object.isFrozen(value)).toBe(true);
      expect(value.total).toBe(10000);
      progress.push(value.completed);
    } });
    expect(actual).toEqual(expected);
    expect(progress.at(-1)).toBe(10000);
    expect(progress.every((value, i) => i === 0 || value > progress[i - 1]!)).toBe(true);
  }, 30000);

  it("owns input before callbacks mutate caller values", async () => {
    const input = fixture();
    const expected = validationBootstrapPValueV1(input);
    expect(await validationBootstrapPValueNodeParallelV1(input, { onProgress: () => {
      input.differentials.fill(NaN); input.trialIdentityDigest32.fill(0);
    } })).toEqual(expected);
  }, 30000);

  it("refuses pre-cancelled, mid-run and final-boundary cancellations without partialp", async () => {
    for (const boundary of [0, 32, 10000]) {
      const controller = new AbortController();
      if (boundary === 0) controller.abort();
      await expect(validationBootstrapPValueNodeParallelV1(fixture(), { signal: controller.signal,
        onProgress: ({ completed }) => { if (completed >= boundary) controller.abort(); },
      })).rejects.toThrow("VALIDATION_BOOTSTRAP_CANCELLED");
    }
  }, 30000);

  it("preserves progress-sink failure and validates input before spawning", async () => {
    const error = new Error("sink failed");
    await expect(validationBootstrapPValueNodeParallelV1(fixture(), { onProgress: () => { throw error; } })).rejects.toBe(error);
    await expect(validationBootstrapPValueNodeParallelV1({ ...fixture(), differentials: [NaN] })).rejects.toThrow(/non-finite/);
    await expect(validationBootstrapPValueNodeParallelV1(fixture(), { workerCount: 5 })).rejects.toThrow(/WORKERS_MUST/);
  }, 30000);

  it("rejects a failed worker startup instead of hanging or falling back to a fabricated result", async () => {
    const prior = process.cwd();
    try {
      process.chdir(join(prior, "node_modules"));
      await expect(validationBootstrapPValueNodeParallelV1(fixture())).rejects.toThrow(/Cannot find module/);
    } finally { process.chdir(prior); }
  }, 30000);
});
