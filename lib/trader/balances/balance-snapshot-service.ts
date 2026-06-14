import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  createPostgresBalanceSnapshotRepository,
  createSqliteBalanceSnapshotRepository,
} from "@/lib/trader/balances/repository-adapters";
import type {
  BalanceSnapshotMetadata,
  BalanceSnapshotService,
  BalanceSnapshotServiceDeps,
  RecordBalanceSnapshotInput,
} from "@/lib/trader/balances/types";
import { toBalanceSnapshotMetadata } from "@/lib/trader/balances/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgBalanceSnapshotExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: BalanceSnapshotServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function buildAuditInput(
  context: OrgContext,
  entityId: string,
  metadata: Record<string, unknown>,
  actorType: TraderAuditInput["actorType"] = "service",
  actorId: string | null = null,
): TraderAuditInput {
  return {
    actorType,
    actorId,
    action: traderAuditActions.balanceSnapshotCreated,
    entityType: traderEntityTypes.balanceSnapshot,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

export function createBalanceSnapshotService(
  deps: BalanceSnapshotServiceDeps,
): BalanceSnapshotService {
  return {
    async recordSnapshot(
      context: OrgContext,
      input: RecordBalanceSnapshotInput,
    ): Promise<BalanceSnapshotMetadata> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const row = await deps.repository.insertBalanceSnapshotRow(scoped, {
        credentialId: input.credentialId,
        venue: input.venue,
        exchangeAccountId: input.exchangeAccountId,
        balances: input.balances,
        assetCount: input.balances.length,
        syncedAt: input.syncedAt,
      });

      const actorType = input.actorType ?? "service";
      const actorId = input.actorId ?? null;
      await deps.writeAudit(
        buildAuditInput(
          scoped,
          row.id,
          {
            venue: input.venue,
            exchangeAccountId: input.exchangeAccountId,
            credentialId: input.credentialId,
            assetCount: input.balances.length,
            syncedAt: input.syncedAt.toISOString(),
          },
          actorType,
          actorId,
        ),
      );

      return toBalanceSnapshotMetadata(row);
    },

    async listSnapshots(context: OrgContext, query = {}): Promise<BalanceSnapshotMetadata[]> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const rows = await deps.repository.listBalanceSnapshotRows(scoped, query);
      return rows.map(toBalanceSnapshotMetadata);
    },
  };
}

export function createSqliteBalanceSnapshotService(
  db: WaiaDb,
  deps: Partial<BalanceSnapshotServiceDeps> = {},
): BalanceSnapshotService {
  return createBalanceSnapshotService({
    repository: deps.repository ?? createSqliteBalanceSnapshotRepository(db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
    assertMembership:
      deps.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  });
}

export function createPostgresBalanceSnapshotService(
  ex: PgBalanceSnapshotExecutor,
  deps: Partial<BalanceSnapshotServiceDeps> = {},
): BalanceSnapshotService {
  return createBalanceSnapshotService({
    repository: deps.repository ?? createPostgresBalanceSnapshotRepository(ex),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
  });
}
