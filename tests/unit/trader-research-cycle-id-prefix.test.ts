import { describe, expect, it } from "vitest";

import {
  buildResearchBlindCycleIdPrefix,
  buildResearchValidationCycleIdPrefix,
  buildResearchWalkForwardCycleIdPrefix,
} from "@/lib/trader/research/research-backtest-cycle-id";
import { cycleOrderKeys } from "@/lib/trader/paper/paper-cycle-runner";

const RUN_ID = "00000000-0000-4000-8000-00000000a001";
const STRATEGY_ID = "mean_reversion_v0";

describe("research backtest cycle ID prefixes (DEE-368)", () => {
  it("produces distinct clientOrderId keys for the same cycle index across phases", () => {
    const cycleIndex = 5;
    const validationPrefix = buildResearchValidationCycleIdPrefix(RUN_ID);
    const walkForwardPrefix = buildResearchWalkForwardCycleIdPrefix(RUN_ID, 12);
    const blindPrefix = buildResearchBlindCycleIdPrefix(RUN_ID);

    const validationKeys = cycleOrderKeys(`${validationPrefix}-${cycleIndex}`, STRATEGY_ID);
    const walkForwardKeys = cycleOrderKeys(`${walkForwardPrefix}-${cycleIndex}`, STRATEGY_ID);
    const blindKeys = cycleOrderKeys(`${blindPrefix}-${cycleIndex}`, STRATEGY_ID);

    expect(validationKeys.clientOrderId).not.toBe(walkForwardKeys.clientOrderId);
    expect(walkForwardKeys.clientOrderId).not.toBe(blindKeys.clientOrderId);
    expect(validationKeys.clientOrderId).not.toBe(blindKeys.clientOrderId);
  });

  it("produces distinct walk-forward prefixes per window index", () => {
    expect(buildResearchWalkForwardCycleIdPrefix(RUN_ID, 0)).not.toBe(
      buildResearchWalkForwardCycleIdPrefix(RUN_ID, 1),
    );
  });
});
