import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { ContributionShareEngine } from "@/lib/waia-core/treasury/share/engine";
import type { PublicContributionAggregate } from "@/lib/waia-core/treasury/share/types";

/**
 * Aggregate-only public contribution contract. Server-side; not an HTTP route.
 * Never includes contributor identity, transaction ids, or ranked contributor lists.
 */
export async function getPublicContributionAggregate(
  context: OrgContext,
  engine: Pick<ContributionShareEngine, "computePublicAggregate">,
): Promise<PublicContributionAggregate> {
  requireOrgContext(context.organizationId);
  return engine.computePublicAggregate(context);
}
