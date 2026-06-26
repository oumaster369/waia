import { describe, expect, it } from "vitest";

import {
  computeConfirmationDepth,
  computeScanRange,
  isReorgAgeoutEligible,
  shouldConfirm,
  shouldDetect,
} from "@/lib/waia-core/payment-watcher/confirmation";

describe("payment watcher confirmation math", () => {
  it("computes cursor-anchored catch-up range", () => {
    const range = computeScanRange({
      cursorBlock: "100",
      tipBlock: "500",
      startBlock: "0",
      rescanWindow: 40,
      maxBlocksPerCycle: 200,
    });
    expect(range.fromBlock).toBe("61");
    expect(range.toBlock).toBe("260");
    expect(range.catchingUp).toBe(true);
  });

  it("does not skip blocks after extended downtime", () => {
    const range = computeScanRange({
      cursorBlock: "100",
      tipBlock: "500",
      startBlock: "0",
      rescanWindow: 40,
      maxBlocksPerCycle: 200,
    });
    expect(Number.parseInt(range.fromBlock, 10)).toBeLessThanOrEqual(100);
  });

  it("gates detect and confirm by depth", () => {
    expect(shouldDetect(1)).toBe(true);
    expect(shouldConfirm(19, 20)).toBe(false);
    expect(shouldConfirm(20, 20)).toBe(true);
    expect(computeConfirmationDepth("120", "101")).toBe(20);
  });

  it("age-out uses created_at threshold", () => {
    const now = new Date("2026-06-26T12:00:00.000Z");
    const old = new Date("2026-06-26T11:00:00.000Z");
    expect(isReorgAgeoutEligible(old, now, 30)).toBe(true);
    expect(isReorgAgeoutEligible(new Date("2026-06-26T11:45:00.000Z"), now, 30)).toBe(false);
  });
});
