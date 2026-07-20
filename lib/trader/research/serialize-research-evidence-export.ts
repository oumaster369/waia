import { createHash } from "node:crypto";

import { hasSufficientCanonicalRegimeCoverage } from "@/lib/trader/research/regime-taxonomy";
import {
  RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION,
  type ResearchEvidenceDocument,
  type ResearchEvidenceExportBody,
  type ResearchEvidenceSlot,
  type ResearchRegimeCoverage,
} from "@/lib/trader/research/research-evidence-export.types";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, sortKeysDeep(record[key])]),
    );
  }
  return value;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function computeResearchEvidenceExportDigest(
  evidenceBody: ResearchEvidenceExportBody,
): string {
  return createHash("sha256").update(canonicalJsonString(evidenceBody), "utf8").digest("hex");
}

export function buildResearchEvidenceSlot(
  document: ResearchEvidenceDocument,
): ResearchEvidenceSlot {
  const contentDigest = computeResearchEvidenceExportDigest(document.evidenceBody);
  return {
    artifactSchemaVersion: document.schemaVersion,
    contentDigest,
    document,
  };
}

export function hasSufficientResearchRegimeCoverage(coverage: ResearchRegimeCoverage): boolean {
  return hasSufficientCanonicalRegimeCoverage(coverage);
}

export function assertResearchEvidenceSchemaVersion(
  schemaVersion: string,
): asserts schemaVersion is typeof RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION {
  if (schemaVersion !== RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION) {
    throw new Error("RESEARCH_EVIDENCE_SCHEMA_MISMATCH");
  }
}
