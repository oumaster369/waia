import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";
import { treasuryAuditActions, treasuryEntityTypes } from "@/lib/waia-core/treasury/audit";
import type {
  BreathExclusiveStore,
  BreathFactsRepository,
  BreathLoadedFacts,
  BreathSnapshotStore,
} from "@/lib/waia-core/treasury/breath/repository.types";
import type {
  TreasuryBalanceCheckpointRecord,
  TreasuryRunwaySnapshotRecord,
} from "@/lib/waia-core/treasury/breath/types";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function scoped(context: OrgContext): OrgContext {
  return requireOrgContext(context.organizationId);
}

function mapSnapshot(
  row: typeof pgSchema.treasuryRunwaySnapshots.$inferSelect,
): TreasuryRunwaySnapshotRecord {
  return { ...row };
}

function snapshotStore(ex: PgExecutor): BreathSnapshotStore {
  return {
    async getLatestRunwaySnapshot(context, runwayPlanId) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryRunwaySnapshots)
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryRunwaySnapshots.organizationId, org),
            eq(pgSchema.treasuryRunwaySnapshots.runwayPlanId, runwayPlanId),
          ),
        )
        .orderBy(
          desc(pgSchema.treasuryRunwaySnapshots.createdAt),
          desc(pgSchema.treasuryRunwaySnapshots.id),
        )
        .limit(1);
      return rows[0] ? mapSnapshot(rows[0]) : null;
    },
    async insertRunwaySnapshot(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryRunwaySnapshots).values(record);
    },
    async insertBalanceCheckpoint(record: TreasuryBalanceCheckpointRecord) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryBalanceCheckpoints).values(record);
    },
  };
}

async function loadFactsFromExecutor(
  ex: PgExecutor,
  context: OrgContext,
): Promise<BreathLoadedFacts> {
  const org = scoped(context);
  const [
    settingsRows,
    transactions,
    commitments,
    budgets,
    fundingNeeds,
    idealBudgets,
    runwayPlans,
    reconciliations,
    inceptions,
    balanceCheckpoints,
  ] = await Promise.all([
    ex
      .select()
      .from(pgSchema.treasuryPublicationSettings)
      .where(orgScopedWhere(pgSchema.treasuryPublicationSettings.organizationId, org)),
    ex
      .select()
      .from(pgSchema.treasuryTransactions)
      .where(orgScopedWhere(pgSchema.treasuryTransactions.organizationId, org)),
    ex
      .select()
      .from(pgSchema.treasuryCommitments)
      .where(orgScopedWhere(pgSchema.treasuryCommitments.organizationId, org)),
    ex
      .select()
      .from(pgSchema.treasuryBudgets)
      .where(orgScopedWhere(pgSchema.treasuryBudgets.organizationId, org)),
    ex
      .select()
      .from(pgSchema.treasuryFundingNeeds)
      .where(orgScopedWhere(pgSchema.treasuryFundingNeeds.organizationId, org)),
    ex
      .select()
      .from(pgSchema.treasuryIdealAnnualBudgets)
      .where(orgScopedWhere(pgSchema.treasuryIdealAnnualBudgets.organizationId, org)),
    ex
      .select()
      .from(pgSchema.treasuryRunwayPlans)
      .where(orgScopedWhere(pgSchema.treasuryRunwayPlans.organizationId, org)),
    ex
      .select()
      .from(pgSchema.treasuryBalanceReconciliations)
      .where(orgScopedWhere(pgSchema.treasuryBalanceReconciliations.organizationId, org)),
    ex
      .select()
      .from(pgSchema.treasuryLedgerInceptions)
      .where(orgScopedWhere(pgSchema.treasuryLedgerInceptions.organizationId, org)),
    ex
      .select()
      .from(pgSchema.treasuryBalanceCheckpoints)
      .where(orgScopedWhere(pgSchema.treasuryBalanceCheckpoints.organizationId, org)),
  ]);
  return {
    settings: settingsRows[0] ?? null,
    transactions,
    commitments,
    budgets,
    fundingNeeds,
    idealBudgets,
    runwayPlans,
    reconciliations,
    inceptions,
    balanceCheckpoints: balanceCheckpoints.map((row) => ({
      ...row,
      sourceLabel: "HUMAN_CONFIRMED" as const,
    })),
  };
}

function exclusiveStore(ex: PgExecutor): BreathExclusiveStore {
  return {
    ...snapshotStore(ex),
    loadFacts(context) {
      return loadFactsFromExecutor(ex, context);
    },
  };
}

/**
 * Postgres Breath facts. Every financial query is org-scoped and unpaginated.
 * Do not add LIMIT/OFFSET to transaction, commitment, budget, or recon loads.
 */
export function createPostgresTreasuryBreathFactsRepository(
  db: WaiaPostgresDb,
): BreathFactsRepository {
  const rootStore = snapshotStore(db);

  return {
    async loadFacts(context): Promise<BreathLoadedFacts> {
      return loadFactsFromExecutor(db, context);
    },
    getLatestRunwaySnapshot: rootStore.getLatestRunwaySnapshot,
    insertRunwaySnapshot: rootStore.insertRunwaySnapshot,
    insertBalanceCheckpoint: rootStore.insertBalanceCheckpoint,
    async listIdealBudgetAuditTimes(context, idealId) {
      const org = scoped(context);
      const rows = await db
        .select({ createdAt: pgSchema.auditLogs.createdAt })
        .from(pgSchema.auditLogs)
        .where(
          and(
            eq(pgSchema.auditLogs.organizationId, org.organizationId),
            eq(pgSchema.auditLogs.entityType, treasuryEntityTypes.idealBudget),
            eq(pgSchema.auditLogs.entityId, idealId),
            inArray(pgSchema.auditLogs.action, [
              treasuryAuditActions.idealBudgetCreate,
              treasuryAuditActions.idealBudgetPublish,
            ]),
          ),
        );
      return rows.map((row) => row.createdAt);
    },
    async runExclusive(organizationId, fn) {
      const org = requireOrgContext(organizationId);
      return runWaiaPostgresTransaction(db, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${org.organizationId}))`);
        return fn(exclusiveStore(tx));
      });
    },
  };
}
