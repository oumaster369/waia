import "server-only";

import { ensureTraderRuntimeForUser } from "@/lib/trader/runtime-provisioning";

/**
 * Authoritative trader-module access check for route gates.
 * Provisions `trader_org_profiles` when entitlement is present (NEW-4 / DEE-331).
 */
export async function hasTraderAccessForUser(userId: string): Promise<boolean> {
  return ensureTraderRuntimeForUser(userId);
}
