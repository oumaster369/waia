import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createPostgresReconciliationEvidenceReader } from "@/lib/trader/settlement/reconciliation/reconciliation-evidence-postgres";
import { extractCaseOpenedEvidence } from "@/lib/trader/settlement/reconciliation/fold-reconciliation-events";
import { ReconciliationCaseNotFoundError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import { listReconciliationEventsForCasePostgres } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository-postgres";
import type { ReconciliationReader } from "@/lib/trader/settlement/reconciliation/reconciliation-reader.types";
import type {
  ReconciliationCaseListItem,
  ReconciliationCaseListQuery,
  ReconciliationCaseView,
  ReconciliationHealthMetrics,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { verifySettlementRecordDigest } from "@/lib/trader/settlement/serialize-settlement";
import type { SettlementRecordView } from "@/lib/trader/settlement/settlement.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgExecutor = { select: WaiaPostgresDb["select"] };

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const STALE_OPEN_HOURS = 24;

type ListCursor = {
  priority: number;
  openedAt: string;
  id: string;
};

function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): ListCursor | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ListCursor;
    if (
      typeof parsed.priority !== "number" ||
      typeof parsed.openedAt !== "string" ||
      typeof parsed.id !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function mapSettlementRow(
  row: typeof pgSchema.traderSettlements.$inferSelect,
): SettlementRecordView {
  const view: SettlementRecordView = {
    id: row.id,
    schemaVersion: row.schemaVersion as SettlementRecordView["schemaVersion"],
    organizationId: row.organizationId,
    exchangeAccountId: row.exchangeAccountId,
    paymentId: row.paymentId,
    settlementNetwork: row.settlementNetwork,
    settlementTxHash: row.settlementTxHash,
    transferIndex: row.transferIndex,
    blockHeight: row.blockHeight,
    asset: row.asset,
    onChainAmount: row.onChainAmount,
    valuedAmount: row.valuedAmount,
    valuationCurrency: row.valuationCurrency,
    valuationBasis: row.valuationBasis,
    outcome: row.outcome,
    exceptionReason: row.exceptionReason,
    prevEventDigest: row.prevEventDigest,
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
  };
  verifySettlementRecordDigest(view);
  return view;
}

function mapCaseRow(
  row: typeof pgSchema.traderSettlementReconciliationCases.$inferSelect,
  settlementTxHash: string | null,
  valuedAmount: string | null,
): ReconciliationCaseListItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    settlementId: row.settlementId,
    paymentId: row.paymentId,
    exchangeAccountId: row.exchangeAccountId,
    exceptionReason: row.exceptionReason,
    status: row.status,
    priority: row.priority,
    resolutionType: row.resolutionType as ReconciliationCaseView["resolutionType"],
    currentDecisionId: row.currentDecisionId ?? null,
    assignedTo: row.assignedTo,
    claimExpiresAt: row.claimExpiresAt,
    coolingOffUntil: row.coolingOffUntil,
    openedAt: row.openedAt,
    resolvedAt: row.resolvedAt,
    lastEventSeq: row.lastEventSeq,
    lastEventDigest: row.lastEventDigest,
    settlementTxHash,
    valuedAmount,
  };
}

function mapCaseView(
  row: typeof pgSchema.traderSettlementReconciliationCases.$inferSelect,
): ReconciliationCaseView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    settlementId: row.settlementId,
    paymentId: row.paymentId,
    exchangeAccountId: row.exchangeAccountId,
    exceptionReason: row.exceptionReason,
    status: row.status,
    priority: row.priority,
    resolutionType: row.resolutionType as ReconciliationCaseView["resolutionType"],
    currentDecisionId: row.currentDecisionId ?? null,
    assignedTo: row.assignedTo,
    claimExpiresAt: row.claimExpiresAt,
    coolingOffUntil: row.coolingOffUntil,
    openedAt: row.openedAt,
    resolvedAt: row.resolvedAt,
    lastEventSeq: row.lastEventSeq,
    lastEventDigest: row.lastEventDigest,
  };
}

