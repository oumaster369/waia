import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildKmConvergenceReceiptV1,
  computeKmAnchorKey,
  evaluateKmConfigurationV1,
  KM_ANCHORS_PER_SURFACE,
  KM_EXACT_SAMPLE_GENERATION_COUNT,
  selectKmAnchorsV1,
  selectKmWinnerV1,
} from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";

describe("DEE-532 km-convergence gate", () => {
  const devDigest = createHash("sha256").update("development-fixture", "utf8").digest();

  it("kmgate/v1 anchor key is deterministic", () => {
    const key = computeKmAnchorKey({
      developmentDatasetDigestRaw32: devDigest,
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      anchorEpochMin: 1000,
    });
    expect(key).toHaveLength(32);
    expect(
      computeKmAnchorKey({
        developmentDatasetDigestRaw32: devDigest,
        symbol: "BTCUSDT",
        primaryHorizonMinutes: 30,
        anchorEpochMin: 1000,
      }).equals(key),
    ).toBe(true);
  });

  it("selects exactly 4096 anchors per surface", () => {
    const eligible = Array.from({ length: 5000 }, (_, i) => ({
      symbol: "BTCUSDT" as const,
      primaryHorizonMinutes: 30 as const,
      anchorEpochMin: 10_000 + i,
    }));
    const selected = selectKmAnchorsV1({
      developmentDatasetDigestRaw32: devDigest,
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      eligibleAnchors: eligible,
    });
    expect(selected).toHaveLength(KM_ANCHORS_PER_SURFACE);
  });

  it("km-winner-select/v1 picks minimal K·M", () => {
    const winner = selectKmWinnerV1([
      {
        kConfig: 50,
        mConfig: 80,
        evLowerRelativeErrorP95: 0,
        evBaseRelativeErrorP95: 0,
        evUpperRelativeErrorP95: 0,
        mcEsRelativeErrorP95: 0,
        qualifies: true,
      },
      {
        kConfig: 10,
        mConfig: 20,
        evLowerRelativeErrorP95: 0.005,
        evBaseRelativeErrorP95: 0.005,
        evUpperRelativeErrorP95: 0.005,
        mcEsRelativeErrorP95: 0.01,
        qualifies: true,
      },
    ]);
    expect(winner?.kConfig).toBe(10);
    expect(winner?.mConfig).toBe(20);
  });

  it("emits km-convergence-receipt/v1 with evidence digest", () => {
    const configs = [
      evaluateKmConfigurationV1({
        kConfig: 10,
        mConfig: 20,
        perAnchorEvLowerErrors: [0.005],
        perAnchorEvBaseErrors: [0.005],
        perAnchorEvUpperErrors: [0.005],
        perAnchorMcEsErrors: [0.01],
      }),
    ];
    const receipt = buildKmConvergenceReceiptV1({
      replicaRootFamilyIdentityDigestHex: "a".repeat(64),
      kmGlobalAnchorSetDigestHex: "b".repeat(64),
      candidateGenerationDigestsHex: ["c".repeat(64)],
      configurations: configs,
    });
    expect(receipt.schemaVersion).toBe("km-convergence-receipt/v1");
    expect(receipt.evidenceSemanticDigestHex).toHaveLength(64);
    expect(receipt.terminalStatus).toBe("QUALIFIED");
  });

  it("exact nested sample generation count is 65_536_000", () => {
    expect(KM_EXACT_SAMPLE_GENERATION_COUNT).toBe(65_536_000);
  });
});
