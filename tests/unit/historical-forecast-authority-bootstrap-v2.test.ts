import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildHistoricalForecastAuthorityBootstrapV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-authority-bootstrap-v2";
import { buildHistoricalForecastFamilyV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { digestHex, computeReplicaRootFamilyIdentityDigest } from
  "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { buildPredictivePackageV1 } from
  "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { bucketIndexForReturn, computeTerminalTargetGridFromDevelopmentReturns } from
  "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { buildKmConvergenceReceiptV1 } from
  "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import {
  buildEpistemicParameterRatificationReceiptV1,
  buildPredictiveTerminalReceiptV1,
  buildScientificAdmissionReceiptV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";

const organizationId = "00000000-0000-4000-8000-000000000001";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const family = buildHistoricalForecastFamilyV2({ organizationId, symbol: "BTCUSDT",
  primaryHorizonMinutes: 30, developmentDatasetDigestHex: digest("development"),
  releaseSha: "b".repeat(40) });
const corpus: SourceAnchor[] = Array.from({ length: 180 }, (_, index) => ({
  venue: "htx", market: "spot", symbol: "BTCUSDT",
  closedBarEpochMs: 1_700_000_000_000 + index * 60_000,
  barContentDigest: digest(`bar:${index}`), realizedVol20m_1m: 0.005 + index % 30 * 0.001,
  outcome13d: [0.001, 0.002, 0.003, (index % 11 - 5) / 1000, 0.004, 0.005, 0.006,
    100, 101, 102, 103, 104, 105],
}));

function qualifiedGraph() {
  const pkg = buildPredictivePackageV1({ family, sourceCorpus: corpus, kConfigDec: 10, mConfigDec: 20 });
  const packageDigest = digestHex(pkg.predictivePackageContentDigest);
  const generationDigest = digestHex(pkg.predictivePackageGenerationIdentityDigest);
  const runtimeDigest = digestHex(pkg.runtimeContractDigest);
  const km = buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: digestHex(computeReplicaRootFamilyIdentityDigest(family)),
    kmGlobalAnchorSetDigestHex: digest("anchors"), candidateGenerationDigestsHex: [generationDigest],
    configurations: [{ kConfig: 10, mConfig: 20, evLowerRelativeErrorP95: 0,
      evBaseRelativeErrorP95: 0, evUpperRelativeErrorP95: 0, mcEsRelativeErrorP95: 0, qualifies: true }],
    selectedPackageGenerationIdentityDigestHex: generationDigest,
    selectedPackageContentDigestHex: packageDigest,
  });
  const developmentReturns = Array.from({ length: 400 }, (_, i) => Math.sin(i / 17) * 0.02 + i % 9 * 0.0005);
  const historyReturns = Array.from({ length: 2500 }, (_, i) => developmentReturns[i % developmentReturns.length]!);
  const grid = computeTerminalTargetGridFromDevelopmentReturns(developmentReturns);
  const identities = { developmentDatasetDigestHex: family.developmentDatasetDigestHex,
    targetGridReceiptDigestHex: digest("grid"), predictivePackageGenerationIdentityDigestHex: generationDigest,
    predictivePackageContentDigestHex: packageDigest, runtimeContractDigestHex: runtimeDigest,
    scoringContractVersion: "multiclass-log-score/v1" as const,
    evaluationPartitionReceiptDigestHex: digest("wf") };
  const predictive = buildPredictiveTerminalReceiptV1({ identities, harnessInput: {
    venue: "htx", market: "spot", symbol: "BTCUSDT", primaryHorizonMinutes: 30,
    challengerPackageContentDigestHex: packageDigest, comparisonFamilyId: "historical-v2",
    evaluationPartitionReceiptDigestHex: identities.evaluationPartitionReceiptDigestHex,
    purgeDurationMinutes: 30, embargoDurationMinutes: 30, developmentReturns, historyReturns,
    historyReturnMinuteOpenTimesMs: historyReturns.map((_, i) => 1_700_000_000_000 + i * 60_000),
    anchors: developmentReturns.slice(0, 24).map((observedReturn, i) => {
      const bucket = bucketIndexForReturn(observedReturn, grid);
      return { anchorId: `a-${i}`, observedReturn,
        challengerProbabilities: Array.from({ length: 7 }, (_, j) => j === bucket ? 0.999 : 0.001 / 6) };
    }),
  }});
  const ratification = buildEpistemicParameterRatificationReceiptV1({
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex, selectedK: km.selectedK!,
    selectedM: km.selectedM!, alphaEpiConfigScale8: km.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigestHex: generationDigest,
    selectedPackageContentDigestHex: packageDigest, humanReceiptIdentityDigestHex: digest("human"),
  });
  const scientific = buildScientificAdmissionReceiptV2({ organizationId,
    predictiveTerminalReceipt: predictive, kmConvergenceReceipt: km,
    epistemicParameterRatificationReceipt: ratification });
  return { pkg, scientific, expected: { organizationId, ...identities,
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex,
    epistemicParameterRatificationReceiptDigestHex: ratification.contentDigestHex,
    predictiveTerminalReceiptContentDigestHex: predictive.contentDigestHex } };
}

describe("historical Forecast authority bootstrap v2", () => {
  it("derives the immutable contract graph from the qualified executable package", () => {
    const graph = qualifiedGraph();
    const result = buildHistoricalForecastAuthorityBootstrapV2({ organizationId,
      scientificAdmissionReceiptId: "22222222-2222-4222-8222-222222222222",
      scientificAdmissionReceipt: graph.scientific,
      scientificAdmissionExpectedBindings: graph.expected, predictivePackage: graph.pkg });
    expect(result.forecastContractBinding.selectedPredictivePackageContentDigestHex)
      .toBe(digestHex(graph.pkg.predictivePackageContentDigest));
    expect(result.forecastContractBinding.modelArtifact.artifactPayloadDigestHex)
      .toBe(result.artifactPayloadDigestHex);
  });

  it("refuses a package outside the scientific graph", () => {
    const graph = qualifiedGraph();
    const other = buildPredictivePackageV1({ family, sourceCorpus: corpus.slice(1), kConfigDec: 10, mConfigDec: 20 });
    expect(() => buildHistoricalForecastAuthorityBootstrapV2({ organizationId,
      scientificAdmissionReceiptId: "22222222-2222-4222-8222-222222222222",
      scientificAdmissionReceipt: graph.scientific,
      scientificAdmissionExpectedBindings: graph.expected, predictivePackage: other }))
      .toThrow("HISTORICAL_FORECAST_AUTHORITY_BOOTSTRAP_REFUSED:SCIENTIFIC_GRAPH");
  });
});
