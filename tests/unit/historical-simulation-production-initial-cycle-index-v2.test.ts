import { describe, expect, it } from "vitest";
import { loadHistoricalSimulationInitialRecordIndexV2 } from
  "@/lib/trader/historical-simulation-v2/production-initial-cycle-index-v2";

const request = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  accountId: "account",
  runId: "run",
  partition: "WALK_FORWARD" as const,
  symbol: "BTCUSDT" as const,
};

describe("Historical Simulation V2 authenticated initial record index", () => {
  it("derives the non-zero predictive/economic boundary from run-start lineage", async () => {
    const tx = (async () => [{ record_index: 999,
      cycle_id: "run:WALK_FORWARD:BTCUSDT:999",
      preregistration_cycle_id: "run:WALK_FORWARD:BTCUSDT:999" }]) as never;
    await expect(loadHistoricalSimulationInitialRecordIndexV2({ tx, ...request }))
      .resolves.toBe(999);
  });

  it.each([
    { rows: [] },
    { rows: [{ record_index: 999, cycle_id: "run:WALK_FORWARD:BTCUSDT:999",
      preregistration_cycle_id: "run:WALK_FORWARD:BTCUSDT:999" },
    { record_index: 1000, cycle_id: "run:WALK_FORWARD:BTCUSDT:1000",
      preregistration_cycle_id: "run:WALK_FORWARD:BTCUSDT:1000" }] },
    { rows: [{ record_index: 999, cycle_id: "run:WALK_FORWARD:BTCUSDT:999",
      preregistration_cycle_id: "run:WALK_FORWARD:BTCUSDT:998" }] },
    { rows: [{ record_index: 999, cycle_id: "run:WALK_FORWARD:ETHUSDT:999",
      preregistration_cycle_id: "run:WALK_FORWARD:ETHUSDT:999" }] },
    { rows: [{ record_index: -1, cycle_id: "run:WALK_FORWARD:BTCUSDT:-1",
      preregistration_cycle_id: "run:WALK_FORWARD:BTCUSDT:-1" }] },
  ])("refuses missing, ambiguous or spliced lineage %#", async ({ rows }) => {
    const tx = (async () => rows) as never;
    await expect(loadHistoricalSimulationInitialRecordIndexV2({ tx, ...request }))
      .rejects.toThrow("INITIAL_RECORD_IDENTITY");
  });
});
