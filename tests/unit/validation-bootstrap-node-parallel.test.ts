// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { validationBootstrapPValueNodeParallelV1 } from "../../scripts/trader/validation-bootstrap-node-pool";
import { INTERNAL_validationBootstrapOrdinalRangeV1, validationBootstrapPValueV1,
  INTERNAL_createValidationBootstrapRangeEvaluatorV1,
  validationBootstrapPValueAsyncV1, validationBootstrapExecutionFromEnvironmentV1 } from
  "@/lib/trader/research/benchmark/validation-bootstrap-v1";
import { independentValidationPValue } from "./helpers/validation-bootstrap-independent-reference";

const fixture = () => ({ differentials: Array.from({ length: 31 }, (_, i) => Math.sin(i * 0.731)),
  trialIdentityDigest32: Buffer.alloc(32, 0x55) });

describe("DEE-950 exact Node worker ranges", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("owns one prepared input across out-of-order worker ranges and caller mutation", () => {
    const input = fixture();
    const expected = independentValidationPValue(input.differentials, input.trialIdentityDigest32);
    const evaluate = INTERNAL_createValidationBootstrapRangeEvaluatorV1(input);
    input.differentials.fill(NaN);
    input.trialIdentityDigest32.fill(0);
    const second = evaluate(5000, 10000);
    const first = evaluate(0, 5000);
    expect(first.extremeCount + second.extremeCount).toBe(expected.extremeCount);
    for (const part of [first, second]) {
      expect(part).not.toHaveProperty("pRaw");
      expect(part).toMatchObject({ n: expected.n, dBar: expected.dBar,
        tObs: expected.tObs, centeredMean: expected.centeredMean });
    }
    expect(evaluate(0, 5000)).toEqual(first);
    expect(() => evaluate(-1, 0)).toThrow("INVALID_ORDINAL_RANGE");
  });

  it("explicit async selection owns input before dynamic import and returns the actual exact result", async () => {
    vi.stubEnv("WAIA_TRADER_CLI", "1");
    const input = fixture();
    const expected = validationBootstrapPValueV1(input);
    const result = validationBootstrapPValueAsyncV1(input, { nodeWorkerCount: 2 });
    input.differentials.fill(NaN);
    input.trialIdentityDigest32.fill(0);
    expect(await result).toEqual(expected);
  }, 30000);

  it("refuses invalid configuration or non-CLI selection; unset configuration preserves default", async () => {
    vi.stubEnv("WAIA_TRADER_CLI", "");
    expect(validationBootstrapExecutionFromEnvironmentV1({})).toEqual({});
    expect(() => validationBootstrapExecutionFromEnvironmentV1({ WAIA_FHV_VALIDATION_WORKERS: "2" }))
      .toThrow("VALIDATION_BOOTSTRAP_NODE_CLI_REQUIRED");
    await expect(validationBootstrapPValueAsyncV1(fixture(), { nodeWorkerCount: 2 }))
      .rejects.toThrow("VALIDATION_BOOTSTRAP_NODE_CLI_REQUIRED");
    vi.stubEnv("WAIA_TRADER_CLI", "1");
    for (const raw of ["", "0", "5", "02", " 2", "2.1", "Infinity"]) {
      expect(() => validationBootstrapExecutionFromEnvironmentV1({ WAIA_FHV_VALIDATION_WORKERS: raw }))
        .toThrow("VALIDATION_BOOTSTRAP_WORKERS_MUST_BE_1_TO_4");
    }
    expect(validationBootstrapExecutionFromEnvironmentV1({ WAIA_FHV_VALIDATION_WORKERS: "4" }))
      .toMatchObject({ nodeWorkerCount: 4 });
  });
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
