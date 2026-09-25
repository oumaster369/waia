import { enforceServerOnly } from "@/lib/enforce-server-only";
import { OrgScopeError, requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

enforceServerOnly();

/**
 * Keep the authenticated actor while normalizing the tenant scope. User-scoped
 * calls must prove membership before any repository or credential access.
 * Omitting userId is reserved for trusted server composition (workers/services),
 * never for a request body or an authentication failure.
 */
export async function requireServiceOrgContext(
  context: OrgContext,
  assertMembership?: (context: OrgContext & { userId: string }) => Promise<void> | void,
): Promise<OrgContext> {
  const scoped = requireOrgContext(context.organizationId);
  if (context.userId === undefined) return scoped;
  if (typeof context.userId !== "string" || !context.userId.trim() || context.userId.trim() !== context.userId) {
    throw new OrgScopeError("ORG_ACTOR_INVALID");
  }
  if (!assertMembership) throw new OrgScopeError("ORG_MEMBERSHIP_CHECK_REQUIRED");
  const actorScope = { ...scoped, userId: context.userId };
  await assertMembership(actorScope);
  return actorScope;
}
