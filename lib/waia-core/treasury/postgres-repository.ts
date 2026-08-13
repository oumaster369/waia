import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq, inArray } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";
import { TreasuryNotFoundError, TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryRepository } from "@/lib/waia-core/treasury/repository.types";
import type {
  TreasuryAttributionRecord,
  TreasuryCommitmentRecord,
  TreasuryCommitmentRevisionRecord,
  TreasuryEvidenceLinkRecord,
  TreasuryInceptionRecord,
  TreasuryObservationRecord,
  TreasuryRevisionRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update" | "delete">;

function scoped(context: OrgContext): OrgContext {
  return requireOrgContext(context.organizationId);
}

function mapTx(row: typeof pgSchema.treasuryTransactions.$inferSelect): TreasuryTransactionRecord {
  return { ...row };
}

function mapCommitment(
  row: typeof pgSchema.treasuryCommitments.$inferSelect,
): TreasuryCommitmentRecord {
  return { ...row };
}

function mapInception(
  row: typeof pgSchema.treasuryLedgerInceptions.$inferSelect,
): TreasuryInceptionRecord {
  return { ...row };
}

function mapRevision(
  row: typeof pgSchema.treasuryTransactionRevisions.$inferSelect,
): TreasuryRevisionRecord {
  return {
    ...row,
    patchJson: row.patchJson as Record<string, unknown>,
  };
}

function mapCommitmentRevision(
  row: typeof pgSchema.treasuryCommitmentRevisions.$inferSelect,
): TreasuryCommitmentRevisionRecord {
  return {
    ...row,
    patchJson: row.patchJson as Record<string, unknown>,
  };
}

function mapObservation(
  row: typeof pgSchema.treasuryChainObservations.$inferSelect,
): TreasuryObservationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    observationStatus: row.observationStatus,
    confirmationsObserved: row.confirmationsObserved,
    confirmationsRequired: row.confirmationsRequired,
  };
}

function mapEvidence(
  row: typeof pgSchema.treasuryEvidenceLinks.$inferSelect,
): TreasuryEvidenceLinkRecord {
  return row;
}

function mapAttribution(
  row: typeof pgSchema.treasuryContributionAttributions.$inferSelect,
): TreasuryAttributionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    transactionId: row.transactionId,
    status: row.status,
    contributorUserId: row.contributorUserId,
    revokedAt: row.revokedAt,
  };
}

function wp3Only(method: string): never {
  throw new TreasuryValidationError(
    "WATCHER_INGESTION_NOT_IN_WP2",
    `${method} is owned by WP-3 watcher ingestion, not WP-2 domain services`,
  );
}

