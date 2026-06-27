import "server-only";

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { HwmLedgerAlreadyBootstrappedError } from "@/lib/trader/billing/hwm-ledger.errors";
import type {
  InsertHwmLedgerEntryRepoInput,
  ListHwmLedgerQuery,
} from "@/lib/trader/billing/hwm-ledger-repository.types";
import {
  DEFAULT_HWM_LEDGER_LIST_LIMIT,
  MAX_HWM_LEDGER_LIST_LIMIT,
} from "@/lib/trader/billing/hwm-ledger-repository.types";
import {
  hwmLedgerPayloadToInsertValues,
  mapHwmLedgerRow,
} from "@/lib/trader/billing/hwm-ledger-row-mapper";
import type { HwmLedgerRecordView } from "@/lib/trader/billing/hwm-ledger.types";
import { isUniqueConstraintError } from "@/lib/trader/execution/order-repository.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_HWM_LEDGER_LIST_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (normalized <= 0) {
    return DEFAULT_HWM_LEDGER_LIST_LIMIT;
  }
  return Math.min(normalized, MAX_HWM_LEDGER_LIST_LIMIT);
}

function mapSelectRow(row: typeof pgSchema.traderHwmLedger.$inferSelect): HwmLedgerRecordView {
  return mapHwmLedgerRow(row);
}

function isPgUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "23505";
  }
  return isUniqueConstraintError(error);
}

export async function insertHwmLedgerEntryPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: InsertHwmLedgerEntryRepoInput,
): Promise<HwmLedgerRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();
  const { payload } = input;

  try {
    await ex
      .insert(pgSchema.traderHwmLedger)
      .values(hwmLedgerPayloadToInsertValues(id, scoped.organizationId, payload, now, now));
  } catch (error) {
    if (isPgUniqueViolation(error) && payload.entryType === "BOOTSTRAP") {
      throw new HwmLedgerAlreadyBootstrappedError(payload.exchangeAccountId);
    }
    throw error;
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderHwmLedger)
    .where(
      and(
        eq(pgSchema.traderHwmLedger.id, id),
        orgScopedWhere(pgSchema.traderHwmLedger.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] HWM ledger insert failed");
  }
  return mapSelectRow(rows[0]);
}

export async function getCurrentHwmLedgerEntryPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  exchangeAccountId: string,
): Promise<HwmLedgerRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.traderHwmLedger)
    .where(
      and(
        orgScopedWhere(pgSchema.traderHwmLedger.organizationId, scoped),
        eq(pgSchema.traderHwmLedger.exchangeAccountId, exchangeAccountId),
      ),
    )
    .orderBy(
      desc(pgSchema.traderHwmLedger.effectiveAt),
      desc(pgSchema.traderHwmLedger.createdAt),
      desc(pgSchema.traderHwmLedger.id),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function findBootstrapHwmLedgerEntryPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  exchangeAccountId: string,
): Promise<HwmLedgerRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.traderHwmLedger)
    .where(
      and(
        orgScopedWhere(pgSchema.traderHwmLedger.organizationId, scoped),
        eq(pgSchema.traderHwmLedger.exchangeAccountId, exchangeAccountId),
        eq(pgSchema.traderHwmLedger.entryType, "BOOTSTRAP"),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function getHwmLedgerEntryByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  id: string,
): Promise<HwmLedgerRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.traderHwmLedger)
    .where(
      and(
        eq(pgSchema.traderHwmLedger.id, id),
        orgScopedWhere(pgSchema.traderHwmLedger.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function listHwmLedgerEntriesPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  query: ListHwmLedgerQuery = {},
): Promise<HwmLedgerRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);

  const conditions = [orgScopedWhere(pgSchema.traderHwmLedger.organizationId, scoped)];
  if (query.exchangeAccountId) {
    conditions.push(eq(pgSchema.traderHwmLedger.exchangeAccountId, query.exchangeAccountId));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderHwmLedger)
    .where(and(...conditions))
    .orderBy(
      desc(pgSchema.traderHwmLedger.effectiveAt),
      desc(pgSchema.traderHwmLedger.createdAt),
      desc(pgSchema.traderHwmLedger.id),
    )
    .limit(limit);

  return rows.map(mapSelectRow);
}

export async function insertHwmLedgerEntryPostgresTx(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: InsertHwmLedgerEntryRepoInput,
): Promise<HwmLedgerRecordView> {
  return runWaiaPostgresTransaction(db, (tx) => insertHwmLedgerEntryPostgres(tx, context, input));
}
