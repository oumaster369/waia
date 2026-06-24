import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderHwmLedger } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { runSqliteTransaction } from "@/db/types";
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

function mapSelectRow(row: typeof traderHwmLedger.$inferSelect): HwmLedgerRecordView {
  return mapHwmLedgerRow(row);
}

export function insertHwmLedgerEntrySqlite(
  db: WaiaDb,
  context: OrgContext,
  input: InsertHwmLedgerEntryRepoInput,
): HwmLedgerRecordView {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();
  const { payload } = input;

  try {
    db.insert(traderHwmLedger)
      .values(hwmLedgerPayloadToInsertValues(id, scoped.organizationId, payload, now, now))
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error) && payload.entryType === "BOOTSTRAP") {
      throw new HwmLedgerAlreadyBootstrappedError(payload.exchangeAccountId);
    }
    throw error;
  }

  const row = db
    .select()
    .from(traderHwmLedger)
    .where(and(eq(traderHwmLedger.id, id), orgScopedWhere(traderHwmLedger.organizationId, scoped)))
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[trader] HWM ledger insert failed");
  }
  return mapSelectRow(row);
}

export function getCurrentHwmLedgerEntrySqlite(
  db: WaiaDb,
  context: OrgContext,
  exchangeAccountId: string,
): HwmLedgerRecordView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(traderHwmLedger)
    .where(
      and(
        orgScopedWhere(traderHwmLedger.organizationId, scoped),
        eq(traderHwmLedger.exchangeAccountId, exchangeAccountId),
      ),
    )
    .orderBy(
      desc(traderHwmLedger.effectiveAt),
      desc(traderHwmLedger.createdAt),
      desc(traderHwmLedger.id),
    )
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function findBootstrapHwmLedgerEntrySqlite(
  db: WaiaDb,
  context: OrgContext,
  exchangeAccountId: string,
): HwmLedgerRecordView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(traderHwmLedger)
    .where(
      and(
        orgScopedWhere(traderHwmLedger.organizationId, scoped),
        eq(traderHwmLedger.exchangeAccountId, exchangeAccountId),
        eq(traderHwmLedger.entryType, "BOOTSTRAP"),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function getHwmLedgerEntryByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  id: string,
): HwmLedgerRecordView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(traderHwmLedger)
    .where(and(eq(traderHwmLedger.id, id), orgScopedWhere(traderHwmLedger.organizationId, scoped)))
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function listHwmLedgerEntriesSqlite(
  db: WaiaDb,
  context: OrgContext,
  query: ListHwmLedgerQuery = {},
): HwmLedgerRecordView[] {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);

  const conditions = [orgScopedWhere(traderHwmLedger.organizationId, scoped)];
  if (query.exchangeAccountId) {
    conditions.push(eq(traderHwmLedger.exchangeAccountId, query.exchangeAccountId));
  }

  return db
    .select()
    .from(traderHwmLedger)
    .where(and(...conditions))
    .orderBy(
      desc(traderHwmLedger.effectiveAt),
      desc(traderHwmLedger.createdAt),
      desc(traderHwmLedger.id),
    )
    .limit(limit)
    .all()
    .map(mapSelectRow);
}

export function insertHwmLedgerEntrySqliteTx(
  db: WaiaDb,
  context: OrgContext,
  input: InsertHwmLedgerEntryRepoInput,
): Promise<HwmLedgerRecordView> {
  return runSqliteTransaction(db, (tx) => insertHwmLedgerEntrySqlite(tx, context, input));
}
