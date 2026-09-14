import type { ModelScope } from "./contracts";
import { assertModelJsonData } from "./persistence-contracts";

/**
 * Pure personal-model isolation policy. Supabase Auth / WAIA Core must resolve
 * this context; this module authenticates nobody and reads/writes no storage.
 */
export const TWIN_PERSONAL_MODEL_ACCESS_POLICY = "human-approved-2026-09-14/v1";

type CoreRecordStatus = "current" | "stale" | "revoked";

export type ResolvedTwinCoreAccessContext = Readonly<{
  policyVersion: typeof TWIN_PERSONAL_MODEL_ACCESS_POLICY;
  /** Trusted request target resolved by the Core adapter, never ID authority by itself. */
  target: {
    organizationId: string;
    subjectUserId: string;
  };
  actor: {
    authentication: "authenticated" | "unauthenticated";
    actorClass: "human" | "service" | "agent";
    actorUserId: string | null;
  } | null;
  organization: {
    organizationId: string;
    status: CoreRecordStatus;
  } | null;
  membership: {
    organizationId: string;
    actorUserId: string;
    status: CoreRecordStatus;
  } | null;
  subjectBinding: {
    organizationId: string;
    subjectUserId: string;
    status: CoreRecordStatus;
  } | null;
}>;

export type TwinPersonalModelAccessDenialReason =
  | "TWIN_CORE_CONTEXT_REQUIRED"
  | "TWIN_CORE_CONTEXT_MALFORMED"
  | "TWIN_AUTHENTICATION_REQUIRED"
  | "TWIN_ACTOR_CLASS_NOT_ADMITTED"
  | "TWIN_ORGANIZATION_NOT_CURRENT"
  | "TWIN_MEMBERSHIP_NOT_CURRENT"
  | "TWIN_SUBJECT_BINDING_NOT_CURRENT"
  | "TWIN_ORGANIZATION_MISMATCH"
  | "TWIN_MEMBERSHIP_MISMATCH"
  | "TWIN_SUBJECT_BINDING_MISMATCH"
  | "TWIN_PERSONAL_SUBJECT_MISMATCH";

export type TwinPersonalModelAccessDecision =
  | Readonly<{
      allowed: false;
      reason: TwinPersonalModelAccessDenialReason;
    }>
  | Readonly<{
      allowed: true;
      reason: "ALLOWED";
      policyVersion: typeof TWIN_PERSONAL_MODEL_ACCESS_POLICY;
      scope: ModelScope;
      actor: Readonly<{ kind: "human"; subjectId: string }>;
    }>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recordStatuses = new Set<CoreRecordStatus>(["current", "stale", "revoked"]);
const actorClasses = new Set(["human", "service", "agent"]);

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function deny(reason: TwinPersonalModelAccessDenialReason): TwinPersonalModelAccessDecision {
  return Object.freeze({ allowed: false as const, reason });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function malformed(): TwinPersonalModelAccessDecision {
  return deny("TWIN_CORE_CONTEXT_MALFORMED");
}

/**
 * Evaluates only a trusted, fully resolved Core snapshot. Matching identifiers
 * supplied by a caller cannot make that snapshot trusted. No role, entitlement,
 * Formation state or product authority is accepted by this closed input shape.
 */
export function evaluatePersonalTwinModelAccess(input: unknown): TwinPersonalModelAccessDecision {
  if (input === null || input === undefined) return deny("TWIN_CORE_CONTEXT_REQUIRED");
  try {
    assertModelJsonData(input);
    // Native structured clone rejects Proxy/exotic objects. All subsequent
    // checks use this detached snapshot, never repeatedly read caller state.
    input = structuredClone(input);
    assertModelJsonData(input);
  } catch {
    return malformed();
  }
  if (
    !exactKeys(input, [
      "policyVersion",
      "target",
      "actor",
      "organization",
      "membership",
      "subjectBinding",
    ]) ||
    input.policyVersion !== TWIN_PERSONAL_MODEL_ACCESS_POLICY ||
    !exactKeys(input.target, ["organizationId", "subjectUserId"]) ||
    !validUuid(input.target.organizationId) ||
    !validUuid(input.target.subjectUserId)
  )
    return malformed();

  if (input.actor === null) return deny("TWIN_AUTHENTICATION_REQUIRED");
  if (
    !exactKeys(input.actor, ["authentication", "actorClass", "actorUserId"]) ||
    !["authenticated", "unauthenticated"].includes(String(input.actor.authentication)) ||
    !actorClasses.has(String(input.actor.actorClass)) ||
    (input.actor.actorUserId !== null && !validUuid(input.actor.actorUserId))
  )
    return malformed();
  if (input.actor.authentication !== "authenticated") return deny("TWIN_AUTHENTICATION_REQUIRED");
  if (!validUuid(input.actor.actorUserId)) return malformed();
  if (input.actor.actorClass !== "human") return deny("TWIN_ACTOR_CLASS_NOT_ADMITTED");

  if (input.organization === null || input.membership === null || input.subjectBinding === null)
    return deny("TWIN_CORE_CONTEXT_REQUIRED");
  if (
    !exactKeys(input.organization, ["organizationId", "status"]) ||
    !validUuid(input.organization.organizationId) ||
    !recordStatuses.has(input.organization.status as CoreRecordStatus) ||
    !exactKeys(input.membership, ["organizationId", "actorUserId", "status"]) ||
    !validUuid(input.membership.organizationId) ||
    !validUuid(input.membership.actorUserId) ||
    !recordStatuses.has(input.membership.status as CoreRecordStatus) ||
    !exactKeys(input.subjectBinding, ["organizationId", "subjectUserId", "status"]) ||
    !validUuid(input.subjectBinding.organizationId) ||
    !validUuid(input.subjectBinding.subjectUserId) ||
    !recordStatuses.has(input.subjectBinding.status as CoreRecordStatus)
  )
    return malformed();

  if (input.organization.status !== "current") return deny("TWIN_ORGANIZATION_NOT_CURRENT");
  if (input.membership.status !== "current") return deny("TWIN_MEMBERSHIP_NOT_CURRENT");
  if (input.subjectBinding.status !== "current") return deny("TWIN_SUBJECT_BINDING_NOT_CURRENT");
  if (input.organization.organizationId !== input.target.organizationId)
    return deny("TWIN_ORGANIZATION_MISMATCH");
  if (
    input.membership.organizationId !== input.target.organizationId ||
    input.membership.actorUserId !== input.actor.actorUserId
  )
    return deny("TWIN_MEMBERSHIP_MISMATCH");
  if (
    input.subjectBinding.organizationId !== input.target.organizationId ||
    input.subjectBinding.subjectUserId !== input.target.subjectUserId
  )
    return deny("TWIN_SUBJECT_BINDING_MISMATCH");
  if (input.actor.actorUserId !== input.target.subjectUserId)
    return deny("TWIN_PERSONAL_SUBJECT_MISMATCH");

  return deepFreeze(
    structuredClone({
      allowed: true as const,
      reason: "ALLOWED" as const,
      policyVersion: TWIN_PERSONAL_MODEL_ACCESS_POLICY,
      scope: {
        organizationId: input.target.organizationId,
        subjectId: input.target.subjectUserId,
      },
      actor: {
        kind: "human" as const,
        subjectId: input.actor.actorUserId,
      },
    }),
  );
}
