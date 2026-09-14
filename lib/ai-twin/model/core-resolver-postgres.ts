import "server-only";

import type postgres from "postgres";

import {
  TWIN_PERSONAL_MODEL_ACCESS_POLICY,
  type ResolvedTwinCoreAccessContext,
} from "./core-access";
import type { TwinRepositoryAuthorityAdapter } from "./postgres-repository";
import { assertModelJsonData } from "./persistence-contracts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductionTwinCoreRowPresence = Readonly<{
  actorUserPresent: boolean;
  organizationPresent: boolean;
  actorMembershipPresent: boolean;
  subjectMembershipPresent: boolean;
}>;

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Maps transaction-current Core row presence to the closed evaluator input.
 * Existing rows are `current`; absent rows are null. No role/entitlement fields.
 */
export function assembleProductionTwinCoreAccessContext(input: {
  target: { organizationId: string; subjectUserId: string };
  actorUserId: string | null;
  presence: ProductionTwinCoreRowPresence;
}): unknown {
  assertModelJsonData(input);
  const snapshot = structuredClone(input) as typeof input;
  const target = snapshot.target;
  const actorUserId = snapshot.actorUserId;
  const presence = snapshot.presence;
  if (
    !uuid.test(target.organizationId) ||
    !uuid.test(target.subjectUserId) ||
    (actorUserId !== null && !uuid.test(actorUserId))
  ) {
    throw new Error("TWIN_CORE_CONTEXT_MALFORMED");
  }
  const context: ResolvedTwinCoreAccessContext = {
    policyVersion: TWIN_PERSONAL_MODEL_ACCESS_POLICY,
    target: {
      organizationId: target.organizationId,
      subjectUserId: target.subjectUserId,
    },
    actor:
      actorUserId === null
        ? {
            authentication: "unauthenticated",
            actorClass: "human",
            actorUserId: null,
          }
        : {
            authentication: "authenticated",
            actorClass: "human",
            actorUserId,
          },
    organization: presence.organizationPresent
      ? { organizationId: target.organizationId, status: "current" }
      : null,
    membership:
      actorUserId !== null && presence.actorUserPresent && presence.actorMembershipPresent
        ? {
            organizationId: target.organizationId,
            actorUserId,
            status: "current",
          }
        : null,
    subjectBinding: presence.subjectMembershipPresent
      ? {
          organizationId: target.organizationId,
          subjectUserId: target.subjectUserId,
          status: "current",
        }
      : null,
  };
  return freeze(structuredClone(context));
}

/**
 * Production Core authority adapter. Actor identity is captured immediately
 * before repository entry; this adapter only re-reads and locks Core rows on
 * the reserved transaction. It never accepts a prior access decision.
 */
export function createProductionTwinCoreAuthorityAdapter(input: {
  actorUserId: string | null;
}): TwinRepositoryAuthorityAdapter {
  const actorUserId = input.actorUserId;
  if (actorUserId !== null && !uuid.test(actorUserId)) {
    throw new Error("TWIN_SESSION_REQUIRED");
  }
  return {
    resolveAuthenticatedActor: async (tx) => {
      await tx`select txid_current()`;
      if (actorUserId === null) throw new Error("TWIN_SESSION_REQUIRED");
      return Object.freeze({ actorClass: "human" as const, actorUserId });
    },
    resolveCurrentCoreAccess: async (tx, request) => {
      if (request.actor.actorClass !== "human" || request.actor.actorUserId !== actorUserId) {
        throw new Error("TWIN_SESSION_REQUIRED");
      }
      return resolveProductionTwinCoreAccess(tx, {
        actorUserId,
        organizationId: request.organizationId,
        subjectUserId: request.subjectUserId,
      });
    },
  };
}

export async function resolveProductionTwinCoreAccess(
  tx: postgres.Sql | postgres.TransactionSql,
  request: Readonly<{
    actorUserId: string | null;
    organizationId: string;
    subjectUserId: string;
  }>,
): Promise<unknown> {
  if (!uuid.test(request.organizationId) || !uuid.test(request.subjectUserId)) {
    throw new Error("TWIN_CORE_CONTEXT_MALFORMED");
  }
  if (request.actorUserId !== null && !uuid.test(request.actorUserId)) {
    throw new Error("TWIN_SESSION_REQUIRED");
  }

  let actorUserPresent = false;
  if (request.actorUserId !== null) {
    const actorRows = await tx<{ id: string }[]>`
      SELECT id FROM public.users
      WHERE id = ${request.actorUserId}::uuid
      FOR SHARE
    `;
    actorUserPresent = actorRows.length === 1;
  }

  const organizationRows = await tx<{ id: string }[]>`
    SELECT id FROM public.organizations
    WHERE id = ${request.organizationId}::uuid
    FOR SHARE
  `;

  let actorMembershipPresent = false;
  if (request.actorUserId !== null) {
    const actorMembership = await tx<{ organization_id: string; user_id: string }[]>`
      SELECT organization_id, user_id
      FROM public.organization_members
      WHERE organization_id = ${request.organizationId}::uuid
        AND user_id = ${request.actorUserId}::uuid
      FOR SHARE
    `;
    actorMembershipPresent = actorMembership.length === 1;
  }

  const subjectMembership = await tx<{ organization_id: string; user_id: string }[]>`
    SELECT organization_id, user_id
    FROM public.organization_members
    WHERE organization_id = ${request.organizationId}::uuid
      AND user_id = ${request.subjectUserId}::uuid
    FOR SHARE
  `;

  return assembleProductionTwinCoreAccessContext({
    target: {
      organizationId: request.organizationId,
      subjectUserId: request.subjectUserId,
    },
    actorUserId: request.actorUserId,
    presence: {
      actorUserPresent,
      organizationPresent: organizationRows.length === 1,
      actorMembershipPresent,
      subjectMembershipPresent: subjectMembership.length === 1,
    },
  });
}
