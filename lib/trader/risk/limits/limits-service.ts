/**
 * Org-scoped risk limit configuration persistence (DEE-239).
 *
 * v0 stores one organization-level profile per org (`scope_type='organization'`, `scope_ref=''`).
 * Future venue/strategy resolution (most-specific match: strategy → venue → org) is deferred to
 * DEE-241+ — columns exist but v0 service methods hardcode org scope only.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import {
  createPostgresRiskLimitsRepository,
  createSqliteRiskLimitsRepository,
} from "@/lib/trader/risk/limits/repository-adapters";
import type {
  OrgRiskLimitsMetadata,
  OrgRiskLimitsScope,
  RiskLimitsService,
  RiskLimitsServiceDeps,
  UpsertLimitsResult,
  UpsertOrgRiskLimitsInput,
} from "@/lib/trader/risk/limits/types";
import {
  normalizedConfigToRowInput,
  rowToNormalizedConfig,
  toOrgRiskLimitsMetadata,
} from "@/lib/trader/risk/limits/types";
import {
  diffRiskLimitsConfig,
  normalizeAndValidateRiskLimitsInput,
  riskLimitsConfigEquals,
} from "@/lib/trader/risk/limits/validate-limits";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgRiskLimitsExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

const ORG_SCOPE: OrgRiskLimitsScope = {
  scopeType: "organization",
  scopeRef: null,
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: RiskLimitsServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function buildAuditInput(
  context: OrgContext,
  entityId: string,
  action: TraderAuditInput["action"],
  metadata: Record<string, unknown>,
  actorType: TraderAuditInput["actorType"] = "service",
  actorId: string | null = null,
): TraderAuditInput {
  return {
    actorType,
    actorId,
    action,
    entityType: traderEntityTypes.riskLimits,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

async function persistLimitsChange(
  deps: RiskLimitsServiceDeps,
  context: OrgContext,
  candidate: ReturnType<typeof normalizeAndValidateRiskLimitsInput>,
  input?: Pick<UpsertOrgRiskLimitsInput, "actorType" | "actorId" | "reason">,
): Promise<UpsertLimitsResult> {
  const scoped = requireOrgContext(context.organizationId);
  const existing = await deps.repository.getLimitsRowForScope(scoped, ORG_SCOPE);

  if (!existing) {
    const row = await deps.repository.insertLimitsRowForScope(
      scoped,
      ORG_SCOPE,
      normalizedConfigToRowInput(candidate, 1),
    );
    const metadata = toOrgRiskLimitsMetadata(row);
    const auditMetadata: Record<string, unknown> = {
      scopeType: metadata.scopeType,
      configVersion: metadata.configVersion,
    };
    if (input?.reason) {
      auditMetadata.reason = input.reason;
    }
    await deps.writeAudit(
      buildAuditInput(
        scoped,
        metadata.id,
        traderAuditActions.riskLimitsCreated,
        auditMetadata,
        input?.actorType ?? "service",
        input?.actorId ?? null,
      ),
    );
    return { metadata, created: true, updated: false };
  }

  const previous = rowToNormalizedConfig(existing);
  if (riskLimitsConfigEquals(previous, candidate)) {
    return {
      metadata: toOrgRiskLimitsMetadata(existing),
      created: false,
      updated: false,
    };
  }

  const nextVersion = existing.configVersion + 1;
  const row = await deps.repository.updateLimitsRowForScope(
    scoped,
    ORG_SCOPE,
    existing.id,
    normalizedConfigToRowInput(candidate, nextVersion),
  );
  if (!row) {
    throw new Error("[trader] risk limits update failed");
  }

  const metadata = toOrgRiskLimitsMetadata(row);
  const changedFields = diffRiskLimitsConfig(previous, candidate);
  const auditMetadata: Record<string, unknown> = {
    scopeType: metadata.scopeType,
    configVersion: metadata.configVersion,
    changedFields,
  };
  if (input?.reason) {
    auditMetadata.reason = input.reason;
  }
  await deps.writeAudit(
    buildAuditInput(
      scoped,
      metadata.id,
      traderAuditActions.riskLimitsUpdated,
      auditMetadata,
      input?.actorType ?? "service",
      input?.actorId ?? null,
    ),
  );

  return { metadata, created: false, updated: true };
}

export function createRiskLimitsService(deps: RiskLimitsServiceDeps): RiskLimitsService {
  return {
    async getLimitsForOrg(context: OrgContext): Promise<OrgRiskLimitsMetadata | null> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const row = await deps.repository.getLimitsRowForScope(scoped, ORG_SCOPE);
      return row ? toOrgRiskLimitsMetadata(row) : null;
    },

    async getOrCreateLimitsForOrg(context: OrgContext): Promise<OrgRiskLimitsMetadata> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const existing = await deps.repository.getLimitsRowForScope(scoped, ORG_SCOPE);
      if (existing) {
        return toOrgRiskLimitsMetadata(existing);
      }

      const candidate = normalizeAndValidateRiskLimitsInput(DEFAULT_ORG_RISK_LIMITS);
      const result = await persistLimitsChange(deps, scoped, candidate);
      return result.metadata;
    },

    async upsertLimitsForOrg(
      context: OrgContext,
      input: UpsertOrgRiskLimitsInput,
    ): Promise<OrgRiskLimitsMetadata> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const candidate = normalizeAndValidateRiskLimitsInput(input);
      const result = await persistLimitsChange(deps, scoped, candidate, input);
      return result.metadata;
    },
  };
}

export function createSqliteRiskLimitsService(
  db: WaiaDb,
  deps: Partial<RiskLimitsServiceDeps> = {},
): RiskLimitsService {
  return createRiskLimitsService({
    repository: deps.repository ?? createSqliteRiskLimitsRepository(db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
    assertMembership:
      deps.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  });
}

export function createPostgresRiskLimitsService(
  ex: PgRiskLimitsExecutor,
  deps: Partial<RiskLimitsServiceDeps> = {},
): RiskLimitsService {
  return createRiskLimitsService({
    repository: deps.repository ?? createPostgresRiskLimitsRepository(ex),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
  });
}
