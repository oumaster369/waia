import { describe, expect, it } from "vitest";

import {
  assertControlReplayTwoRunParityV1,
  runControlReplayRuntimeFixtureV1,
} from "@/lib/trader/observability/control-replay-runtime-fixture-v1";
import { validateFhvFullHistoricalLaunchInput } from "@/lib/trader/observability/fhv-full-historical-launch";
import { CONTROL_REPLAY_AUTHORITY_CLASS } from "@/lib/trader/observability/control-replay-test-authority";

describe("DEE-529 control replay runtime integration fixture", () => {
  it("runs deterministic economics + parity fixture twice equally", () => {
    assertControlReplayTwoRunParityV1();
    const result = runControlReplayRuntimeFixtureV1();
    expect(result.authority.executionPurpose).toBe("CONTROL_REPLAY");
    expect(result.authority.capitalEligible).toBe(false);
    expect(result.riskOutcome).toBe("APPROVE");
    expect(result.accountingSemanticDigest).toHaveLength(64);
  });

  it("launch validation rejects TEST_ONLY on FULL_HISTORICAL purpose", () => {
    expect(() =>
      validateFhvFullHistoricalLaunchInput({
        releaseSha: "a".repeat(40),
        runId: "run-test",
        organizationId: "00000000-0000-4000-8000-000000000001",
        operatorId: "operator",
        artifactRoot: "/tmp/x",
        configurationFreezePath: "/tmp/x/freeze.json",
        authorizationReceiptPath: "/tmp/x/auth.json",
        authorizationReceiptDigest: "b".repeat(64),
        datasetQualificationReceiptPath: "/tmp/x/dataset.json",
        executionPurpose: "FULL_HISTORICAL",
        authorityClass: CONTROL_REPLAY_AUTHORITY_CLASS,
        executionMode: "mock",
        capitalEligible: false,
        boundedFixture: true,
      }),
    ).toThrow(/TEST_ONLY authority forbidden on surface=FULL_HISTORICAL/);
  });
});
