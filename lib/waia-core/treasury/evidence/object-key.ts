import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { TREASURY_EVIDENCE_OBJECT_KEY_PREFIX } from "@/lib/waia-core/treasury/evidence/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function assertTreasuryEvidenceUuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_RE.test(normalized)) {
    throw new TreasuryValidationError("INVALID_UUID", `${label} must be a UUID`);
  }
  return normalized;
}

/** Deterministic opaque key. Never includes filename, email, purpose, or user text. */
export function treasuryEvidenceObjectKey(
  organizationId: string,
  evidenceObjectId: string,
): string {
  const org = assertTreasuryEvidenceUuid(organizationId, "organizationId");
  const id = assertTreasuryEvidenceUuid(evidenceObjectId, "evidenceObjectId");
  return `${TREASURY_EVIDENCE_OBJECT_KEY_PREFIX}/${org}/${id}`;
}
