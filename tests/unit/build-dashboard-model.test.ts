import { describe, expect, it } from "vitest";

import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";
import { DEFAULT_TWIN_DIALOGUE_SIGNALS } from "@/lib/dashboard/readiness-snapshot-default";
import { computeReadinessResult } from "@/lib/readiness";
import type { ReadinessInput } from "@/lib/readiness/types";

function readinessInput(partial: {
  indicators: ReadinessInput["indicators"];
  socializationCompleted?: boolean;
  finalStateMessageShown?: boolean;
}): ReadinessInput {
  return {
    indicators: partial.indicators,
    socializationCompleted: partial.socializationCompleted ?? false,
    finalStateMessageShown: partial.finalStateMessageShown ?? false,
  };
}

describe("buildDashboardViewModel", () => {
  it("uses workspace avatar copy when aggregate is below 100%", () => {
    const readiness = readinessInput({
      indicators: [33, 33, 33, 33, 33, 33],
    });
    const vm = buildDashboardViewModel(readiness, DEFAULT_TWIN_DIALOGUE_SIGNALS, "Alex");

    expect(vm.avatarStatusText).toBe("AI-Twin workspace · Alex");
    expect(vm.socializationCompleted).toBe(false);
    expect(vm.finalStateMessageShown).toBe(false);

    const r = computeReadinessResult(readiness);
    expect(vm.totalCompletionPercent).toBe(r.totalCompletionPercent);
    expect(vm.diaryTabUnlocked).toBe(r.diaryTabUnlocked);
    expect(vm.readyForSocialization).toBe(r.readyForSocialization);
    expect(vm.societyTabUnlocked).toBe(r.societyTabUnlocked);
    expect(vm.showFinalTwinCompletionState).toBe(r.showFinalTwinCompletionState);
  });

  it("uses formation-complete avatar copy when aggregate reaches 100%", () => {
    const readiness = readinessInput({
      indicators: [100, 100, 100, 100, 100, 100],
    });
    const vm = buildDashboardViewModel(readiness, DEFAULT_TWIN_DIALOGUE_SIGNALS, "Alex");

    expect(vm.avatarStatusText).toBe("AI-Twin formation complete · Alex");

    const r = computeReadinessResult(readiness);
    expect(vm.totalCompletionPercent).toBe(100);
    expect(vm.diaryTabUnlocked).toBe(r.diaryTabUnlocked);
    expect(vm.readyForSocialization).toBe(r.readyForSocialization);
    expect(vm.societyTabUnlocked).toBe(r.societyTabUnlocked);
    expect(vm.showFinalTwinCompletionState).toBe(r.showFinalTwinCompletionState);
  });

  it("reflects persisted socialization flags on the VM without changing readiness math", () => {
    const readiness = readinessInput({
      indicators: [100, 100, 100, 100, 100, 100],
      socializationCompleted: true,
      finalStateMessageShown: true,
    });
    const vm = buildDashboardViewModel(readiness, DEFAULT_TWIN_DIALOGUE_SIGNALS, "Riley");

    expect(vm.avatarStatusText).toBe("AI-Twin formation complete · Riley");
    expect(vm.socializationCompleted).toBe(true);
    expect(vm.finalStateMessageShown).toBe(true);

    const r = computeReadinessResult(readiness);
    expect(vm.readyForSocialization).toBe(r.readyForSocialization);
    expect(vm.readyForSocialization).toBe(false);
    expect(vm.societyTabUnlocked).toBe(true);
  });
});
