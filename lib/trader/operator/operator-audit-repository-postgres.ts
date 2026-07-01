import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  InsertOperatorAuditRow,
  OperatorAuditEntry,
} from "@/lib/trader/operator/operator.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapOperatorAudit(
  row: typeof pgSchema.traderOperatorAudit.$inferSelect,
): OperatorAuditEntry {
  return {
    id: row.id,
    organizationId: row.organizationId,
    actionKind: row.actionKind,
    actionPayloadJson: row.actionPayloadJson,
    recommendationJson: row.recommendationJson,
    actorKind: row.actorKind as OperatorAuditEntry["actorKind"],
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export async function appendOperatorAuditPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertOperatorAuditRow,
): Promise<OperatorAuditEntry> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderOperatorAudit).values({
    id: row.id,
    organizationId: scoped.organizationId,
    actionKind: row.actionKind,
    actionPayloadJson: row.actionPayloadJson,
    recommendationJson: row.recommendationJson ?? null,
    actorKind: row.actorKind,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderOperatorAudit)
    .where(
      and(
        eq(pgSchema.traderOperatorAudit.id, row.id),
        orgScopedWhere(pgSchema.traderOperatorAudit.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] operator audit insert failed");
  }
  return mapOperatorAudit(rows[0]);
}

export async function listOperatorAuditPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  limit = 50,
): Promise<OperatorAuditEntry[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderOperatorAudit)
    .where(orgScopedWhere(pgSchema.traderOperatorAudit.organizationId, scoped))
    .orderBy(desc(pgSchema.traderOperatorAudit.createdAt))
    .limit(limit);

  return rows.map(mapOperatorAudit);
}
