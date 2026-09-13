import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { emitTechnicalPreparationProgressV2, flushTechnicalPreparationProgressV2, snapshotTechnicalPreparationObserverV2 } from
  "@/lib/trader/historical-simulation-v2/technical-preparation-observer-v2";
import { validationBootstrapPValueAsyncV1, validationBootstrapPValueV1 } from
  "@/lib/trader/research/benchmark/validation-bootstrap-v1";

const scope = { organizationId: "11111111-1111-4111-8111-111111111111", runId: "synthetic",
  releaseSha: "a".repeat(40) };
afterEach(() => vi.unstubAllEnvs());
describe("process-local technical preparation observer", () => {
  it("owns the progress barrier and checks cancellation after its pending write", async () => {
    vi.stubEnv("WAIA_TRADER_CLI", "1");
    const controller = new AbortController();
    const flush = vi.fn(async () => { controller.abort(); });
    const input = { signal: controller.signal, flushProgress: flush };
    const observer = snapshotTechnicalPreparationObserverV2(input);
    input.flushProgress = vi.fn(async () => {});
    await expect(flushTechnicalPreparationProgressV2(observer)).rejects.toThrow(/CANCELLED/);
    expect(flush).toHaveBeenCalledOnce(); expect(input.flushProgress).not.toHaveBeenCalled();
  });
  it.each([undefined, 2])("never returns a successful bootstrap if the journal drain fails, workers=%s", async nodeWorkerCount => {
    vi.stubEnv("WAIA_TRADER_CLI", "1");
    const failure = new Error("JOURNAL_WRITE_FAILED");
    await expect(validationBootstrapPValueAsyncV1({ differentials: [1, -2, 3], trialIdentityDigest32: Buffer.alloc(32, 9) },
      { nodeWorkerCount, flushProgress: async () => { throw failure; } })).rejects.toBe(failure);
  });
  it("refuses caller observers outside the Node CLI", () => {
    vi.stubEnv("WAIA_TRADER_CLI", "0");
    expect(snapshotTechnicalPreparationObserverV2()).toEqual({ signal: undefined, onProgress: undefined });
    expect(() => snapshotTechnicalPreparationObserverV2({ onProgress: () => {} })).toThrow(/NODE_CLI/);
  });
  it("snapshots the sink and exports only immutable diagnostic fields, never caller extras", () => {
    vi.stubEnv("WAIA_TRADER_CLI", "1");
    const sink = vi.fn(); const input = { onProgress: sink };
    const observer = snapshotTechnicalPreparationObserverV2(input);
    input.onProgress = vi.fn();
    const richerScope = { ...scope, password: "NEVER_EMIT" };
    emitTechnicalPreparationProgressV2(observer, richerScope,
      { phase: "SCIENTIFIC_PREPARATION", secret: "NEVER_EMIT" } as never);
    const event = sink.mock.calls[0]![0];
    expect(Object.isFrozen(event)).toBe(true);
    expect(event).toMatchObject({ ...scope, authorityGranted: false });
    expect(JSON.stringify(event)).not.toContain("NEVER_EMIT");
    expect(input.onProgress).not.toHaveBeenCalled();
  });
  it("propagates sink errors and cancellation without success", () => {
    vi.stubEnv("WAIA_TRADER_CLI", "1");
    const controller = new AbortController(); const sink = vi.fn(() => controller.abort());
    const observer = snapshotTechnicalPreparationObserverV2({ signal: controller.signal, onProgress: sink });
    expect(() => emitTechnicalPreparationProgressV2(observer, scope,
      { phase: "FORECAST_ANCHORS", completed: 0, total: 32 })).toThrow(/CANCELLED/);
    expect(() => snapshotTechnicalPreparationObserverV2(observer)).toThrow(/CANCELLED/);
    const failure = new Error("sink failed");
    expect(() => emitTechnicalPreparationProgressV2({ onProgress: () => { throw failure; } }, scope,
      { phase: "SURFACE_LOAD" })).toThrow(failure);
  });
  it.each([undefined, 2])("binds every bootstrap progress event to the exact owned trial, workers=%s", async nodeWorkerCount => {
    vi.stubEnv("WAIA_TRADER_CLI", "1");
    const trial = createHash("sha256").update("DEE950-observation-parity").digest();
    const input = { differentials: [1, -2, 3, -1, 2], trialIdentityDigest32: trial };
    const expected = validationBootstrapPValueV1(input);
    const digest = trial.toString("hex"); let count = 0;
    const actual = await validationBootstrapPValueAsyncV1(input, { nodeWorkerCount,
      onProgress: event => {
        expect(event.trialIdentityDigestHex).toBe(digest);
        expect(event.completed).toBeGreaterThan(count); count = event.completed;
        trial.fill(0); // Must not change an in-flight sampler or diagnostic identity.
      },
    });
    expect(count).toBe(10000); expect(actual).toEqual(expected);
  }, 30_000);
});
