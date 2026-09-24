import { describe, expect, it } from "vitest";

import { presentResearchRun } from "@/lib/trader/admin-console/research/research-runs";

describe("admin console research runs", () => {
  it("uses a ratio when cycles exist and flags a running run idle for ten minutes", () => {
    const nowMs = Date.parse("2026-09-23T12:10:00.000Z");
    const fresh = presentResearchRun({
      organizationId: "org",
      runId: "run",
      phase: "RUNNING",
      committedCycles: 1,
      qualifiedTotalCycles: 4,
      observedAt: "2026-09-23T12:05:00.000Z",
      symbol: "BTCUSDT",
      partition: "DEVELOPMENT",
      nowMs,
    });
    expect(fresh.progress).toEqual({ kind: "ratio", value: expect.any(String) });
    expect(fresh.inactive).toBe(false);
    const idle = presentResearchRun({
      ...{
        organizationId: "org",
        runId: "run",
        phase: "RUNNING",
        committedCycles: 0,
        qualifiedTotalCycles: 0,
        observedAt: "2026-09-23T11:00:00.000Z",
        symbol: "BTCUSDT",
        partition: "DEVELOPMENT",
        nowMs,
      },
    });
    expect(idle.progress).toEqual({ kind: "count", value: 0 });
    expect(idle.inactive).toBe(true);
  });
});
