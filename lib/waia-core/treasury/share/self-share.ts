import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type { ContributionShareEngine } from "@/lib/waia-core/treasury/share/engine";
import type { SelfContributionShare } from "@/lib/waia-core/treasury/share/types";

/**
 * Authenticated self-only historical contribution share. Server-side; not an HTTP route.
 * `authenticatedUserId` is the session user — not an untrusted contributor selector.
 */
export async function getSelfContributionShare(
  context: OrgContext,
  authenticatedUserId: string,
  engine: Pick<ContributionShareEngine, "computeSelfShare">,
): Promise<SelfContributionShare> {
  requireOrgContext(context.organizationId);
  if (typeof authenticatedUserId !== "string" || authenticatedUserId.trim() === "") {
    throw new TreasuryValidationError("USER_ID_REQUIRED", "authenticated user id is required");
  }
  return engine.computeSelfShare(context, authenticatedUserId.trim());
}