export function createPostgresReconciliationReader(ex: PgExecutor): ReconciliationReader {
  const evidenceReader = createPostgresReconciliationEvidenceReader(ex);

  return {
    async listCases(context, query) {
      const scoped = requireOrgContext(context.organizationId);
      const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const cursor = decodeCursor(query.cursor);
      const filters = [
        orgScopedWhere(pgSchema.traderSettlementReconciliationCases.organizationId, scoped),
      ];
      if (query.status) {
        filters.push(eq(pgSchema.traderSettlementReconciliationCases.status, query.status));
      }
      if (query.exceptionReason) {
        filters.push(
          eq(pgSchema.traderSettlementReconciliationCases.exceptionReason, query.exceptionReason),
        );
      }
      if (cursor) {
        const openedAt = new Date(cursor.openedAt);
        filters.push(
          or(
            lt(pgSchema.traderSettlementReconciliationCases.priority, cursor.priority),
            and(
              eq(pgSchema.traderSettlementReconciliationCases.priority, cursor.priority),
              lt(pgSchema.traderSettlementReconciliationCases.openedAt, openedAt),
            ),
            and(
              eq(pgSchema.traderSettlementReconciliationCases.priority, cursor.priority),
              eq(pgSchema.traderSettlementReconciliationCases.openedAt, openedAt),
              lt(pgSchema.traderSettlementReconciliationCases.id, cursor.id),
            ),
          )!,
        );
      }

      const rows = await ex
        .select({
          case: pgSchema.traderSettlementReconciliationCases,
          settlementTxHash: pgSchema.traderSettlements.settlementTxHash,
          valuedAmount: pgSchema.traderSettlements.valuedAmount,
        })
        .from(pgSchema.traderSettlementReconciliationCases)
        .innerJoin(
          pgSchema.traderSettlements,
          eq(
            pgSchema.traderSettlementReconciliationCases.settlementId,
            pgSchema.traderSettlements.id,
          ),
        )
        .where(and(...filters))
        .orderBy(
          desc(pgSchema.traderSettlementReconciliationCases.priority),
          desc(pgSchema.traderSettlementReconciliationCases.openedAt),
          desc(pgSchema.traderSettlementReconciliationCases.id),
        )
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const items = page.map((row) => mapCaseRow(row.case, row.settlementTxHash, row.valuedAmount));
      let nextCursor: string | null = null;
      if (rows.length > limit) {
        const last = page.at(-1)!;
        nextCursor = encodeCursor({
          priority: last.case.priority,
          openedAt: last.case.openedAt.toISOString(),
          id: last.case.id,
        });
      }
      return { items, nextCursor };
    },

    async getCaseDetail(context, caseId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderSettlementReconciliationCases)
        .where(
          and(
            orgScopedWhere(pgSchema.traderSettlementReconciliationCases.organizationId, scoped),
            eq(pgSchema.traderSettlementReconciliationCases.id, caseId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }

      const settlementRows = await ex
        .select()
        .from(pgSchema.traderSettlements)
        .where(eq(pgSchema.traderSettlements.id, row.settlementId))
        .limit(1);
      const settlement = settlementRows[0];
      if (!settlement) {
        throw new ReconciliationCaseNotFoundError(caseId);
      }

      const events = await listReconciliationEventsForCasePostgres(ex, scoped, caseId);
      const evidence =
        extractCaseOpenedEvidence(events) ??
        (await evidenceReader.buildEvidence(scoped, mapSettlementRow(settlement)));

      return {
        case: mapCaseView(row),
        events,
        evidence,
      };
    },

    async listExceptionSettlementsWithoutCase(context) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select({ settlement: pgSchema.traderSettlements })
        .from(pgSchema.traderSettlements)
        .leftJoin(
          pgSchema.traderSettlementReconciliationCases,
          eq(
            pgSchema.traderSettlementReconciliationCases.settlementId,
            pgSchema.traderSettlements.id,
          ),
        )
        .where(
          and(
            orgScopedWhere(pgSchema.traderSettlements.organizationId, scoped),
            eq(pgSchema.traderSettlements.outcome, "EXCEPTION"),
            isNull(pgSchema.traderSettlementReconciliationCases.id),
          ),
        );
      return rows.map((row) => mapSettlementRow(row.settlement));
    },

    async getHealthMetrics() {
      const staleBefore = new Date(Date.now() - STALE_OPEN_HOURS * 60 * 60 * 1000);

      const [openRows, staleRows, orphanRows, ageRows] = await Promise.all([
        ex
          .select({ count: sql<number>`count(*)::int` })
          .from(pgSchema.traderSettlementReconciliationCases)
          .where(eq(pgSchema.traderSettlementReconciliationCases.status, "OPEN")),
        ex
          .select({ count: sql<number>`count(*)::int` })
          .from(pgSchema.traderSettlementReconciliationCases)
          .where(
            and(
              eq(pgSchema.traderSettlementReconciliationCases.status, "OPEN"),
              lt(pgSchema.traderSettlementReconciliationCases.openedAt, staleBefore),
            ),
          ),
        ex
          .select({ count: sql<number>`count(*)::int` })
          .from(pgSchema.traderSettlements)
          .leftJoin(
            pgSchema.traderSettlementReconciliationCases,
            eq(
              pgSchema.traderSettlementReconciliationCases.settlementId,
              pgSchema.traderSettlements.id,
            ),
          )
          .where(
            and(
              eq(pgSchema.traderSettlements.outcome, "EXCEPTION"),
              isNull(pgSchema.traderSettlementReconciliationCases.id),
            ),
          ),
        ex
          .select({
            ageSeconds: sql<number>`extract(epoch from (now() - ${pgSchema.traderSettlementReconciliationCases.openedAt}))`,
          })
          .from(pgSchema.traderSettlementReconciliationCases)
          .where(eq(pgSchema.traderSettlementReconciliationCases.status, "OPEN"))
          .orderBy(
            sql`extract(epoch from (now() - ${pgSchema.traderSettlementReconciliationCases.openedAt})) DESC`,
          )
          .limit(20),
      ]);

      const ages = ageRows
        .map((row) => row.ageSeconds)
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
      const p95Index = ages.length > 0 ? Math.ceil(ages.length * 0.95) - 1 : -1;

      return {
        openCount: openRows[0]?.count ?? 0,
        staleCount: staleRows[0]?.count ?? 0,
        orphanExceptionCount: orphanRows[0]?.count ?? 0,
        openAgeP95Seconds: p95Index >= 0 ? ages[p95Index]! : null,
      } satisfies ReconciliationHealthMetrics;
    },
  };
}
