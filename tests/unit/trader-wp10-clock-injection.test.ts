/**
 * HTR-WP10 — deterministic replay clock injection.
 */
import { describe, expect, it } from "vitest";

import { createManualReplayClock } from "@/lib/trader/research/deterministic-replay-clock";
import {
  createDeterministicReplayIdFactory,
  RESEARCH_REPLAY_CLOCK_START_MS,
} from "@/lib/trader/research/deterministic-replay-id-factory";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";

describe("HTR-WP10 clock injection", () => {
  it("manual replay clock holds injected time until advanced", () => {
    const clock = createManualReplayClock(RESEARCH_REPLAY_CLOCK_START_MS);
    expect(clock.nowMs()).toBe(RESEARCH_REPLAY_CLOCK_START_MS);
    clock.setNowMs(RESEARCH_REPLAY_CLOCK_START_MS + 60_000);
    expect(clock.nowMs()).toBe(RESEARCH_REPLAY_CLOCK_START_MS + 60_000);
  });

  it("default research session seeds clock from first golden-fixture bar close", async () => {
    const session = await createInMemoryResearchBacktestSession();
    try {
      expect(session.deps.researchReplayDeterminism?.clock.nowMs()).toBe(
        RESEARCH_REPLAY_CLOCK_START_MS,
      );
    } finally {
      session.cleanup();
    }
  });

  it("deterministic id factory is monotonic and stable across fresh factories with same seed", () => {
    const firstRun = [createDeterministicReplayIdFactory(900_001)()];
    const secondRun = [createDeterministicReplayIdFactory(900_001)()];
    expect(firstRun).toEqual(secondRun);
    const factory = createDeterministicReplayIdFactory(900_001);
    const ids = [factory(), factory(), factory()];
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[1]).not.toBe(ids[2]);
  });
});
