import { describe, expect, it } from "vitest";

import type { RunBacktestInput } from "@/lib/trader/backtest/backtest-runner";

describe("trader wp21 default runtime v1 v2", () => {
  it("keeps wp21 fields optional on RunBacktestInput (default-off)", () => {
    const requiredKeys: (keyof RunBacktestInput)[] = [
      "context",
      "barSource",
      "deps",
      "orderRepository",
      "accountKey",
      "defaultQuantity",
      "costModel",
      "strategySignalIds",
      "strategyId",
      "strategyVersion",
      "regimeLabel",
      "datasetId",
      "runId",
      "split",
      "window",
      "accountState",
      "exportedAt",
    ];
    const optionalWp21Keys = [
      "outcomeResolutionSink",
      "calibrationSink",
      "confidenceUpdateSink",
      "wp21RuntimeDeps",
      "outcomeResolutionReadPort",
      "wp21CheckpointState",
      "wp21Provenance",
      "wp21PostgresExecutor",
    ] as const;

    for (const key of optionalWp21Keys) {
      expect(requiredKeys.includes(key as keyof RunBacktestInput)).toBe(false);
    }
  });
});
