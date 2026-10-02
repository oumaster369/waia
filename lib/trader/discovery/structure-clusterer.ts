import {
  MEASURED_VOLATILITY_UNAVAILABLE,
  STRUCTURE_CLUSTER_SCHEMA_VERSION_V2,
  TRADE_REFERENCE_COUNT_METRIC,
  type StructureClusterV2,
  type StructureClustererInput,
  type StructureSignatureV2,
} from "@/lib/trader/discovery/structure.types";
import {
  buildStructureSignatureKeyV2,
  tradeReferenceCountBandForCount,
} from "@/lib/trader/discovery/structure-cluster-contract";
import { buildStructureClusterV2ContentDigest } from "@/lib/trader/discovery/serialize-discovery";

export function clusterStructureSignatures(
  input: StructureClustererInput,
  newId: () => string = crypto.randomUUID.bind(crypto),
  createdAt = new Date().toISOString(),
): StructureClusterV2[] {
  const groups = new Map<string, { signature: StructureSignatureV2; refs: string[] }>();

  for (const observation of input.observations) {
    for (const regimeLabel of observation.observedRegimes) {
      const tradeReferenceCount = observation.tradeRefs.length;
      const tradeReferenceCountBand = tradeReferenceCountBandForCount(tradeReferenceCount);
      const signatureKey = buildStructureSignatureKeyV2(regimeLabel, tradeReferenceCountBand);
      const existing = groups.get(signatureKey);
      if (existing) {
        existing.refs.push(observation.observationId);
        existing.signature.observationCount += 1;
        existing.signature.tradeCount += tradeReferenceCount;
      } else {
        groups.set(signatureKey, {
          signature: {
            signatureKey,
            regimeLabel,
            metric: TRADE_REFERENCE_COUNT_METRIC,
            tradeReferenceCountBand,
            measuredVolatility: MEASURED_VOLATILITY_UNAVAILABLE,
            tradeCount: tradeReferenceCount,
            observationCount: 1,
          },
          refs: [observation.observationId],
        });
      }
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.signature.tradeCount - a.signature.tradeCount)
    .map(({ signature, refs }) => {
      const clusterId = newId();
      const draft: Omit<StructureClusterV2, "contentDigest"> = {
        schemaVersion: STRUCTURE_CLUSTER_SCHEMA_VERSION_V2,
        clusterId,
        campaignRef: input.campaignRef,
        signature,
        memberObservationRefs: [...new Set(refs)].sort((a, b) => a.localeCompare(b)),
        createdAt,
      };
      return {
        ...draft,
        contentDigest: buildStructureClusterV2ContentDigest(draft),
      };
    });
}
