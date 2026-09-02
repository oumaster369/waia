import { buildPredictivePackageV1, type PredictivePackageV1 } from
  "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type { ReplicaRootFamilyInput } from
  "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { computeReplicaRootFamilyIdentityDigest, digestHex } from
  "@/lib/trader/intelligence/forecast-v2/identity-digests";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import type { KmConvergenceReceipt } from
  "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";

/** Reconstruct the exact K/M winner selected by the canonical convergence ceremony. */
export function buildQualifiedHistoricalPredictivePackageV2(input: Readonly<{
  family: ReplicaRootFamilyInput;
  developmentCorpus: readonly SourceAnchor[];
  kmConvergenceReceipt: KmConvergenceReceipt;
}>): PredictivePackageV1 {
  const receipt = input.kmConvergenceReceipt;
  const root = digestHex(computeReplicaRootFamilyIdentityDigest(input.family));
  if (receipt.terminalStatus !== "QUALIFIED" || !receipt.selectedK || !receipt.selectedM ||
      !receipt.selectedPackageGenerationIdentityDigestHex ||
      !receipt.selectedPackageContentDigestHex ||
      receipt.replicaRootFamilyIdentityDigestHex !== root) {
    throw new Error("HISTORICAL_PREDICTIVE_PACKAGE_REFUSED:KM_NOT_QUALIFIED_OR_BOUND");
  }
  const pkg = buildPredictivePackageV1({
    family: input.family,
    sourceCorpus: input.developmentCorpus,
    kConfigDec: receipt.selectedK,
    mConfigDec: receipt.selectedM,
    alphaEpiConfigScale8: receipt.alphaEpiConfigScale8,
  });
  if (digestHex(pkg.predictivePackageGenerationIdentityDigest) !==
        receipt.selectedPackageGenerationIdentityDigestHex ||
      digestHex(pkg.predictivePackageContentDigest) !==
        receipt.selectedPackageContentDigestHex) {
    throw new Error("HISTORICAL_PREDICTIVE_PACKAGE_REFUSED:WINNER_REPLAY_MISMATCH");
  }
  return pkg;
}
