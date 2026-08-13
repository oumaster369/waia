import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryBreathReadModelPort } from "@/lib/waia-core/treasury/breath/read-model";
import type { BreathPublicSnapshot } from "@/lib/waia-core/treasury/breath/types";

/**
 * Canonical server-side public Breath snapshot. Not an HTTP route.
 * Callers must pass an explicit OrgContext and a server-bound read model.
 * Never hard-codes an organization id and never opens a browser DB.
 */
export async function getBreathPublicSnapshot(
  context: OrgContext,
  readModel: Pick<TreasuryBreathReadModelPort, "getPublicSnapshot">,
): Promise<BreathPublicSnapshot> {
  requireOrgContext(context.organizationId);
  return readModel.getPublicSnapshot(context);
}
