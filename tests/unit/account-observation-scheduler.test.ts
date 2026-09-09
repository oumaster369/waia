import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createObservationScheduler } from "@/lib/trader/account-observation/scheduler";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";

const b: ObservationBinding = { organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "account",
  credentialRevision: "1", configurationRevision: "config" };
const options = { intervalMs: 1000, iterationTimeoutMs: 2000, maxAccounts: 2 };
describe("bounded awaited account collection scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("runs without a browser, deduplicates accounts and releases timers on stop", async () => {
    const stop = new AbortController();
    const tick = vi.fn(async () => ({ status: "NOT_CLAIMED" as const }));
    const scheduler = createObservationScheduler({ loadAssignments: async () => [b, b],
      tick, clock: accountObservationClock, report: vi.fn() }, options);
    const work = scheduler.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop.abort(); await work;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("classifies dependency errors without leaking raw details", async () => {
    const stop = new AbortController(); const report = vi.fn();
    const scheduler = createObservationScheduler({ loadAssignments: async () => [b],
      tick: async () => { throw new Error("synthetic-sensitive"); }, clock: accountObservationClock, report }, options);
    const work = scheduler.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledWith("COLLECTION_FAILED");
    expect(JSON.stringify(report.mock.calls)).not.toContain("sensitive");
    stop.abort(); await work;
  });
  it("does not overlap a tick that ignores cancellation, and refuses a duplicate scheduler run", async () => {
    const stop = new AbortController(); let release!: () => void;
    const tick = vi.fn(() => new Promise<{ status: "FENCED" }>(resolve => {
      release = () => resolve({ status: "FENCED" });
    }));
    const scheduler = createObservationScheduler({ loadAssignments: async () => [b],
      tick, clock: accountObservationClock, report: vi.fn() }, options);
    const work = scheduler.run(stop.signal);
    await vi.advanceTimersByTimeAsync(3000);
    expect(tick).toHaveBeenCalledTimes(1);
    await expect(scheduler.run(stop.signal)).rejects.toThrow("ALREADY_RUNNING");
    stop.abort(); release(); await work;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects over-capacity assignments before any account read", async () => {
    const stop = new AbortController(); const tick = vi.fn();
    const report = vi.fn();
    const scheduler = createObservationScheduler({ loadAssignments: async () => [b, b, b],
      tick, clock: accountObservationClock, report }, options);
    const work = scheduler.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).not.toHaveBeenCalled(); expect(report).toHaveBeenCalledWith("ASSIGNMENTS_FAILED");
    stop.abort(); await work;
  });
  it("continues with the interrupted account instead of starving the end of each sweep", async () => {
    const stop = new AbortController();
    const bindings = [b, { ...b, exchangeAccountId: "account-b" }, { ...b, exchangeAccountId: "account-c" }];
    const attempts: string[] = []; const completed: string[] = [];
    const scheduler = createObservationScheduler({ loadAssignments: async () => bindings,
      tick: async (binding, signal) => {
        attempts.push(binding.exchangeAccountId);
        await accountObservationClock.sleep(900, signal);
        completed.push(binding.exchangeAccountId);
        return { status: "NOT_CLAIMED" };
      }, clock: accountObservationClock, report: vi.fn() }, { ...options, maxAccounts: 3 });
    const work = scheduler.run(stop.signal);
    await vi.advanceTimersByTimeAsync(4000);
    expect(attempts.slice(0, 4)).toEqual(["account", "account-b", "account-c", "account-c"]);
    expect(completed).toContain("account-c");
    stop.abort(); await work; expect(vi.getTimerCount()).toBe(0);
  });
  it("drops an interrupted assignment removed before the next sweep and still deduplicates", async () => {
    const stop = new AbortController();
    const removed = { ...b, exchangeAccountId: "removed" };
    let bindings = [b, removed]; const attempts: string[] = [];
    const scheduler = createObservationScheduler({ loadAssignments: async () => bindings,
      tick: async (binding, signal) => {
        attempts.push(binding.exchangeAccountId);
        await accountObservationClock.sleep(1500, signal);
        return { status: "NOT_CLAIMED" };
      }, clock: accountObservationClock, report: vi.fn() }, { ...options, maxAccounts: 3 });
    const work = scheduler.run(stop.signal);
    await vi.advanceTimersByTimeAsync(2100);
    bindings = [b, b, { ...b, exchangeAccountId: "replacement" }];
    await vi.advanceTimersByTimeAsync(2600);
    expect(attempts).toEqual(["account", "removed", "account", "replacement"]);
    stop.abort(); await work; expect(vi.getTimerCount()).toBe(0);
  });
});
