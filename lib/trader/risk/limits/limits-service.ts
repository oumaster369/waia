/**
 * Org-scoped risk limit configuration persistence (DEE-239).
 *
 * v0 stores one organization-level profile per org (`scope_type='organization'`, `scope_ref=''`).
 * Future venue/strategy resolution (most-specific match: strategy → venue → org) is deferred to
 * DEE-241+ — columns exist but v0 service methods hardcode org scope only.
 */
import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { runSqliteTransaction, type WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import {
  createPostgresRiskLimitsRepository,
  createSqliteRiskLimitsRepository,
} from "@/lib/trader/risk/limits/repository-adapters";
import { insertLimitsRowIfAbsentPostgres, getLimitsRowForScopePostgres } from "@/lib/trader/risk/limits/repository-postgres";
import { insertLimitsRowIfAbsentSqlite, getLimitsRowForScopeSqlite } from "@/lib/trader/risk/limits/repository-sqlite";
import type {
  RiskLimitsRow,
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

type PgRiskLimitsExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update"> &
  Partial<Pick<WaiaPostgresDb, "transaction">>;

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
      await assertMembershipIfNeeded({ ...scoped, userId: context.userId }, deps.assertMembership);

      const row = await deps.repository.getLimitsRowForScope(scoped, ORG_SCOPE);
      return row ? toOrgRiskLimitsMetadata(row) : null;
    },

    async getOrCreateLimitsForOrg(context: OrgContext): Promise<OrgRiskLimitsMetadata> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded({ ...scoped, userId: context.userId }, deps.assertMembership);

      const existing = await deps.repository.getLimitsRowForScope(scoped, ORG_SCOPE);
      if (existing) {
        return toOrgRiskLimitsMetadata(existing);
      }

      // Do not route initialization through upsert: a concurrent operator
      // profile must win without any defaults, version or audit overwrite.
      return deps.initializeLimitsForOrg(scoped);
    },

    async upsertLimitsForOrg(
      context: OrgContext,
      input: UpsertOrgRiskLimitsInput,
    ): Promise<OrgRiskLimitsMetadata> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded({ ...scoped, userId: context.userId }, deps.assertMembership);

      const candidate = normalizeAndValidateRiskLimitsInput(input);
      const result = await persistLimitsChange(deps, scoped, candidate, input);
      return result.metadata;
    },
  };
}

export function createSqliteRiskLimitsService(
  db: WaiaDb,
  deps: Omit<Partial<RiskLimitsServiceDeps>, "writeAudit"> & {
    writeAudit?: (input: TraderAuditInput) => string;
  } = {},
): RiskLimitsService {
  return createRiskLimitsService({
    repository: deps.repository ?? createSqliteRiskLimitsRepository(db),
    initializeLimitsForOrg: deps.initializeLimitsForOrg ?? ((context) =>
      runSqliteTransaction(db, (tx) => {
        const inserted = insertLimitsRowIfAbsentSqlite(tx, context, ORG_SCOPE, defaultRowInput());
        if (inserted) {
          (deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(tx, input)))(
            initializationAudit(context, inserted),
          );
        }
        const row = inserted ?? getLimitsRowForScopeSqlite(tx, context, ORG_SCOPE);
        if (!row) throw new Error("[trader] risk limits initialization unavailable");
        return toOrgRiskLimitsMetadata(row);
      })),
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
    initializeLimitsForOrg: deps.initializeLimitsForOrg ?? (async (context) => {
      if (!ex.transaction) {
        throw new Error("RISK_LIMITS_INITIALIZATION_TRANSACTION_REQUIRED");
      }
      return ex.transaction(async (tx) => {
        const inserted = await insertLimitsRowIfAbsentPostgres(tx, context, ORG_SCOPE, defaultRowInput());
        if (inserted) {
          await (deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(tx, input)))(
            initializationAudit(context, inserted),
          );
        }
        // After ON CONFLICT waits, a fresh READ COMMITTED statement sees the
        // winning committed profile. Never recover with a default UPDATE.
        const row = inserted ?? await getLimitsRowForScopePostgres(tx, context, ORG_SCOPE);
        if (!row) throw new Error("[trader] risk limits initialization unavailable");
        return toOrgRiskLimitsMetadata(row);
      });
    }),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
  });
}

function defaultRowInput() {
  return normalizedConfigToRowInput(normalizeAndValidateRiskLimitsInput(DEFAULT_ORG_RISK_LIMITS), 1);
}

function initializationAudit(context: OrgContext, row: RiskLimitsRow): TraderAuditInput {
  return buildAuditInput(context, row.id, traderAuditActions.riskLimitsCreated, {
    scopeType: row.scopeType,
    configVersion: row.configVersion,
  });
}
