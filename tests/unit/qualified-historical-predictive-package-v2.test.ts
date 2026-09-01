import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildHistoricalForecastFamilyV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { buildQualifiedHistoricalPredictivePackageV2 } from
  "@/lib/trader/historical-simulation-v2/qualified-predictive-package-v2";
import { buildPredictivePackageV1 } from
  "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { computeReplicaRootFamilyIdentityDigest, digestHex } from
  "@/lib/trader/intelligence/forecast-v2/identity-digests";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { buildKmConvergenceReceiptV1 } from
  "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";

const family = buildHistoricalForecastFamilyV2({
  organizationId: "00000000-0000-4000-8000-000000000001", symbol: "BTCUSDT",
  primaryHorizonMinutes: 30, developmentDatasetDigestHex: "a".repeat(64),
  releaseSha: "b".repeat(40),
});
const corpus: SourceAnchor[] = Array.from({ length: 180 }, (_, index) => ({
  venue: "htx", market: "spot", symbol: "BTCUSDT",
  closedBarEpochMs: 1_700_000_000_000 + index * 60_000,
  barContentDigest: createHash("sha256").update(String(index)).digest("hex"),
  realizedVol20m_1m: 0.005 + (index % 30) * 0.001,
  outcome13d: [0.001, 0.002, 0.003, (index % 11 - 5) / 1000, 0.004, 0.005, 0.006,
    100, 101, 102, 103, 104, 105],
}));

function receiptFor(pkg = buildPredictivePackageV1({ family, sourceCorpus: corpus,
  kConfigDec: 10, mConfigDec: 20 })) {
  return buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: digestHex(computeReplicaRootFamilyIdentityDigest(family)),
    kmGlobalAnchorSetDigestHex: "c".repeat(64),
    candidateGenerationDigestsHex: [digestHex(pkg.predictivePackageGenerationIdentityDigest)],
    configurations: [{ kConfig: 10, mConfig: 20, evLowerRelativeErrorP95: 0,
      evBaseRelativeErrorP95: 0, evUpperRelativeErrorP95: 0,
      mcEsRelativeErrorP95: 0, qualifies: true }],
    selectedPackageGenerationIdentityDigestHex: digestHex(pkg.predictivePackageGenerationIdentityDigest),
    selectedPackageContentDigestHex: digestHex(pkg.predictivePackageContentDigest),
  });
}

describe("qualified historical predictive package v2", () => {
  it("reconstructs the exact convergence-selected K/M package", () => {
    const expected = buildPredictivePackageV1({ family, sourceCorpus: corpus,
      kConfigDec: 10, mConfigDec: 20 });
    const actual = buildQualifiedHistoricalPredictivePackageV2({ family,
      developmentCorpus: corpus, kmConvergenceReceipt: receiptFor(expected) });
    expect(digestHex(actual.predictivePackageContentDigest))
      .toBe(digestHex(expected.predictivePackageContentDigest));
  });

  it("rejects a receipt whose selected package cannot be replayed", () => {
    const receipt = receiptFor();
    expect(() => buildQualifiedHistoricalPredictivePackageV2({ family,
      developmentCorpus: corpus.slice(1), kmConvergenceReceipt: receipt }))
      .toThrow("HISTORICAL_PREDICTIVE_PACKAGE_REFUSED:WINNER_REPLAY_MISMATCH");
  });
});
