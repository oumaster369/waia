import { describe, expect, it, vi } from "vitest";
import { createObservationFailureTrace, type ObservationFailureStage } from "@/lib/trader/account-observation/failure-stage";
import { handleAccountObservationGet, type ObservationReadDependencies } from "@/lib/trader/account-observation/read-handler";

const binding = { organizationId: "00000000-0000-4000-8000-000000000001", credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "synthetic-account-canary", credentialRevision: "1", configurationRevision: "synthetic-config-canary" };
const request = () => new Request("https://local.invalid/observation?" + new URLSearchParams(binding));
type TestDependencies = { -readonly [K in keyof ObservationReadDependencies]: ObservationReadDependencies[K] };
function dependencies(): TestDependencies {
  return { getUserId: async () => "synthetic-user-canary", hasTraderAccess: async () => true,
    hasOrgMembership: async () => true, hasOperatorAccess: async () => true, isAdminListedOrganization: async () => true,
    resolveActiveBinding: async () => binding, readLatest: async () => null };
}

describe("one request-owned closed failure record", () => {
  it("redacts input/error canaries, clamps time and preserves nested failure stage", async () => {
    const sink = vi.fn(); let now = 10;
    const trace = createObservationFailureTrace(sink, () => now);
    const deps = dependencies(); deps.failureTrace = trace;
    deps.resolveActiveBinding = async () => {
      trace.enter("PROJECTION_BODY"); trace.capture("THREW");
      trace.enter("PROJECTION_REQUEST"); throw new Error("synthetic-token-query-cookie-canary");
    };
    now = 999_999;
    const result = await handleAccountObservationGet(request(), "tenant", deps);
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "ACCOUNT_OBSERVATION_UNAVAILABLE" });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({ event: "ACCOUNT_OBSERVATION_FAILURE", stage: "PROJECTION_BODY", outcome: "THREW", elapsedMs: 5000 });
    trace.report("THREW"); trace.report("TIMEOUT"); expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/canary|cookie|token|query/i);
  });
  it.each(["getUserId", "hasTraderAccess", "hasOrgMembership"] as const)("reports a thrown pre-fetch %s stage without projection", async dependency => {
    const stages = { getUserId: "SESSION_INITIAL", hasTraderAccess: "ENTITLEMENT", hasOrgMembership: "MEMBERSHIP" };
    const sink = vi.fn(), deps = dependencies(); deps.failureTrace = createObservationFailureTrace(sink, () => 1);
    deps[dependency] = async () => { throw new Error("private-driver-canary"); };
    deps.resolveActiveBinding = vi.fn();
    expect((await handleAccountObservationGet(request(), "tenant", deps)).status).toBe(503);
    expect(sink.mock.calls[0][0].stage).toBe(stages[dependency]);
    expect(deps.resolveActiveBinding).not.toHaveBeenCalled();
  });
  it("distinguishes uncached session recheck failure", async () => {
    const sink = vi.fn(), deps = dependencies(); deps.failureTrace = createObservationFailureTrace(sink);
    let calls = 0; deps.getUserId = async () => { if (++calls === 2) throw new Error("private"); return "user"; };
    expect((await handleAccountObservationGet(request(), "tenant", deps)).status).toBe(503);
    expect(sink.mock.calls[0][0].stage).toBe("SESSION_RECHECK");
  });
  it("does not log success or access denial, and a throwing sink never changes failure", async () => {
    const sink = vi.fn(); const good = dependencies(); good.failureTrace = createObservationFailureTrace(sink);
    expect((await handleAccountObservationGet(request(), "tenant", good)).status).toBe(204);
    const denied = dependencies(); denied.failureTrace = createObservationFailureTrace(sink); denied.hasTraderAccess = async () => false;
    expect((await handleAccountObservationGet(request(), "tenant", denied)).status).toBe(403);
    expect(sink).not.toHaveBeenCalled();
    const bad = dependencies(); bad.failureTrace = createObservationFailureTrace(() => { throw new Error("sink-private"); });
    bad.getUserId = async () => { throw new Error("auth-private"); };
    expect((await handleAccountObservationGet(request(), "tenant", bad)).status).toBe(503);
  });
  it("emits one timeout record and suppresses late rejection", async () => {
    vi.useFakeTimers();
    try {
      const sink = vi.fn(), deps = dependencies(); deps.failureTrace = createObservationFailureTrace(sink);
      let reject!: (e: Error) => void; deps.getUserId = () => new Promise((_, fail) => { reject = fail; });
      const result = handleAccountObservationGet(request(), "tenant", deps);
      await vi.advanceTimersByTimeAsync(5000); expect((await result).status).toBe(503);
      reject(new Error("late-private-canary")); await Promise.resolve(); await Promise.resolve();
      expect(sink).toHaveBeenCalledTimes(1); expect(sink.mock.calls[0][0]).toMatchObject({ stage: "SESSION_INITIAL", outcome: "TIMEOUT" });
    } finally { vi.useRealTimers(); }
  });
  it("refuses unexpected stage values and handles a failing clock", () => {
    const sink = vi.fn(), trace = createObservationFailureTrace(sink, () => { throw new Error("clock-private"); });
    trace.enter("private-query-canary" as ObservationFailureStage); trace.report("THREW");
    expect(sink.mock.calls[0][0]).toEqual({ event: "ACCOUNT_OBSERVATION_FAILURE", stage: "REQUEST", outcome: "THREW", elapsedMs: 0 });
  });
});


it("default telemetry sink emits one exact finite JSON string", () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const trace = createObservationFailureTrace(undefined, () => 1);
    trace.enter("PROJECTION_STATUS"); trace.capture("HTTP_403"); trace.report("THREW"); trace.report("TIMEOUT");
    expect(log).toHaveBeenCalledTimes(1); expect(log.mock.calls[0]).toHaveLength(1);
    expect(log.mock.calls[0][0]).toBe('{"event":"ACCOUNT_OBSERVATION_FAILURE","stage":"PROJECTION_STATUS","outcome":"HTTP_403","elapsedMs":0}');
    expect(Object.keys(JSON.parse(log.mock.calls[0][0] as string))).toEqual(["event", "stage", "outcome", "elapsedMs"]);
  } finally { log.mockRestore(); }
});
