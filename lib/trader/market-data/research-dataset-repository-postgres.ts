import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import type { SealedResearchDatasetDigests } from "@/lib/trader/market-data/research-dataset";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type ResearchDatasetRecord = {
  id: string;
  organizationId: string;
  name: string;
  symbol: InstrumentId;
  interval: BarInterval;
  trainBarCount: number;
  validationBarCount: number;
  blindBarCount: number;
  trainDigest: string;
  validationDigest: string;
  blindDigest: string;
  sealedAt: Date;
  metadataJson: string;
  createdAt: Date;
};

export type InsertResearchDatasetRow = {
  id: string;
  name: string;
  symbol: InstrumentId;
  interval: BarInterval;
  sealed: SealedResearchDatasetDigests;
  metadata?: Record<string, unknown>;
  sealedAt?: Date;
  createdAt?: Date;
};

function mapRow(row: typeof pgSchema.researchDataset.$inferSelect): ResearchDatasetRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    symbol: row.symbol as InstrumentId,
    interval: row.interval as BarInterval,
    trainBarCount: row.trainBarCount,
    validationBarCount: row.validationBarCount,
    blindBarCount: row.blindBarCount,
    trainDigest: row.trainDigest,
    validationDigest: row.validationDigest,
    blindDigest: row.blindDigest,
    sealedAt: row.sealedAt,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt,
  };
}

export async function insertResearchDatasetPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertResearchDatasetRow,
): Promise<ResearchDatasetRecord> {
  const scoped = requireOrgContext(context.organizationId);
  const sealedAt = row.sealedAt ?? new Date(row.sealed.sealedAt);
  const createdAt = row.createdAt ?? new Date();
  const metadataJson = JSON.stringify(row.metadata ?? {});

  await ex.insert(pgSchema.researchDataset).values({
    id: row.id,
    organizationId: scoped.organizationId,
    name: row.name,
    symbol: row.symbol,
    interval: row.interval,
    trainBarCount: row.sealed.trainBarCount,
    validationBarCount: row.sealed.validationBarCount,
    blindBarCount: row.sealed.blindBarCount,
    trainDigest: row.sealed.trainDigest,
    validationDigest: row.sealed.validationDigest,
    blindDigest: row.sealed.blindDigest,
    sealedAt,
    metadataJson,
    createdAt,
  });

  const created = await getResearchDatasetByIdPostgres(ex, context, row.id);
  if (!created) {
    throw new Error(`[market-data] failed to load inserted research dataset ${row.id}`);
  }
  return created;
}

export async function getResearchDatasetByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  datasetId: string,
): Promise<ResearchDatasetRecord | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.researchDataset)
    .where(
      and(
        eq(pgSchema.researchDataset.id, datasetId),
        orgScopedWhere(pgSchema.researchDataset.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * Looks up a research dataset by its `(organization_id, name)` unique key — the lookup half
 * of the DEE-398 / ADR-0022 dataset preflight (CREATE / REUSE / CONFLICT decision lives in
 * `lib/trader/research/m9-dataset-preflight.ts`).
 */
export async function getResearchDatasetByNamePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  name: string,
): Promise<ResearchDatasetRecord | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.researchDataset)
    .where(
      and(
        eq(pgSchema.researchDataset.name, name),
        orgScopedWhere(pgSchema.researchDataset.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapRow(rows[0]) : null;
}
