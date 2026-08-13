import { describe, expect, it } from "vitest";

import {
  assertControlReplayTestOnlyAuthorityV1,
  CONTROL_REPLAY_AUTHORITY_IDENTITY,
  TestOnlyAuthorityRejectedError,
} from "@/lib/trader/observability/control-replay-test-authority";
import {
  assertControlReplayParityEqual,
  computeControlReplayParityDigest,
} from "@/lib/trader/observability/fhv-control-replay-parity-digest";

describe("DEE-529 control replay TEST_ONLY authority", () => {
  it("fail-closed on production surface", () => {
    expect(() =>
      assertControlReplayTestOnlyAuthorityV1({
        surface: "production",
        authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
      }),
    ).toThrow(TestOnlyAuthorityRejectedError);
  });

  it("fail-closed on FULL_HISTORICAL surface", () => {
    expect(() =>
      assertControlReplayTestOnlyAuthorityV1({
        surface: "FULL_HISTORICAL",
        authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
      }),
    ).toThrow(TestOnlyAuthorityRejectedError);
  });

  it("allows CONTROL_REPLAY surface with TEST_ONLY identity", () => {
    expect(() =>
      assertControlReplayTestOnlyAuthorityV1({
        surface: "CONTROL_REPLAY",
        authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
      }),
    ).not.toThrow();
  });

  it("two-run parity digest equality", () => {
    const surface = {
      executionPurpose: "CONTROL_REPLAY",
      executionMode: "mock",
      authorityClass: "TEST_ONLY",
      capitalEligible: false,
      decisionActionable: true,
      evLowerScale8: "100.00000000",
      evBaseScale8: "200.00000000",
      evUpperScale8: "300.00000000",
      orderCount: 2,
      fillCount: 2,
      checkpointDigest: "checkpoint-a",
      semanticParityDigest: "semantic-a",
    };
    const runOne = computeControlReplayParityDigest(surface);
    const runTwo = computeControlReplayParityDigest(surface);
    expect(() => assertControlReplayParityEqual(runOne, runTwo)).not.toThrow();
  });
});
