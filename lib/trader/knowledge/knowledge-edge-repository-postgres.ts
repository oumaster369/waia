import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  InsertKnowledgeEdgeRow,
  KnowledgeEdge,
  UpdateKnowledgeEdgeRow,
} from "@/lib/trader/knowledge/knowledge.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;
type PgDeleteExecutor = Pick<WaiaPostgresDb, "select" | "delete">;

function mapKnowledgeEdge(row: typeof pgSchema.traderKnowledgeEdges.$inferSelect): KnowledgeEdge {
  return {
    id: row.id,
    organizationId: row.organizationId,
    fromRef: row.fromRef,
    toRef: row.toRef,
    relationKind: row.relationKind,
    confidence: row.confidence,
    strength: row.strength,
    regimeScope: row.regimeScope,
    failureCasesJson: row.failureCasesJson,
    hypothesisId: row.hypothesisId,
    verified: row.verified,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function insertKnowledgeEdgePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertKnowledgeEdgeRow,
): Promise<KnowledgeEdge> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderKnowledgeEdges).values({
    id: row.id,
    organizationId: scoped.organizationId,
    fromRef: row.fromRef,
    toRef: row.toRef,
    relationKind: row.relationKind,
    confidence: row.confidence,
    strength: row.strength,
    regimeScope: row.regimeScope,
    failureCasesJson: row.failureCasesJson,
    hypothesisId: row.hypothesisId ?? null,
    verified: row.verified ?? false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderKnowledgeEdges)
    .where(
      and(
        eq(pgSchema.traderKnowledgeEdges.id, row.id),
        orgScopedWhere(pgSchema.traderKnowledgeEdges.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] knowledge edge insert failed");
  }
  return mapKnowledgeEdge(rows[0]);
}

export async function getKnowledgeEdgeByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  edgeId: string,
): Promise<KnowledgeEdge | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderKnowledgeEdges)
    .where(
      and(
        eq(pgSchema.traderKnowledgeEdges.id, edgeId),
        orgScopedWhere(pgSchema.traderKnowledgeEdges.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapKnowledgeEdge(rows[0]) : null;
}

export async function listKnowledgeEdgesPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  fromRef?: string,
  toRef?: string,
): Promise<KnowledgeEdge[]> {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(pgSchema.traderKnowledgeEdges.organizationId, scoped)];
  if (fromRef) {
    conditions.push(eq(pgSchema.traderKnowledgeEdges.fromRef, fromRef));
  }
  if (toRef) {
    conditions.push(eq(pgSchema.traderKnowledgeEdges.toRef, toRef));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderKnowledgeEdges)
    .where(and(...conditions))
    .orderBy(asc(pgSchema.traderKnowledgeEdges.createdAt));

  return rows.map(mapKnowledgeEdge);
}

export async function updateKnowledgeEdgePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  edgeId: string,
  patch: UpdateKnowledgeEdgeRow,
): Promise<KnowledgeEdge> {
  const scoped = requireOrgContext(context.organizationId);

  await ex
    .update(pgSchema.traderKnowledgeEdges)
    .set({
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.strength !== undefined ? { strength: patch.strength } : {}),
      ...(patch.regimeScope !== undefined ? { regimeScope: patch.regimeScope } : {}),
      ...(patch.failureCasesJson !== undefined ? { failureCasesJson: patch.failureCasesJson } : {}),
      ...(patch.hypothesisId !== undefined ? { hypothesisId: patch.hypothesisId } : {}),
      ...(patch.verified !== undefined ? { verified: patch.verified } : {}),
      updatedAt: patch.updatedAt,
    })
    .where(
      and(
        eq(pgSchema.traderKnowledgeEdges.id, edgeId),
        orgScopedWhere(pgSchema.traderKnowledgeEdges.organizationId, scoped),
      ),
    );

  const edge = await getKnowledgeEdgeByIdPostgres(ex, context, edgeId);
  if (!edge) {
    throw new Error("[trader] knowledge edge update failed");
  }
  return edge;
}

export async function deleteKnowledgeEdgePostgres(
  ex: PgDeleteExecutor,
  context: OrgContext,
  edgeId: string,
): Promise<boolean> {
  const existing = await getKnowledgeEdgeByIdPostgres(ex, context, edgeId);
  if (!existing) {
    return false;
  }

  await ex
    .delete(pgSchema.traderKnowledgeEdges)
    .where(
      and(
        eq(pgSchema.traderKnowledgeEdges.id, edgeId),
        orgScopedWhere(
          pgSchema.traderKnowledgeEdges.organizationId,
          requireOrgContext(context.organizationId),
        ),
      ),
    );

  return true;
}