export function createPostgresTreasuryRepository(ex: PgExecutor): TreasuryRepository {
  return {
    async getTransaction(context, transactionId) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryTransactions)
        .where(
          and(
            eq(pgSchema.treasuryTransactions.id, transactionId),
            orgScopedWhere(pgSchema.treasuryTransactions.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ? mapTx(rows[0]) : null;
    },

    async insertTransaction(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryTransactions).values(record);
    },

    async updateTransaction(context, transactionId, patch) {
      const org = scoped(context);
      const rows = await ex
        .update(pgSchema.treasuryTransactions)
        .set(patch)
        .where(
          and(
            eq(pgSchema.treasuryTransactions.id, transactionId),
            orgScopedWhere(pgSchema.treasuryTransactions.organizationId, org),
          ),
        )
        .returning();
      if (!rows[0]) {
        throw new TreasuryNotFoundError("transaction", transactionId);
      }
      return mapTx(rows[0]);
    },

    async listLinkedObservations(context, transactionId) {
      const org = scoped(context);
      const rows = await ex
        .select({ observation: pgSchema.treasuryChainObservations })
        .from(pgSchema.treasuryTransactionObservationLinks)
        .innerJoin(
          pgSchema.treasuryChainObservations,
          eq(
            pgSchema.treasuryTransactionObservationLinks.observationId,
            pgSchema.treasuryChainObservations.id,
          ),
        )
        .where(
          and(
            eq(pgSchema.treasuryTransactionObservationLinks.transactionId, transactionId),
            orgScopedWhere(pgSchema.treasuryTransactionObservationLinks.organizationId, org),
            orgScopedWhere(pgSchema.treasuryChainObservations.organizationId, org),
          ),
        );
      return rows.map((row) => mapObservation(row.observation));
    },

    async listEvidenceLinks(context, transactionId) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryEvidenceLinks)
        .where(
          and(
            eq(pgSchema.treasuryEvidenceLinks.transactionId, transactionId),
            orgScopedWhere(pgSchema.treasuryEvidenceLinks.organizationId, org),
          ),
        );
      return rows.map(mapEvidence);
    },

    async insertEvidenceLink(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryEvidenceLinks).values(record);
    },

    async deleteEvidenceLink(context, linkId) {
      const org = scoped(context);
      await ex
        .delete(pgSchema.treasuryEvidenceLinks)
        .where(
          and(
            eq(pgSchema.treasuryEvidenceLinks.id, linkId),
            orgScopedWhere(pgSchema.treasuryEvidenceLinks.organizationId, org),
          ),
        );
    },

    async insertObservation() {
      wp3Only("insertObservation");
    },

    async updateObservationLifecycle(context, observationId, patch) {
      const org = scoped(context);
      const rows = await ex
        .update(pgSchema.treasuryChainObservations)
        .set({
          confirmationsObserved: patch.confirmationsObserved,
          observationStatus: patch.observationStatus,
        })
        .where(
          and(
            eq(pgSchema.treasuryChainObservations.id, observationId),
            orgScopedWhere(pgSchema.treasuryChainObservations.organizationId, org),
          ),
        )
        .returning({ id: pgSchema.treasuryChainObservations.id });
      if (!rows[0]) {
        throw new TreasuryNotFoundError("observation", observationId);
      }
    },

    async insertObservationLink(input) {
      requireOrgContext(input.organizationId);
      await ex.insert(pgSchema.treasuryTransactionObservationLinks).values({
        id: input.id,
        organizationId: input.organizationId,
        transactionId: input.transactionId,
        observationId: input.observationId,
        observationRole: input.observationRole,
      });
    },

    async listRevisions(context, transactionId) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryTransactionRevisions)
        .where(
          and(
            eq(pgSchema.treasuryTransactionRevisions.transactionId, transactionId),
            orgScopedWhere(pgSchema.treasuryTransactionRevisions.organizationId, org),
          ),
        )
        .orderBy(asc(pgSchema.treasuryTransactionRevisions.seq));
      return rows.map(mapRevision);
    },

    async insertRevision(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryTransactionRevisions).values(record);
    },

    async getNextRevisionSeq(context, transactionId) {
      const existing = await this.listRevisions(context, transactionId);
      return existing.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
    },

    async getCommitment(context, commitmentId) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryCommitments)
        .where(
          and(
            eq(pgSchema.treasuryCommitments.id, commitmentId),
            orgScopedWhere(pgSchema.treasuryCommitments.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ? mapCommitment(rows[0]) : null;
    },

    async insertCommitment(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryCommitments).values(record);
    },

    async updateCommitment(context, commitmentId, patch) {
      const org = scoped(context);
      const rows = await ex
        .update(pgSchema.treasuryCommitments)
        .set(patch)
        .where(
          and(
            eq(pgSchema.treasuryCommitments.id, commitmentId),
            orgScopedWhere(pgSchema.treasuryCommitments.organizationId, org),
          ),
        )
        .returning();
      if (!rows[0]) {
        throw new TreasuryNotFoundError("commitment", commitmentId);
      }
      return mapCommitment(rows[0]);
    },

    async listCommitments(context, query) {
      const org = scoped(context);
      const filters = [orgScopedWhere(pgSchema.treasuryCommitments.organizationId, org)];
      if (query?.budgetId) {
        filters.push(eq(pgSchema.treasuryCommitments.budgetId, query.budgetId));
      }
      if (query?.statuses && query.statuses.length > 0) {
        filters.push(inArray(pgSchema.treasuryCommitments.status, query.statuses));
      }
      const rows = await ex
        .select()
        .from(pgSchema.treasuryCommitments)
        .where(and(...filters));
      return rows.map(mapCommitment);
    },

    async listCommitmentRevisions(context, commitmentId) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryCommitmentRevisions)
        .where(
          and(
            eq(pgSchema.treasuryCommitmentRevisions.commitmentId, commitmentId),
            orgScopedWhere(pgSchema.treasuryCommitmentRevisions.organizationId, org),
          ),
        )
        .orderBy(asc(pgSchema.treasuryCommitmentRevisions.seq));
      return rows.map(mapCommitmentRevision);
    },

    async insertCommitmentRevision(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryCommitmentRevisions).values(record);
    },

    async getNextCommitmentRevisionSeq(context, commitmentId) {
      const existing = await this.listCommitmentRevisions(context, commitmentId);
      return existing.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
    },

    async listInceptions(context) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryLedgerInceptions)
        .where(orgScopedWhere(pgSchema.treasuryLedgerInceptions.organizationId, org));
      return rows.map(mapInception);
    },

    async getInception(context, inceptionId) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryLedgerInceptions)
        .where(
          and(
            eq(pgSchema.treasuryLedgerInceptions.id, inceptionId),
            orgScopedWhere(pgSchema.treasuryLedgerInceptions.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ? mapInception(rows[0]) : null;
    },

    async getActiveInception(context, network, tokenContract) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryLedgerInceptions)
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryLedgerInceptions.organizationId, org),
            eq(pgSchema.treasuryLedgerInceptions.network, network),
            eq(pgSchema.treasuryLedgerInceptions.tokenContract, tokenContract),
            eq(pgSchema.treasuryLedgerInceptions.status, "ACTIVE"),
          ),
        )
        .limit(1);
      return rows[0] ? mapInception(rows[0]) : null;
    },

    async insertInception(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryLedgerInceptions).values(record);
    },

    async updateInception(context, inceptionId, patch) {
      const org = scoped(context);
      const rows = await ex
        .update(pgSchema.treasuryLedgerInceptions)
        .set(patch)
        .where(
          and(
            eq(pgSchema.treasuryLedgerInceptions.id, inceptionId),
            orgScopedWhere(pgSchema.treasuryLedgerInceptions.organizationId, org),
          ),
        )
        .returning();
      if (!rows[0]) {
        throw new TreasuryNotFoundError("inception", inceptionId);
      }
      return mapInception(rows[0]);
    },

    async listAttributions(context, transactionId) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryContributionAttributions)
        .where(
          and(
            eq(pgSchema.treasuryContributionAttributions.transactionId, transactionId),
            orgScopedWhere(pgSchema.treasuryContributionAttributions.organizationId, org),
          ),
        );
      return rows.map(mapAttribution);
    },

    async insertAttribution(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryContributionAttributions).values({
        id: record.id,
        organizationId: record.organizationId,
        transactionId: record.transactionId,
        status: record.status,
        contributorUserId: record.contributorUserId,
        attributionMethod: "WP2_DOMAIN",
        revokedAt: record.revokedAt,
      });
    },

    async listTransactions(context, query) {
      const org = scoped(context);
      const filters = [orgScopedWhere(pgSchema.treasuryTransactions.organizationId, org)];
      if (query?.status) filters.push(eq(pgSchema.treasuryTransactions.status, query.status));
      if (query?.detailPublication) {
        filters.push(eq(pgSchema.treasuryTransactions.detailPublication, query.detailPublication));
      }
      if (query?.kind) filters.push(eq(pgSchema.treasuryTransactions.kind, query.kind));
      const rows = await ex
        .select()
        .from(pgSchema.treasuryTransactions)
        .where(and(...filters));
      const sorted = rows.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      if (!query) return sorted.map(mapTx);
      const offset = Math.max(0, query.offset ?? 0);
      const limit = Math.min(100, Math.max(1, query.limit ?? 50));
      return sorted.slice(offset, offset + limit).map(mapTx);
    },

    async getTransactionByCanonicalTransfer(context, query) {
      const org = scoped(context);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryTransactions)
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryTransactions.organizationId, org),
            eq(pgSchema.treasuryTransactions.canonicalNetwork, query.network),
            eq(pgSchema.treasuryTransactions.canonicalTokenContract, query.tokenContract),
            eq(pgSchema.treasuryTransactions.canonicalTxHash, query.txHash),
            eq(pgSchema.treasuryTransactions.canonicalTransferIndex, query.transferIndex),
          ),
        )
        .limit(1);
      return rows[0] ? mapTx(rows[0]) : null;
    },
  };
}
