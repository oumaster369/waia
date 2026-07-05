import {
  STRUCTURE_CLUSTER_SCHEMA_VERSION,
  type StructureCluster,
  type StructureClustererInput,
  type StructureSignature,
} from "@/lib/trader/discovery/structure.types";
import { buildStructureClusterContentDigest } from "@/lib/trader/discovery/serialize-discovery";

function volBucketFromObservation(
  observation: StructureClustererInput["observations"][number],
): "low" | "medium" | "high" {
  const count = observation.tradeRefs.length;
  if (count <= 1) {
    return "low";
  }
  if (count <= 5) {
    return "medium";
  }
  return "high";
}

function buildSignatureKey(
  regimeLabel: string,
  volBucket: StructureSignature["volBucket"],
): string {
  return `${regimeLabel}::${volBucket}`;
}

export function clusterStructureSignatures(
  input: StructureClustererInput,
  newId: () => string = crypto.randomUUID.bind(crypto),
  createdAt = new Date().toISOString(),
): StructureCluster[] {
  const groups = new Map<string, { signature: StructureSignature; refs: string[] }>();

  for (const observation of input.observations) {
    for (const regimeLabel of observation.observedRegimes) {
      const volBucket = volBucketFromObservation(observation);
      const signatureKey = buildSignatureKey(regimeLabel, volBucket);
      const existing = groups.get(signatureKey);
      if (existing) {
        existing.refs.push(observation.observationId);
        existing.signature.observationCount += 1;
        existing.signature.tradeCount += observation.tradeRefs.length;
      } else {
        groups.set(signatureKey, {
          signature: {
            signatureKey,
            regimeLabel,
            volBucket,
            tradeCount: observation.tradeRefs.length,
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
      const draft: Omit<StructureCluster, "contentDigest"> = {
        schemaVersion: STRUCTURE_CLUSTER_SCHEMA_VERSION,
        clusterId,
        campaignRef: input.campaignRef,
        signature,
        memberObservationRefs: [...new Set(refs)].sort((a, b) => a.localeCompare(b)),
        createdAt,
      };
      return {
        ...draft,
        contentDigest: buildStructureClusterContentDigest(draft),
      };
    });
}
