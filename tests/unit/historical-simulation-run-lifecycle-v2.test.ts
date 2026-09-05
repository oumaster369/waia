import { describe, expect, it } from "vitest";

import {
  buildHistoricalSimulationRunLifecycleEventV2,
  projectHistoricalSimulationRunLifecycleV2,
} from "@/lib/trader/historical-simulation-v2/run-lifecycle-v2";

const seed = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  accountId: "historical-account",
  runId: "historical-main-run",
  partition: "WALK_FORWARD" as const,
  symbol: "BTCUSDT" as const,
  eventSequence: 0,
  phase: "QUEUED" as const,
  initialRecordIndex: 240,
  terminalRecordIndexExclusive: 1240,
  qualifiedTotalCycles: 1000,
  committedCycles: 0,
  nextCycleSequence: 0,
  latestCommittedCycleId: null,
  requestedByOperatorId: "operator-a",
  observedAt: "2026-09-03T09:00:00.000Z",
  errorCode: null,
  previousContentDigestHex: null,
};

describe("Historical Simulation V2 durable run lifecycle", () => {
  it("derives exact qualified progress from a content-sealed lifecycle event", () => {
    const queued = buildHistoricalSimulationRunLifecycleEventV2(seed);
    const running = buildHistoricalSimulationRunLifecycleEventV2({
      ...seed,
      eventSequence: 1,
      phase: "RUNNING",
      committedCycles: 250,
      nextCycleSequence: 250,
      latestCommittedCycleId: "cycle-249",
      previousContentDigestHex: queued.contentDigestHex,
    });
    expect(projectHistoricalSimulationRunLifecycleV2(running)).toMatchObject({
      phase: "RUNNING",
      qualifiedTotalCycles: 1000,
      committedCycles: 250,
      remainingCycles: 750,
      progressBps: 2500,
    });
  });

  it("refuses caller-inflated totals, skipped progress, broken lineage, and false completion", () => {
    expect(() => buildHistoricalSimulationRunLifecycleEventV2({
      ...seed, qualifiedTotalCycles: 1001,
    })).toThrow("RUN_LIFECYCLE_REFUSED:EVENT");
    expect(() => buildHistoricalSimulationRunLifecycleEventV2({
      ...seed, committedCycles: 1, nextCycleSequence: 2,
      latestCommittedCycleId: "cycle-0",
    })).toThrow("RUN_LIFECYCLE_REFUSED:EVENT");
    expect(() => buildHistoricalSimulationRunLifecycleEventV2({
      ...seed, eventSequence: 1, previousContentDigestHex: null,
    })).toThrow("RUN_LIFECYCLE_REFUSED:EVENT");
    expect(() => buildHistoricalSimulationRunLifecycleEventV2({
      ...seed, phase: "COMPLETED",
    })).toThrow("RUN_LIFECYCLE_REFUSED:EVENT");
  });

  it("keeps blind holdout outside the lifecycle vocabulary", () => {
    expect(() => buildHistoricalSimulationRunLifecycleEventV2({
      ...seed, partition: "BLIND_HOLDOUT" as never,
    })).toThrow("RUN_LIFECYCLE_REFUSED:EVENT");
  });
});
