import { describe, expect, it } from "vitest";

import { resolveFhvCrossProcessPauseTestBarrierFromEnv } from "@/lib/trader/observability/fhv-rehearsal-pause-test-barrier";

describe("fhv-rehearsal-pause-test-barrier", () => {
  it("activates only under NODE_ENV=test with explicit boolean env", () => {
    expect(
      resolveFhvCrossProcessPauseTestBarrierFromEnv({
        NODE_ENV: "production",
        FHV_CROSS_PROCESS_PAUSE_BARRIER: "true",
      }),
    ).toBeNull();
    expect(
      resolveFhvCrossProcessPauseTestBarrierFromEnv({
        NODE_ENV: "test",
        FHV_CROSS_PROCESS_PAUSE_BARRIER: "false",
      }),
    ).toBeNull();
    expect(
      resolveFhvCrossProcessPauseTestBarrierFromEnv({
        NODE_ENV: "test",
        FHV_CROSS_PROCESS_PAUSE_BARRIER: "true",
        FHV_CROSS_PROCESS_PAUSE_BARRIER_CYCLE: "30",
      }),
    ).toEqual({
      enabled: true,
      holdAtCycle: 30,
      timeoutMs: 120_000,
    });
  });
});
