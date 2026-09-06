import { describe, expect, it } from "vitest";
import { validationBootstrapPValueAsyncV1, validationBootstrapPValueV1 } from
  "@/lib/trader/research/benchmark/validation-bootstrap-v1";
import { independentValidationPValue } from "./helpers/validation-bootstrap-independent-reference";

const fixture = () => ({ differentials: Array.from({ length: 31 }, (_, i) => Math.sin(i * 0.731)),
  trialIdentityDigest32: Buffer.alloc(32, 0x55) });

describe("DEE-950 cooperative exact bootstrap", () => {
  it("preserves full B=10000 independent oracle values and emits monotone progress", async () => {
    const input = fixture();
    const expected = independentValidationPValue(input.differentials, input.trialIdentityDigest32);
    const progress: number[] = [];
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; }, 0);
    try {
      const actual = await validationBootstrapPValueAsyncV1(input, { onProgress: (value) => {
        expect(Object.isFrozen(value)).toBe(true);
        expect(value.total).toBe(10000);
        progress.push(value.completed);
      } });
      expect(actual).toEqual(expected);
      expect(Object.is(actual.centeredMean, expected.centeredMean)).toBe(true);
      expect(timerRan).toBe(true);
      expect(progress.at(-1)).toBe(10000);
      expect(progress.every((v, i) => i === 0 || v > progress[i - 1]!)).toBe(true);
      expect(progress.length).toBeGreaterThan(1);
    } finally { clearTimeout(timer); }
  });

  it("owns centered values and trial root before callbacks can mutate caller input", async () => {
    const input = fixture();
    const expected = validationBootstrapPValueV1(input);
    const result = await validationBootstrapPValueAsyncV1(input, { onProgress: () => {
      input.differentials.fill(Number.NaN);
      input.trialIdentityDigest32.fill(0);
    } });
    expect(result).toEqual(expected);
  });

  it("refuses pre-cancelled work without producing progress or a result", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(validationBootstrapPValueAsyncV1(fixture(), { signal: controller.signal,
      onProgress: () => { calls++; } })).rejects.toThrow("VALIDATION_BOOTSTRAP_CANCELLED");
    expect(calls).toBe(0);
  });

  it("services timer cancellation between batches and refuses any partial p-value", async () => {
    const controller = new AbortController();
    let last = 0;
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await expect(validationBootstrapPValueAsyncV1(fixture(), { signal: controller.signal,
        onProgress: ({ completed }) => { last = completed; } })).rejects.toThrow("VALIDATION_BOOTSTRAP_CANCELLED");
      expect(last).toBeGreaterThan(0);
      expect(last).toBeLessThan(10000);
    } finally { clearTimeout(timer); }
  });

  it("refuses final-boundary cancellation even after all resamples were computed", async () => {
    const controller = new AbortController();
    await expect(validationBootstrapPValueAsyncV1(fixture(), { signal: controller.signal,
      onProgress: ({ completed }) => { if (completed === 10000) controller.abort(); },
    })).rejects.toThrow("VALIDATION_BOOTSTRAP_CANCELLED");
  });

  it("preserves progress sink failure rather than claiming successful qualification", async () => {
    const failure = new Error("progress sink failed");
    await expect(validationBootstrapPValueAsyncV1(fixture(), { onProgress: () => { throw failure; } }))
      .rejects.toBe(failure);
  });

  it("preserves non-finite refusal before any progress", async () => {
    await expect(validationBootstrapPValueAsyncV1({ ...fixture(), differentials: [Infinity] }))
      .rejects.toThrow("qualification refused");
  });
});
