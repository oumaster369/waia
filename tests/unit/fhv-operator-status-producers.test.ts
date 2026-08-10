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
    expect(status.evidence.eventSequence).toBe(0);
    expect(status.campaign.processRestartCount).toBe(1);
  });
});
