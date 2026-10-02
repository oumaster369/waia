import {
  OBSERVATION_SCHEMA_VERSION,
} from "@/lib/trader/discovery/observation.types";
import {
  STRUCTURE_CLUSTER_V2_SCHEMA_VERSION,
  type MemberTradeReferenceCount,
  type StructureClustererInput,
  type StructureClusterV2,
  type StructureSignatureV2,
} from "@/lib/trader/discovery/structure.types";
import { buildStructureClusterV2ContentDigest } from "@/lib/trader/discovery/serialize-discovery";
import {
  assertValidResearchCampaignRefV2,
  assertValidStructureClusterV2,
  structureSignatureKeyV2,
  tradeReferenceCountBandForCount,
} from "@/lib/trader/discovery/structure-cluster-v2";

function assertObservationScope(
  input: StructureClustererInput,
): void {
  assertValidResearchCampaignRefV2(input.campaignRef);
  const observationIds = new Set<string>();
  for (const [index, observation] of input.observations.entries()) {
    if (!observation || observation.schemaVersion !== OBSERVATION_SCHEMA_VERSION ||
        typeof observation.observationId !== "string" || observation.observationId.length === 0 ||
        !Array.isArray(observation.tradeRefs) || !Array.isArray(observation.observedRegimes)) {
      throw new Error(`STRUCTURE_CLUSTER_V2_INVALID:OBSERVATION_SCOPE:${index}`);
    }
    assertValidResearchCampaignRefV2(observation.campaignRef);
    if (observation.campaignRef.campaignId !== input.campaignRef.campaignId ||
        observation.campaignRef.campaignDigest !== input.campaignRef.campaignDigest ||
        observation.campaignRef.state !== input.campaignRef.state) {
      throw new Error(`STRUCTURE_CLUSTER_V2_INVALID:OBSERVATION_SCOPE:${index}`);
    }
    if (observationIds.has(observation.observationId)) {
      throw new Error(`STRUCTURE_CLUSTER_V2_INVALID:DUPLICATE_OBSERVATION:${index}`);
    }
    observationIds.add(observation.observationId);
    const regimeLabels = new Set<string>();
    for (const regimeLabel of observation.observedRegimes) {
      if (typeof regimeLabel !== "string" || regimeLabel.length === 0 || regimeLabels.has(regimeLabel)) {
        throw new Error(`STRUCTURE_CLUSTER_V2_INVALID:REGIME_LABEL:${index}`);
      }
      regimeLabels.add(regimeLabel);
    }
  }
}

export function clusterStructureSignatures(
  input: StructureClustererInput,
  newId: () => string = crypto.randomUUID.bind(crypto),
  createdAt = new Date().toISOString(),
): StructureClusterV2[] {
  assertObservationScope(input);
  const groups = new Map<string, { signature: StructureSignatureV2; members: MemberTradeReferenceCount[] }>();
  const emittedClusterIds = new Set<string>();

  for (const observation of input.observations) {
    for (const regimeLabel of observation.observedRegimes) {
      const tradeReferenceCount = observation.tradeRefs.length;
      const tradeReferenceCountBand = tradeReferenceCountBandForCount(tradeReferenceCount);
      const signatureKey = structureSignatureKeyV2(regimeLabel, tradeReferenceCountBand);
      const existing = groups.get(signatureKey);
      if (existing) {
        existing.members.push({ observationRef: observation.observationId, tradeReferenceCount });
        existing.signature.observationCount += 1;
        existing.signature.tradeCount += tradeReferenceCount;
      } else {
        groups.set(signatureKey, {
          signature: {
            signatureKey,
            regimeLabel,
            metricKind: "TRADE_REFERENCE_COUNT_BAND",
            tradeReferenceCountBand,
            measuredVolatilityStatus: "UNAVAILABLE",
            tradeCount: tradeReferenceCount,
            observationCount: 1,
          },
          members: [{ observationRef: observation.observationId, tradeReferenceCount }],
        });
      }
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.signature.tradeCount - a.signature.tradeCount)
    .map(({ signature, members }) => {
      const clusterId = newId();
      if (typeof clusterId !== "string" || clusterId.length === 0 || emittedClusterIds.has(clusterId)) {
        throw new Error("STRUCTURE_CLUSTER_V2_INVALID:CLUSTER_ID");
      }
      emittedClusterIds.add(clusterId);
      const memberTradeReferenceCounts = members.sort((a, b) =>
        a.observationRef < b.observationRef ? -1 : a.observationRef > b.observationRef ? 1 : 0,
      );
      const draft: Omit<StructureClusterV2, "contentDigest"> = {
        schemaVersion: STRUCTURE_CLUSTER_V2_SCHEMA_VERSION,
        clusterId,
        campaignRef: { ...input.campaignRef },
        signature,
        memberObservationRefs: memberTradeReferenceCounts.map((member) => member.observationRef),
        memberTradeReferenceCounts,
        createdAt,
      };
      const cluster: StructureClusterV2 = {
        ...draft,
        contentDigest: buildStructureClusterV2ContentDigest(draft),
      };
      assertValidStructureClusterV2(cluster);
      return cluster;
    });
}
