import "server-only";

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import {
  ReportingPeriodAlreadyOpenError,
  ReportingPeriodNotOpenError,
} from "@/lib/trader/billing/reporting-period.errors";
import type {
  CloseReportingPeriodRepoInput,
  InsertOpenReportingPeriodRepoInput,
  ListReportingPeriodsQuery,
} from "@/lib/trader/billing/reporting-period-repository.types";
import {
  DEFAULT_REPORTING_PERIODS_LIST_LIMIT,
  MAX_REPORTING_PERIODS_LIST_LIMIT,
} from "@/lib/trader/billing/reporting-period-repository.types";
import {
  mapReportingPeriodRow,
  reportingPeriodPayloadToInsertValues,
  reportingPeriodPayloadToUpdateValues,
} from "@/lib/trader/billing/reporting-period-row-mapper";
import type { ReportingPeriodRecordView } from "@/lib/trader/billing/reporting-period.types";
import { isUniqueConstraintError } from "@/lib/trader/execution/order-repository.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_REPORTING_PERIODS_LIST_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (normalized <= 0) {
    return DEFAULT_REPORTING_PERIODS_LIST_LIMIT;
  }
  return Math.min(normalized, MAX_REPORTING_PERIODS_LIST_LIMIT);
}

function mapSelectRow(
  row: typeof pgSchema.traderReportingPeriods.$inferSelect,
): ReportingPeriodRecordView {
  return mapReportingPeriodRow(row);
}

function isPgUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "23505";
  }
  return isUniqueConstraintError(error);
}

export async function insertOpenReportingPeriodPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: InsertOpenReportingPeriodRepoInput,
): Promise<ReportingPeriodRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();
  const { payload } = input;

  try {
    await ex
      .insert(pgSchema.traderReportingPeriods)
      .values(reportingPeriodPayloadToInsertValues(id, scoped.organizationId, payload, now, now));
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      throw new ReportingPeriodAlreadyOpenError(payload.exchangeAccountId);
    }
    throw error;
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderReportingPeriods)
    .where(
      and(
        eq(pgSchema.traderReportingPeriods.id, id),
        orgScopedWhere(pgSchema.traderReportingPeriods.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] reporting period insert failed");
  }
  return mapSelectRow(rows[0]);
}

export async function findOpenReportingPeriodPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  exchangeAccountId: string,
): Promise<ReportingPeriodRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.traderReportingPeriods)
    .where(
      and(
        orgScopedWhere(pgSchema.traderReportingPeriods.organizationId, scoped),
        eq(pgSchema.traderReportingPeriods.exchangeAccountId, exchangeAccountId),
        eq(pgSchema.traderReportingPeriods.status, "OPEN"),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function getReportingPeriodByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  id: string,
): Promise<ReportingPeriodRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.traderReportingPeriods)
    .where(
      and(
        eq(pgSchema.traderReportingPeriods.id, id),
        orgScopedWhere(pgSchema.traderReportingPeriods.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function closeReportingPeriodPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: CloseReportingPeriodRepoInput,
): Promise<ReportingPeriodRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date();
  const { id, payload } = input;

  const updated = await ex
    .update(pgSchema.traderReportingPeriods)
    .set(reportingPeriodPayloadToUpdateValues(payload, now))
    .where(
      and(
        eq(pgSchema.traderReportingPeriods.id, id),
        orgScopedWhere(pgSchema.traderReportingPeriods.organizationId, scoped),
        eq(pgSchema.traderReportingPeriods.status, "OPEN"),
      ),
    )
    .returning({ id: pgSchema.traderReportingPeriods.id });

  if (updated.length === 0) {
    throw new ReportingPeriodNotOpenError(payload.exchangeAccountId);
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderReportingPeriods)
    .where(
      and(
        eq(pgSchema.traderReportingPeriods.id, id),
        orgScopedWhere(pgSchema.traderReportingPeriods.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] reporting period close failed");
  }
  return mapSelectRow(rows[0]);
}

export async function listClosedReportingPeriodsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  query: ListReportingPeriodsQuery = {},
): Promise<ReportingPeriodRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);

  const conditions = [
    orgScopedWhere(pgSchema.traderReportingPeriods.organizationId, scoped),
    eq(pgSchema.traderReportingPeriods.status, "CLOSED"),
  ];
  if (query.exchangeAccountId) {
    conditions.push(eq(pgSchema.traderReportingPeriods.exchangeAccountId, query.exchangeAccountId));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderReportingPeriods)
    .where(and(...conditions))
    .orderBy(desc(pgSchema.traderReportingPeriods.periodEnd))
    .limit(limit);

  return rows.map(mapSelectRow);
}

export async function insertOpenReportingPeriodPostgresTx(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: InsertOpenReportingPeriodRepoInput,
): Promise<ReportingPeriodRecordView> {
  return runWaiaPostgresTransaction(db, (tx) =>
    insertOpenReportingPeriodPostgres(tx, context, input),
  );
}

export async function closeReportingPeriodPostgresTx(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: CloseReportingPeriodRepoInput,
): Promise<ReportingPeriodRecordView> {
  return runWaiaPostgresTransaction(db, (tx) => closeReportingPeriodPostgres(tx, context, input));
}
