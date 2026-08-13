import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  buildPredictivePackageV1,
  canonicalizeSourceCorpusV1,
  issueForecastV1,
  verifyForecastDistributionReplayV1,
  verifyReplicaPoolReplayV1,
  type SourceAnchor,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type { ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { runExecutorReadyEndToEndV1 } from "@/lib/trader/research/challengers/rv-state-conditional-challenger-v1";

function anchor(i: number, rv: number, rH: number): SourceAnchor {
  return {
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
    barContentDigest: createHash("sha256").update(String(i)).digest("hex"),
    realizedVol20m_1m: rv,
    outcome13d: [0, 0, 0, rH, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function buildFamily(): ReplicaRootFamilyInput {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    primaryHorizonMinutes: 30,
    executionHorizonMinutes: 33,
    packageSubjectVersion: "pkg-subject/v1",
    terminalTargetDefinitionDigestHex: "a".repeat(64),
    executionOpportunityTargetDefinitionDigestHex: "b".repeat(64),
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    developmentDatasetDigestHex: createHash("sha256").update("dev-dataset", "utf8").digest("hex"),
    featureVersion: "feature-engine/rv/v2",
    normalizationVersionDigestHex: "c".repeat(64),
    codeReleaseSha: "d".repeat(40),
  };
}

describe("DEE-527 rv-state-conditional-empirical-joint/v1 end-to-end", () => {
  const corpus = Array.from({ length: 120 }, (_, i) =>
    anchor(i, 0.01 + (i % 12) * 0.0015, -0.002 + (i % 7) * 0.0004),
  );
  const family = buildFamily();

  it("builds real package with bootstrap-derived replica artifacts", () => {
    const pkg = buildPredictivePackageV1({
      family,
      sourceCorpus: corpus,
      kConfigDec: 3,
      mConfigDec: 4,
    });
    expect(pkg.replicaArtifacts).toHaveLength(3);
    for (const artifact of pkg.replicaArtifacts) {
      expect(artifact.blockLength).toBeGreaterThan(0);
      expect(artifact.q1).toBeLessThan(artifact.q2);
      expect(artifact.replicaArtifactDigest).toHaveLength(32);
      verifyReplicaPoolReplayV1({
        family,
        canonicalSourceCorpus: pkg.canonicalSourceCorpus,
        artifact,
      });
    }
  });

  it("canonical SOURCE permutation invariance", () => {
    const shuffled = [...corpus].reverse();
    const a = buildPredictivePackageV1({ family, sourceCorpus: corpus, kConfigDec: 2 });
    const b = buildPredictivePackageV1({ family, sourceCorpus: shuffled, kConfigDec: 2 });
    expect(a.predictivePackageContentDigest.equals(b.predictivePackageContentDigest)).toBe(true);
    expect(canonicalizeSourceCorpusV1(corpus).map((x) => x.closedBarEpochMs)).toEqual(
      canonicalizeSourceCorpusV1(shuffled).map((x) => x.closedBarEpochMs),
    );
  });

  it("issues forecast and replays distribution semantic digest", () => {
    const { issuance } = runExecutorReadyEndToEndV1({
      family,
      sourceCorpus: corpus,
      kConfigDec: 3,
      mConfigDec: 5,
      anchorClosedBarEpochMs: corpus[corpus.length - 1]!.closedBarEpochMs,
      anchorRealizedVol20m_1m: corpus[corpus.length - 1]!.realizedVol20m_1m,
      executionHorizonMinutes: 33,
      normalizationVersionDigestHex: "c".repeat(64),
    });
    verifyForecastDistributionReplayV1({
      issuance,
      expectedDistributionSemanticDigestExec: issuance.distributionSemanticDigestExec,
    });
    expect(issuance.samples).toHaveLength(3);
    expect(issuance.samples[0]).toHaveLength(5);
  });

  it("fail-closed on insufficient state pool at issuance", () => {
    const tiny = corpus.slice(0, 10);
    const pkg = buildPredictivePackageV1({
      family,
      sourceCorpus: tiny,
      kConfigDec: 1,
      mConfigDec: 2,
    });
    expect(() =>
      issueForecastV1({
        pkg,
        anchorClosedBarEpochMs: 1,
        anchorRealizedVol20m_1m: 999,
        executionHorizonMinutes: 33,
        normalizationVersionDigestHex: "c".repeat(64),
      }),
    ).toThrow(/FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT/);
  });
});
