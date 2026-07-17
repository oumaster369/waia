import { describe, expect, it } from "vitest";

import {
  collectLiveHostEnvironment,
  hostEnvironmentsMatch,
  loadReferenceHostEnvironment,
} from "@/lib/trader/backtest/d11b-host-fingerprint";
import {
  HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE,
  HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA,
} from "@/lib/trader/backtest/htr-completed-runtime-qualification.types";
import {
  D11B_APPROVED_DATASET_SHA256,
  D11B_THRESHOLDS,
} from "@/lib/trader/backtest/replay-qualification-harness";

function isD11bQualificationHost(): boolean {
  try {
    hostEnvironmentsMatch(loadReferenceHostEnvironment(), collectLiveHostEnvironment());
    return true;
  } catch {
    return false;
  }
}

describe("HTR-WP22 completed-runtime D-11B qualification", () => {
  it("pins unchanged D-11B thresholds binding", () => {
    expect(D11B_THRESHOLDS.qualificationBarCountN2).toBe(129_600);
    expect(D11B_THRESHOLDS.integratedReplayCycleCountN2).toBe(129_581);
    expect(D11B_THRESHOLDS.maxTotalWallMs).toBe(1_800_000);
    expect(D11B_THRESHOLDS.measuredWarmRunsPerN).toBe(5);
  });

  it("pins approved D-11B N2 dataset digest", () => {
    expect(D11B_APPROVED_DATASET_SHA256).toBe(
      "e3415ffb324961ce19ce014a08d6cc3bc12bcaaba6ae380824dc7049f33a570f",
    );
  });

  it("declares completed-runtime phase and schema constants", () => {
    expect(HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE).toBe("completed-runtime-d11b");
    expect(HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA).toBe(
      "htr-wp22-completed-runtime-qualification/v1",
    );
  });

  it.skipIf(!isD11bQualificationHost())(
    "invalidates when source git sha mismatches current HEAD",
    async () => {
      const { runHtrWp22CompletedRuntimeD11bQualification } =
        await import("@/lib/trader/backtest/htr-completed-runtime-qualification-harness");
      const result = await runHtrWp22CompletedRuntimeD11bQualification({
        sourceGitSha: "0".repeat(40),
      });
      expect(result.terminalState).toBe("HTR_WP22_COMPLETED_RUNTIME_D11B_ATTEMPT_INVALIDATED");
      expect(result.invalidationReason).toContain("sourceGitShaMismatch");
      expect(result.d11bThresholdsBinding).toBe("D11B_THRESHOLDS_UNCHANGED");
    },
  );
});
