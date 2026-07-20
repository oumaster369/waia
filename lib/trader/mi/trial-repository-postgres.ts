import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { MiTrial } from "@/lib/trader/mi/trial.types";
import type { InsertTrialRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapTrial(row: typeof pgSchema.traderMiTrial.$inferSelect): MiTrial {
  return {
    id: row.id,
    organizationId: row.organizationId,
    hypothesisId: row.hypothesisId,
    hypothesisKey: row.hypothesisKey,
    hypothesisDefinitionDigest: row.hypothesisDefinitionDigest,
    researchProgram: row.researchProgram,
    eventTime: row.eventTime,
    ingestTime: row.ingestTime,
    registeredBy: row.registeredBy,
    seq: row.seq,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export async function getLatestTrialPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
): Promise<MiTrial | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiTrial)
    .where(
      and(
        eq(pgSchema.traderMiTrial.hypothesisKey, hypothesisKey),
        orgScopedWhere(pgSchema.traderMiTrial.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiTrial.seq))
    .limit(1);

  return rows[0] ? mapTrial(rows[0]) : null;
}

export async function listTrialsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisKey: string,
): Promise<MiTrial[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiTrial)
    .where(
      and(
        eq(pgSchema.traderMiTrial.hypothesisKey, hypothesisKey),
        orgScopedWhere(pgSchema.traderMiTrial.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderMiTrial.seq);

  return rows.map(mapTrial);
}

export async function listTrialsByHypothesisIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  hypothesisId: string,
): Promise<MiTrial[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiTrial)
    .where(
      and(
        eq(pgSchema.traderMiTrial.hypothesisId, hypothesisId),
        orgScopedWhere(pgSchema.traderMiTrial.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderMiTrial.seq);

  return rows.map(mapTrial);
}

export async function findTrialByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  trialId: string,
): Promise<MiTrial | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiTrial)
    .where(
      and(
        eq(pgSchema.traderMiTrial.id, trialId),
        orgScopedWhere(pgSchema.traderMiTrial.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapTrial(rows[0]) : null;
}

export async function insertTrialPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertTrialRow,
): Promise<MiTrial> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiTrial).values({
    id: row.id,
    organizationId: scoped.organizationId,
    hypothesisId: row.hypothesisId,
    hypothesisKey: row.hypothesisKey,
    hypothesisDefinitionDigest: row.hypothesisDefinitionDigest,
    researchProgram: row.researchProgram,
    eventTime: row.eventTime,
    ingestTime: row.ingestTime,
    registeredBy: row.registeredBy,
    seq: row.seq,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiTrial)
    .where(
      and(
        eq(pgSchema.traderMiTrial.id, row.id),
        orgScopedWhere(pgSchema.traderMiTrial.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi trial insert failed");
  }
  return mapTrial(rows[0]);
}
