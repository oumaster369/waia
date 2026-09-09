import { describe, expect, it, vi } from "vitest";
import { withHistoricalLaunchCleanupV2 } from
  "@/lib/trader/historical-simulation-v2/launch-cleanup-v2";

describe("Historical launch primary error preservation", () => {
  it("retains primary and every cleanup failure while attempting all steps in order", async () => {
    const primary = new RangeError("PRIMARY_BOOTSTRAP_FAILURE");
    const unlock = new Error("UNLOCK_FAILURE");
    const reset = new Error("RESET_FAILURE");
    const release = new Error("RELEASE_FAILURE");
    const calls: string[] = [];
    const error = await withHistoricalLaunchCleanupV2(async () => { throw primary; }, [
      async () => { calls.push("unlock"); throw unlock; },
      async () => { calls.push("reset"); throw reset; },
      () => { calls.push("release"); throw release; },
    ]).catch((failure: unknown) => failure);
    expect(calls).toEqual(["unlock", "reset", "release"]);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).cause).toBe(primary);
    expect((error as AggregateError).errors).toEqual([primary, unlock, reset, release]);
    expect((error as Error).message).toBe("HISTORICAL_LAUNCH_PRIMARY_AND_CLEANUP_FAILED");
  });

  it("preserves the exact primary error when cleanup succeeds, including thrown undefined", async () => {
    const cleanup = vi.fn();
    const primary = new Error("PRIMARY");
    await expect(withHistoricalLaunchCleanupV2(async () => { throw primary; }, [cleanup]))
      .rejects.toBe(primary);
    await expect(withHistoricalLaunchCleanupV2(async () => { throw undefined; }, [cleanup]))
      .rejects.toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("does not report successful completion when only cleanup failed", async () => {
    const cleanup = new Error("postgresql://example.invalid/not-logged");
    const failure = await withHistoricalLaunchCleanupV2(async () => 42,
      [async () => { throw cleanup; }]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as Error).message).toBe("HISTORICAL_LAUNCH_CLEANUP_FAILED");
    expect((failure as AggregateError).cause).toBe(cleanup);
    expect((failure as Error).message).not.toContain("postgresql");
  });

  it("returns success unchanged when all cleanup succeeds", async () => {
    const result = Object.freeze({ status: "PASS" });
    expect(await withHistoricalLaunchCleanupV2(async () => result, [vi.fn()])).toBe(result);
  });
});
