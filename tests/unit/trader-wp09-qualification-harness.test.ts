import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeHostFingerprintSha256,
  loadQualificationBars,
  readQualificationHarnessSha256,
  verifyReferenceHostFingerprint,
  D11B_APPROVED_HOST_FINGERPRINT_SHA256,
  D11B_APPROVED_DATASET_SHA256,
  D11B_N1_NORMALIZED_SHA256,
  D11B_THRESHOLDS,
} from "@/lib/trader/backtest/replay-qualification-harness";
import {
  collectLiveHostEnvironment,
  hostEnvironmentsMatch,
  loadReferenceHostEnvironment,
  verifyCanonicalHostFingerprint,
} from "@/lib/trader/backtest/d11b-host-fingerprint";
import { sha256File } from "@/lib/trader/backtest/replay-benchmark-harness";

const HTR_D11B_HERMETIC_FIXTURE_ROOT = path.join(process.cwd(), "tests/fixtures/trader/d11b");
const HTR_D11B_HERMETIC_N1_DATASET_PATH = path.join(
  HTR_D11B_HERMETIC_FIXTURE_ROOT,
  "normalized/btcusdt-1m-2023q2clean.N1.json",
);
const HTR_D11B_HERMETIC_N2_DATASET_PATH = path.join(
  HTR_D11B_HERMETIC_FIXTURE_ROOT,
  "normalized/btcusdt-1m-2023q2clean.N2.json",
);
const HTR_D11B_HERMETIC_REFERENCE_HOST_PATH = path.join(
  HTR_D11B_HERMETIC_FIXTURE_ROOT,
  "reference-host-environment.json",
);

function isD11bQualificationHost(): boolean {
  try {
    hostEnvironmentsMatch(loadReferenceHostEnvironment(), collectLiveHostEnvironment());
    return true;
  } catch {
    return false;
  }
}

describe("WP09 qualification harness (HTR-WP09)", () => {
  it.skipIf(!isD11bQualificationHost())(
    "computes canonical host fingerprint from live/reference match",
    () => {
      expect(computeHostFingerprintSha256()).toBe(D11B_APPROVED_HOST_FINGERPRINT_SHA256);
      expect(
        verifyCanonicalHostFingerprint(D11B_APPROVED_HOST_FINGERPRINT_SHA256).canonicalSha256,
      ).toBe(D11B_APPROVED_HOST_FINGERPRINT_SHA256);
    },
  );

  it("verifyReferenceHostFingerprint fails closed on mismatch", () => {
    expect(() =>
      verifyReferenceHostFingerprint("0".repeat(64), HTR_D11B_HERMETIC_REFERENCE_HOST_PATH),
    ).toThrow(/\[d11b-host\] (live host mismatch|canonical fingerprint mismatch)/);
  });

  it("pins approved host fingerprint constant for Stage-C preflight", () => {
    expect(D11B_APPROVED_HOST_FINGERPRINT_SHA256).toBe(
      "1cd9f9535e86b3f5ad13cd907f08059d5ca3650cfbf74d9120449c7355b7a774",
    );
  });

  it("rejects dataset digest mismatch", () => {
    const badPath = path.join(process.cwd(), "package.json");
    expect(() => loadQualificationBars("N1", badPath)).toThrow(/sha256 mismatch/);
  });

  it("accepts approved N1 normalized digest", () => {
    expect(sha256File(HTR_D11B_HERMETIC_N1_DATASET_PATH)).toBe(D11B_N1_NORMALIZED_SHA256);
  });

  it("accepts approved N2 dataset digest", () => {
    expect(sha256File(HTR_D11B_HERMETIC_N2_DATASET_PATH)).toBe(D11B_APPROVED_DATASET_SHA256);
  });

  it("exposes stable harness sha for evidence binding", () => {
    const harnessPath = path.join(
      process.cwd(),
      "lib/trader/backtest/replay-qualification-harness.ts",
    );
    const expected = createHash("sha256").update(readFileSync(harnessPath)).digest("hex");
    expect(readQualificationHarnessSha256()).toBe(expected);
  });

  it("preserves approved D-11B thresholds", () => {
    expect(D11B_THRESHOLDS.qualificationBarCountN2).toBe(129_600);
    expect(D11B_THRESHOLDS.integratedReplayCycleCountN2).toBe(129_581);
    expect(D11B_THRESHOLDS.maxTotalWallMs).toBe(1_800_000);
    expect(D11B_THRESHOLDS.measuredWarmRunsPerN).toBe(5);
  });
});
