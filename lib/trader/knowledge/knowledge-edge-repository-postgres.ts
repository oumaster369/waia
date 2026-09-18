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
  KNOWLEDGE_AUTHORITY_REASON,
  KnowledgeAuthorityError,
  computeKnowledgeEdgeVersionContentDigestHex,
} from "@/lib/trader/knowledge/knowledge-edge-version-v2";
import {
  applyKnowledgeEdgeVersion,
  assertInitialKnowledgeEdgeVersionPostgres,
  contentFromEdge,
  getLatestKnowledgeEdgeVersionPostgres,
  getLatestKnowledgeEdgeVersionsPostgres,
} from "@/lib/trader/knowledge/knowledge-edge-version-repository-postgres";
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
  const edge = mapKnowledgeEdge(rows[0]);
  await assertInitialKnowledgeEdgeVersionPostgres(
    ex,
    context,
    edge,
    computeKnowledgeEdgeVersionContentDigestHex(contentFromEdge(edge)),
  );
  return applyKnowledgeEdgeVersion(
    edge,
    await getLatestKnowledgeEdgeVersionPostgres(ex, context, edge.id),
  );
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

  if (!rows[0]) return null;
  const edge = mapKnowledgeEdge(rows[0]);
  return applyKnowledgeEdgeVersion(
    edge,
    await getLatestKnowledgeEdgeVersionPostgres(ex, context, edge.id),
  );
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

  const edges = rows.map(mapKnowledgeEdge);
  const versions = await getLatestKnowledgeEdgeVersionsPostgres(
    ex,
    context,
    edges.map((edge) => edge.id),
  );
  return edges.map((edge) => applyKnowledgeEdgeVersion(edge, versions.get(edge.id) ?? null));
}

export async function updateKnowledgeEdgePostgres(
  _ex: PgWriteExecutor,
  _context: OrgContext,
  _edgeId: string,
  _patch: UpdateKnowledgeEdgeRow,
): Promise<KnowledgeEdge> {
  throw new KnowledgeAuthorityError(
    KNOWLEDGE_AUTHORITY_REASON.LEGACY_MKB_MUTATION_DISABLED,
    "LEGACY_MKB_MUTATION_DISABLED: in-place Knowledge mutation is refused",
  );
}

export async function deleteKnowledgeEdgePostgres(
  _ex: PgDeleteExecutor,
  _context: OrgContext,
  _edgeId: string,
): Promise<boolean> {
  throw new KnowledgeAuthorityError(
    KNOWLEDGE_AUTHORITY_REASON.LEGACY_KNOWLEDGE_DELETE_DISABLED,
    "LEGACY_KNOWLEDGE_DELETE_DISABLED: Knowledge history is not deletable",
  );
}
