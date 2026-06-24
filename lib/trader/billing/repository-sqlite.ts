import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderReportingPeriods } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { runSqliteTransaction } from "@/db/types";
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

function mapSelectRow(row: typeof traderReportingPeriods.$inferSelect): ReportingPeriodRecordView {
  return mapReportingPeriodRow(row);
}

export function insertOpenReportingPeriodSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: InsertOpenReportingPeriodRepoInput,
): ReportingPeriodRecordView {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();
  const { payload } = input;

  try {
    db.insert(traderReportingPeriods)
      .values(reportingPeriodPayloadToInsertValues(id, scoped.organizationId, payload, now, now))
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ReportingPeriodAlreadyOpenError(payload.exchangeAccountId);
    }
    throw error;
  }

  const row = db
    .select()
    .from(traderReportingPeriods)
    .where(
      and(
        eq(traderReportingPeriods.id, id),
        orgScopedWhere(traderReportingPeriods.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[trader] reporting period insert failed");
  }
  return mapSelectRow(row);
}

export function findOpenReportingPeriodSqlite(
  db: WaiaDb,
  context: OrgContext,
  exchangeAccountId: string,
): ReportingPeriodRecordView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(traderReportingPeriods)
    .where(
      and(
        orgScopedWhere(traderReportingPeriods.organizationId, scoped),
        eq(traderReportingPeriods.exchangeAccountId, exchangeAccountId),
        eq(traderReportingPeriods.status, "OPEN"),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function getReportingPeriodByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  id: string,
): ReportingPeriodRecordView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(traderReportingPeriods)
    .where(
      and(
        eq(traderReportingPeriods.id, id),
        orgScopedWhere(traderReportingPeriods.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function closeReportingPeriodSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: CloseReportingPeriodRepoInput,
): ReportingPeriodRecordView {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date();
  const { id, payload } = input;

  const result = db
    .update(traderReportingPeriods)
    .set(reportingPeriodPayloadToUpdateValues(payload, now))
    .where(
      and(
        eq(traderReportingPeriods.id, id),
        orgScopedWhere(traderReportingPeriods.organizationId, scoped),
        eq(traderReportingPeriods.status, "OPEN"),
      ),
    )
    .run();

  if (result.changes === 0) {
    throw new ReportingPeriodNotOpenError(payload.exchangeAccountId);
  }

  const row = db
    .select()
    .from(traderReportingPeriods)
    .where(
      and(
        eq(traderReportingPeriods.id, id),
        orgScopedWhere(traderReportingPeriods.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[trader] reporting period close failed");
  }
  return mapSelectRow(row);
}

export function listClosedReportingPeriodsSqlite(
  db: WaiaDb,
  context: OrgContext,
  query: ListReportingPeriodsQuery = {},
): ReportingPeriodRecordView[] {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);

  const conditions = [
    orgScopedWhere(traderReportingPeriods.organizationId, scoped),
    eq(traderReportingPeriods.status, "CLOSED"),
  ];
  if (query.exchangeAccountId) {
    conditions.push(eq(traderReportingPeriods.exchangeAccountId, query.exchangeAccountId));
  }

  return db
    .select()
    .from(traderReportingPeriods)
    .where(and(...conditions))
    .orderBy(desc(traderReportingPeriods.periodEnd))
    .limit(limit)
    .all()
    .map(mapSelectRow);
}

export function insertOpenReportingPeriodSqliteTx(
  db: WaiaDb,
  context: OrgContext,
  input: InsertOpenReportingPeriodRepoInput,
): Promise<ReportingPeriodRecordView> {
  return runSqliteTransaction(db, (tx) => insertOpenReportingPeriodSqlite(tx, context, input));
}

export function closeReportingPeriodSqliteTx(
  db: WaiaDb,
  context: OrgContext,
  input: CloseReportingPeriodRepoInput,
): Promise<ReportingPeriodRecordView> {
  return runSqliteTransaction(db, (tx) => closeReportingPeriodSqlite(tx, context, input));
}
