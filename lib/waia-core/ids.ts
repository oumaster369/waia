import { createHash } from "node:crypto";

const PERSONAL_ORG_NAMESPACE = "waia:core:personal-org:v1";

/**
 * Deterministic personal-organization id for a user.
 * Idempotent backfills and re-runs converge on the same org row.
 */
export function personalOrganizationIdFromUserId(userId: string): string {
  const digest = createHash("sha256").update(`${PERSONAL_ORG_NAMESPACE}:${userId}`).digest("hex");
  const hex = digest.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
