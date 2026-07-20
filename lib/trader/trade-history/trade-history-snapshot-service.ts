import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  createPostgresTradeHistorySnapshotRepository,
  createSqliteTradeHistorySnapshotRepository,
} from "@/lib/trader/trade-history/repository-adapters";
import type {
  RecordTradeHistorySnapshotInput,
  TradeHistorySnapshotMetadata,
  TradeHistorySnapshotService,
  TradeHistorySnapshotServiceDeps,
} from "@/lib/trader/trade-history/types";
import { toTradeHistorySnapshotMetadata } from "@/lib/trader/trade-history/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgTradeHistorySnapshotExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: TradeHistorySnapshotServiceDeps["assertMembership"],
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
    action: traderAuditActions.tradeHistorySnapshotCreated,
    entityType: traderEntityTypes.tradeHistorySnapshot,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

export function createTradeHistorySnapshotService(
  deps: TradeHistorySnapshotServiceDeps,
): TradeHistorySnapshotService {
  return {
    async recordSnapshot(
      context: OrgContext,
      input: RecordTradeHistorySnapshotInput,
    ): Promise<TradeHistorySnapshotMetadata> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const row = await deps.repository.insertTradeHistorySnapshotRow(scoped, {
        credentialId: input.credentialId,
        venue: input.venue,
        exchangeAccountId: input.exchangeAccountId,
        symbol: input.symbol,
        trades: input.trades,
        tradeCount: input.trades.length,
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
            symbol: input.symbol,
            tradeCount: input.trades.length,
            syncedAt: input.syncedAt.toISOString(),
          },
          actorType,
          actorId,
        ),
      );

      return toTradeHistorySnapshotMetadata(row);
    },

    async listSnapshots(context: OrgContext, query = {}): Promise<TradeHistorySnapshotMetadata[]> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const rows = await deps.repository.listTradeHistorySnapshotRows(scoped, query);
      return rows.map(toTradeHistorySnapshotMetadata);
    },
  };
}

export function createSqliteTradeHistorySnapshotService(
  db: WaiaDb,
  deps: Partial<TradeHistorySnapshotServiceDeps> = {},
): TradeHistorySnapshotService {
  return createTradeHistorySnapshotService({
    repository: deps.repository ?? createSqliteTradeHistorySnapshotRepository(db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
    assertMembership:
      deps.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  });
}

export function createPostgresTradeHistorySnapshotService(
  ex: PgTradeHistorySnapshotExecutor,
  deps: Partial<TradeHistorySnapshotServiceDeps> = {},
): TradeHistorySnapshotService {
  return createTradeHistorySnapshotService({
    repository: deps.repository ?? createPostgresTradeHistorySnapshotRepository(ex),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
  });
}
