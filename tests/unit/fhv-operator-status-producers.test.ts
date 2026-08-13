import { describe, expect, it } from "vitest";

import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";

const BASE_INPUT = {
  runId: "dee-525-status-run",
  phase: "REPLAY",
  codeSha: "sha525",
  artifactDigest: "artifact-digest",
  datasetSeal: "dataset-seal",
  datasetDigest: "dataset-digest",
  configurationDigest: "config-digest",
} as const;

describe("DEE-525 FHV operator status producers", () => {
  it("uses null instead of fabricated zero when checkpoint is absent", () => {
    const status = buildFhvOperatorStatusV1(BASE_INPUT);
    expect(status.campaign.barsProcessed).toBeNull();
    expect(status.campaign.throughputCurrent).toBeNull();
    expect(status.campaign.throughputRolling).toBeNull();
    expect(status.campaign.processRestartCount).toBeNull();
    expect(status.strategies.signalsCreated).toBeNull();
    expect(status.strategies.signalsRejected).toBeNull();
    expect(status.strategies.eligibility).toBeNull();
    expect(status.tradingSimulation.ordersCount).toBeNull();
    expect(status.tradingSimulation.fillsCount).toBeNull();
    expect(status.tradingSimulation.openPositionsCount).toBeNull();
    expect(status.tradingSimulation.closedPositionsCount).toBeNull();
    expect(status.evidence.eventSequence).toBeNull();
    expect(status.host.processStatus).toBeNull();
    expect(status.host.serviceStatus).toBeNull();
    expect(status.host.datasetReadable).toBeNull();
    expect(status.tradingSimulation.reconciliationState).toBeNull();
  });

  it("populates authoritative counts when checkpoint is present", () => {
    const status = buildFhvOperatorStatusV1({
      ...BASE_INPUT,
      barsProcessed: 42,
      processRestartCount: 1,
      checkpoint: {
        evidenceDurableThroughCycleIndex: 42,
        executionState: { openOrders: [{ id: "o1" }] },
        accountingFrontierState: {
          consumedFillIds: ["f1"],
          positionsJson: { BTC: {} },
          accountingSequence: 7,
        },
      } as never,
    });
    expect(status.campaign.barsProcessed).toBe(42);
    expect(status.tradingSimulation.ordersCount).toBe(1);
    expect(status.tradingSimulation.fillsCount).toBe(1);
    expect(status.tradingSimulation.openPositionsCount).toBe(1);
    // Checkpoint presence is not an evidence-event sequence producer (DEE-525).
    expect(status.evidence.eventSequence).toBeNull();
    expect(status.campaign.processRestartCount).toBe(1);
  });

  it("returns 0 for trading counts when checkpoint observations are empty", () => {
    const status = buildFhvOperatorStatusV1({
      ...BASE_INPUT,
      checkpoint: {
        evidenceDurableThroughCycleIndex: 1,
        executionState: { openOrders: [] },
        accountingFrontierState: {
          consumedFillIds: [],
          positionsJson: {},
          accountingSequence: 0,
        },
      } as never,
    });
    expect(status.tradingSimulation.ordersCount).toBe(0);
    expect(status.tradingSimulation.fillsCount).toBe(0);
    expect(status.tradingSimulation.openPositionsCount).toBe(0);
    expect(status.evidence.eventSequence).toBeNull();
  });

  it("returns the authoritative evidence sequence when a producer supplies it", () => {
    const zero = buildFhvOperatorStatusV1({
      ...BASE_INPUT,
      checkpoint: {
        evidenceDurableThroughCycleIndex: 1,
        executionState: { openOrders: [] },
      } as never,
      authoritativeEvidenceEventSequence: 0,
    });
    expect(zero.evidence.eventSequence).toBe(0);
    const positive = buildFhvOperatorStatusV1({
      ...BASE_INPUT,
      checkpoint: {
        evidenceDurableThroughCycleIndex: 1,
        executionState: { openOrders: [] },
      } as never,
      authoritativeEvidenceEventSequence: 7,
    });
    expect(positive.evidence.eventSequence).toBe(7);
  });
});
