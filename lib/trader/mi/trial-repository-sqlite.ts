import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderMiTrial } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { MiTrial } from "@/lib/trader/mi/trial.types";
import type { InsertTrialRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapTrial(row: typeof traderMiTrial.$inferSelect): MiTrial {
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

export function getLatestTrialSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
): MiTrial | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiTrial)
    .where(
      and(
        eq(traderMiTrial.hypothesisKey, hypothesisKey),
        orgScopedWhere(traderMiTrial.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiTrial.seq))
    .limit(1)
    .all()[0];

  return row ? mapTrial(row) : null;
}

export function listTrialsSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisKey: string,
): MiTrial[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiTrial)
    .where(
      and(
        eq(traderMiTrial.hypothesisKey, hypothesisKey),
        orgScopedWhere(traderMiTrial.organizationId, scoped),
      ),
    )
    .orderBy(traderMiTrial.seq)
    .all()
    .map(mapTrial);
}

export function listTrialsByHypothesisIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  hypothesisId: string,
): MiTrial[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiTrial)
    .where(
      and(
        eq(traderMiTrial.hypothesisId, hypothesisId),
        orgScopedWhere(traderMiTrial.organizationId, scoped),
      ),
    )
    .orderBy(traderMiTrial.seq)
    .all()
    .map(mapTrial);
}

export function findTrialByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  trialId: string,
): MiTrial | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiTrial)
    .where(and(eq(traderMiTrial.id, trialId), orgScopedWhere(traderMiTrial.organizationId, scoped)))
    .limit(1)
    .all()[0];

  return row ? mapTrial(row) : null;
}

export function insertTrialSqlite(db: WaiaDb, context: OrgContext, row: InsertTrialRow): MiTrial {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiTrial)
    .values({
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
    })
    .run();

  const inserted = db
    .select()
    .from(traderMiTrial)
    .where(and(eq(traderMiTrial.id, row.id), orgScopedWhere(traderMiTrial.organizationId, scoped)))
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi trial insert failed");
  }
  return mapTrial(inserted);
}
