import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq, inArray } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { KnowledgeEdge } from "@/lib/trader/knowledge/knowledge.types";
import {
  KNOWLEDGE_AUTHORITY_REASON,
  KnowledgeAuthorityError,
  KNOWLEDGE_EDGE_VERSION_SCHEMA_V2,
  computeKnowledgeEdgeVersionContentDigestHex,
  knowledgeEdgeVersionRowId,
  planKnowledgeEdgeVersionAppend,
  type KnowledgeEdgeEpistemicContent,
  type KnowledgeEdgeVersionReasonClass,
  type KnowledgeEdgeVersionSnapshot,
} from "@/lib/trader/knowledge/knowledge-edge-version-v2";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function contentFromEdge(
  edge: KnowledgeEdge,
  lifecycleState: KnowledgeEdgeEpistemicContent["lifecycleState"] = "ACTIVE",
): KnowledgeEdgeEpistemicContent {
  return {
    fromRef: edge.fromRef,
    toRef: edge.toRef,
    relationKind: edge.relationKind,
    confidence: edge.confidence,
    strength: edge.strength,
    regimeScope: edge.regimeScope,
    failureCasesJson: edge.failureCasesJson,
    hypothesisId: edge.hypothesisId,
    verified: edge.verified,
    lifecycleState,
  };
}

function snapshotFromRow(
  row: typeof pgSchema.traderKnowledgeEdgeVersionV2.$inferSelect,
): KnowledgeEdgeVersionSnapshot {
  const content: KnowledgeEdgeEpistemicContent = {
    fromRef: row.fromRef,
    toRef: row.toRef,
    relationKind: row.relationKind,
    confidence: row.confidence,
    strength: row.strength,
    regimeScope: row.regimeScope,
    failureCasesJson: row.failureCasesJson,
    hypothesisId: row.hypothesisId,
    verified: row.verified,
    lifecycleState: row.lifecycleState as KnowledgeEdgeEpistemicContent["lifecycleState"],
  };
  return {
    id: row.id,
    version: row.version,
    content,
    contentDigestHex: row.contentDigestHex,
    reasonClass: row.reasonClass as KnowledgeEdgeVersionReasonClass,
  };
}

export function applyKnowledgeEdgeVersion(
  edge: KnowledgeEdge,
  snapshot: KnowledgeEdgeVersionSnapshot | null,
): KnowledgeEdge {
  if (!snapshot) return edge;
  return {
    ...edge,
    confidence: snapshot.content.confidence,
    strength: snapshot.content.strength,
    regimeScope: snapshot.content.regimeScope,
    failureCasesJson: snapshot.content.failureCasesJson,
    hypothesisId: snapshot.content.hypothesisId,
    verified: snapshot.content.verified,
  };
}

export async function getLatestKnowledgeEdgeVersionPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  edgeId: string,
): Promise<KnowledgeEdgeVersionSnapshot | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderKnowledgeEdgeVersionV2)
    .where(
      and(
        eq(pgSchema.traderKnowledgeEdgeVersionV2.knowledgeEdgeId, edgeId),
        orgScopedWhere(pgSchema.traderKnowledgeEdgeVersionV2.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderKnowledgeEdgeVersionV2.version))
    .limit(1);
  return rows[0] ? snapshotFromRow(rows[0]) : null;
}

export async function getLatestKnowledgeEdgeVersionsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  edgeIds: readonly string[],
): Promise<Map<string, KnowledgeEdgeVersionSnapshot>> {
  const latest = new Map<string, KnowledgeEdgeVersionSnapshot>();
  if (edgeIds.length === 0) return latest;
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderKnowledgeEdgeVersionV2)
    .where(
      and(
        inArray(pgSchema.traderKnowledgeEdgeVersionV2.knowledgeEdgeId, [...edgeIds]),
        orgScopedWhere(pgSchema.traderKnowledgeEdgeVersionV2.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderKnowledgeEdgeVersionV2.version));
  for (const row of rows) {
    if (!latest.has(row.knowledgeEdgeId)) {
      latest.set(row.knowledgeEdgeId, snapshotFromRow(row));
    }
  }
  return latest;
}

export async function appendKnowledgeEdgeVersionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: {
    edge: KnowledgeEdge;
    reasonClass: string;
    producedByReceiptDigestHex: string;
    expectedVersion: number;
    nextContent: KnowledgeEdgeEpistemicContent;
    pitEventAt: Date;
    recordedAt: Date;
  },
): Promise<{ snapshot: KnowledgeEdgeVersionSnapshot; idempotent: boolean }> {
  const scoped = requireOrgContext(context.organizationId);
  const current = await getLatestKnowledgeEdgeVersionPostgres(ex, context, input.edge.id);
  const plan = planKnowledgeEdgeVersionAppend(current, {
    reasonClass: input.reasonClass,
    producedByReceiptDigestHex: input.producedByReceiptDigestHex,
    expectedVersion: input.expectedVersion,
    nextContent: input.nextContent,
    pitEventAt: input.pitEventAt,
    recordedAt: input.recordedAt,
  });
  if (!plan.ok) {
    throw new KnowledgeAuthorityError(plan.code);
  }
  if (plan.action === "idempotent") {
    if (!current) {
      throw new KnowledgeAuthorityError(KNOWLEDGE_AUTHORITY_REASON.STALE_VERSION);
    }
    return { snapshot: current, idempotent: true };
  }

  const id = knowledgeEdgeVersionRowId(
    [
      KNOWLEDGE_EDGE_VERSION_SCHEMA_V2,
      scoped.organizationId,
      input.edge.id,
      String(plan.version),
      plan.reasonClass,
      plan.contentDigestHex,
    ].join("|"),
  );

  try {
    await ex.insert(pgSchema.traderKnowledgeEdgeVersionV2).values({
      id,
      organizationId: scoped.organizationId,
      knowledgeEdgeId: input.edge.id,
      version: plan.version,
      fromRef: input.nextContent.fromRef,
      toRef: input.nextContent.toRef,
      relationKind: input.nextContent.relationKind,
      confidence: input.nextContent.confidence,
      strength: input.nextContent.strength,
      regimeScope: input.nextContent.regimeScope,
      failureCasesJson: input.nextContent.failureCasesJson,
      hypothesisId: input.nextContent.hypothesisId,
      verified: input.nextContent.verified,
      lifecycleState: plan.lifecycleState,
      reasonClass: plan.reasonClass,
      contentDigestHex: plan.contentDigestHex,
      producedByReceiptDigestHex: input.producedByReceiptDigestHex,
      supersedesVersionId: current?.id ?? null,
      pitEventAt: input.pitEventAt,
      recordedAt: input.recordedAt,
      schemaVersion: KNOWLEDGE_EDGE_VERSION_SCHEMA_V2,
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      const raced = await getLatestKnowledgeEdgeVersionPostgres(ex, context, input.edge.id);
      if (
        raced &&
        raced.contentDigestHex === plan.contentDigestHex &&
        raced.reasonClass === plan.reasonClass
      ) {
        return { snapshot: raced, idempotent: true };
      }
      throw new KnowledgeAuthorityError(KNOWLEDGE_AUTHORITY_REASON.STALE_VERSION);
    }
    throw error;
  }

  const written = await getLatestKnowledgeEdgeVersionPostgres(ex, context, input.edge.id);
  if (!written) {
    throw new KnowledgeAuthorityError(KNOWLEDGE_AUTHORITY_REASON.STALE_VERSION);
  }
  return { snapshot: written, idempotent: false };
}

export async function assertInitialKnowledgeEdgeVersionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  edge: KnowledgeEdge,
  producedByReceiptDigestHex: string,
): Promise<void> {
  const content = contentFromEdge(edge);
  await appendKnowledgeEdgeVersionPostgres(ex, context, {
    edge,
    reasonClass: "INITIAL_ASSERTION",
    producedByReceiptDigestHex,
    expectedVersion: 0,
    nextContent: content,
    pitEventAt: edge.createdAt,
    recordedAt: edge.createdAt,
  });
}

export { computeKnowledgeEdgeVersionContentDigestHex, contentFromEdge };
