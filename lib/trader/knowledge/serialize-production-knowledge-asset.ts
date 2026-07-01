import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/serialize-research-evidence-export";

import {
  HUMAN_KNOWLEDGE_DISPOSITION_SCHEMA_VERSION,
  PRODUCTION_KNOWLEDGE_ASSET_SCHEMA_VERSION,
  type HumanKnowledgeDisposition,
  type ProductionKnowledgeAsset,
} from "@/lib/trader/knowledge/production-knowledge-asset.types";

export function computeProductionKnowledgeAssetDigest(
  asset: Omit<ProductionKnowledgeAsset, "reproducibilityDigest">,
): string {
  return createHash("sha256").update(canonicalJsonString(asset), "utf8").digest("hex");
}

export function serializeProductionKnowledgeAsset(asset: ProductionKnowledgeAsset): string {
  return `${JSON.stringify(asset, null, 2)}\n`;
}

export function assertProductionKnowledgeAssetImmutability(
  original: ProductionKnowledgeAsset,
  reserialized: ProductionKnowledgeAsset,
): void {
  const originalCanonical = canonicalJsonString(original);
  const reserializedCanonical = canonicalJsonString(reserialized);
  if (originalCanonical !== reserializedCanonical) {
    throw new Error("PKA_IMMUTABILITY_VIOLATION");
  }
  if (original.knowledgeId !== reserialized.knowledgeId) {
    throw new Error("PKA_KNOWLEDGE_ID_DRIFT");
  }
  if (original.reproducibilityDigest !== reserialized.reproducibilityDigest) {
    throw new Error("PKA_REPRODUCIBILITY_DIGEST_DRIFT");
  }
}

export function assertProductionKnowledgeAssetSchemaVersion(
  schemaVersion: string,
): asserts schemaVersion is typeof PRODUCTION_KNOWLEDGE_ASSET_SCHEMA_VERSION {
  if (schemaVersion !== PRODUCTION_KNOWLEDGE_ASSET_SCHEMA_VERSION) {
    throw new Error("PKA_SCHEMA_MISMATCH");
  }
}

export function serializeHumanKnowledgeDisposition(disposition: HumanKnowledgeDisposition): string {
  return `${JSON.stringify(disposition, null, 2)}\n`;
}

export function assertHumanKnowledgeDispositionSchemaVersion(
  schemaVersion: string,
): asserts schemaVersion is typeof HUMAN_KNOWLEDGE_DISPOSITION_SCHEMA_VERSION {
  if (schemaVersion !== HUMAN_KNOWLEDGE_DISPOSITION_SCHEMA_VERSION) {
    throw new Error("HUMAN_KNOWLEDGE_DISPOSITION_SCHEMA_MISMATCH");
  }
}
