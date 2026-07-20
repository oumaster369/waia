import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  createPostgresPositionSnapshotRepository,
  createSqlitePositionSnapshotRepository,
} from "@/lib/trader/positions/repository-adapters";
import type {
  PositionSnapshotMetadata,
  PositionSnapshotService,
  PositionSnapshotServiceDeps,
  RecordPositionSnapshotInput,
} from "@/lib/trader/positions/types";
import { toPositionSnapshotMetadata } from "@/lib/trader/positions/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgPositionSnapshotExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: PositionSnapshotServiceDeps["assertMembership"],
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
    action: traderAuditActions.positionSnapshotCreated,
    entityType: traderEntityTypes.positionSnapshot,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

export function createPositionSnapshotService(
  deps: PositionSnapshotServiceDeps,
): PositionSnapshotService {
  return {
    async recordSnapshot(
      context: OrgContext,
      input: RecordPositionSnapshotInput,
    ): Promise<PositionSnapshotMetadata> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const row = await deps.repository.insertPositionSnapshotRow(scoped, {
        credentialId: input.credentialId,
        venue: input.venue,
        exchangeAccountId: input.exchangeAccountId,
        positions: input.positions,
        positionCount: input.positions.length,
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
            positionCount: input.positions.length,
            syncedAt: input.syncedAt.toISOString(),
          },
          actorType,
          actorId,
        ),
      );

      return toPositionSnapshotMetadata(row);
    },

    async listSnapshots(context: OrgContext, query = {}): Promise<PositionSnapshotMetadata[]> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const rows = await deps.repository.listPositionSnapshotRows(scoped, query);
      return rows.map(toPositionSnapshotMetadata);
    },
  };
}

export function createSqlitePositionSnapshotService(
  db: WaiaDb,
  deps: Partial<PositionSnapshotServiceDeps> = {},
): PositionSnapshotService {
  return createPositionSnapshotService({
    repository: deps.repository ?? createSqlitePositionSnapshotRepository(db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
    assertMembership:
      deps.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  });
}

export function createPostgresPositionSnapshotService(
  ex: PgPositionSnapshotExecutor,
  deps: Partial<PositionSnapshotServiceDeps> = {},
): PositionSnapshotService {
  return createPositionSnapshotService({
    repository: deps.repository ?? createPostgresPositionSnapshotRepository(ex),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
  });
}
