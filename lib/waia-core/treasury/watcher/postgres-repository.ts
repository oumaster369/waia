import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, isNull, lt, or } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { TreasuryNotFoundError } from "@/lib/waia-core/treasury/errors";
import { matchContributionPaymentIntent } from "@/lib/waia-core/treasury/contributions/payment-intents";
import type { TreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/repository.types";
import type { TreasuryChainObservationRecord } from "@/lib/waia-core/treasury/watcher/types";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapObservation(
  row: typeof pgSchema.treasuryChainObservations.$inferSelect,
): TreasuryChainObservationRecord {
  return {
    ...row,
    direction: row.direction as TreasuryChainObservationRecord["direction"],
  };
}

export function createPostgresTreasuryWatcherRepository(ex: PgExecutor): TreasuryWatcherRepository {
  return {
    async listActiveWatchedAddresses(context, network, tokenContract) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryWatchedAddresses)
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryWatchedAddresses.organizationId, org),
            eq(pgSchema.treasuryWatchedAddresses.network, network),
            eq(pgSchema.treasuryWatchedAddresses.tokenContract, tokenContract),
            eq(pgSchema.treasuryWatchedAddresses.isActive, true),
          ),
        );
      return rows;
    },

    async insertWatchedAddress(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryWatchedAddresses).values(record);
    },

    async getObservationByIdempotency(context, idempotencyKey) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryChainObservations)
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryChainObservations.organizationId, org),
            eq(pgSchema.treasuryChainObservations.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return rows[0] ? mapObservation(rows[0]) : null;
    },

    async getObservationById(context, observationId) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryChainObservations)
        .where(
          and(
            eq(pgSchema.treasuryChainObservations.id, observationId),
            orgScopedWhere(pgSchema.treasuryChainObservations.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ? mapObservation(rows[0]) : null;
    },

    async insertChainObservation(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryChainObservations).values(record);
    },

    async updateObservationLifecycle(context, observationId, patch) {
      const org = requireOrgContext(context.organizationId);
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
        .returning();
      if (!rows[0]) throw new TreasuryNotFoundError("observation", observationId);
      return mapObservation(rows[0]);
    },

    async listObservationsForOrg(context) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryChainObservations)
        .where(orgScopedWhere(pgSchema.treasuryChainObservations.organizationId, org));
      return rows.map(mapObservation);
    },

    async listLinkedFullObservations(context, transactionId) {
      const org = requireOrgContext(context.organizationId);
      const linkRows = await ex
        .select()
        .from(pgSchema.treasuryTransactionObservationLinks)
        .where(
          and(
            eq(pgSchema.treasuryTransactionObservationLinks.transactionId, transactionId),
            orgScopedWhere(pgSchema.treasuryTransactionObservationLinks.organizationId, org),
          ),
        );
      const out: TreasuryChainObservationRecord[] = [];
      for (const link of linkRows) {
        const row = await this.getObservationById(org, link.observationId);
        if (row) out.push(row);
      }
      return out;
    },

    async insertObservationLink(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryTransactionObservationLinks).values(record);
    },

    async getLinkForObservation(context, observationId) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryTransactionObservationLinks)
        .where(
          and(
            eq(pgSchema.treasuryTransactionObservationLinks.observationId, observationId),
            orgScopedWhere(pgSchema.treasuryTransactionObservationLinks.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0]
        ? {
            ...rows[0],
            observationRole: rows[0].observationRole as
              | "PRIMARY"
              | "INTERNAL_COUNTERPARTY"
              | "SECONDARY",
          }
        : null;
    },

    async listLinksForTransaction(context, transactionId) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryTransactionObservationLinks)
        .where(
          and(
            eq(pgSchema.treasuryTransactionObservationLinks.transactionId, transactionId),
            orgScopedWhere(pgSchema.treasuryTransactionObservationLinks.organizationId, org),
          ),
        );
      return rows.map((row) => ({
        ...row,
        observationRole: row.observationRole as "PRIMARY" | "INTERNAL_COUNTERPARTY" | "SECONDARY",
      }));
    },

    async matchContributionIntent(context, input) {
      const org = requireOrgContext(context.organizationId);
      return matchContributionPaymentIntent({
        db: ex,
        organizationId: org.organizationId,
        ...input,
      });
    },

    async ensureAnonymousContributionAttribution(context, input) {
      const org = requireOrgContext(context.organizationId);
      await ex
        .insert(pgSchema.treasuryContributionAttributions)
        .values({
          id: input.newId(),
          organizationId: org.organizationId,
          transactionId: input.transactionId,
          status: "ANONYMOUS",
          contributorUserId: null,
          attributionMethod: "WALLET_DIRECT_ANONYMOUS",
          consentPublicIdentity: false,
          note: "Direct wallet support without a named payment intent.",
          attributedByUserId: null,
          attributedAt: input.now,
          revokedAt: null,
          createdAt: input.now,
        })
        .onConflictDoNothing();
    },

    async getCheckpoint(context, checkpointKey) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryWatcherCheckpoints)
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryWatcherCheckpoints.organizationId, org),
            eq(pgSchema.treasuryWatcherCheckpoints.checkpointKey, checkpointKey),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async insertCheckpoint(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryWatcherCheckpoints).values(record);
    },

    async tryAcquireLease(context, checkpointKey, leaseTtlSeconds, now) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .update(pgSchema.treasuryWatcherCheckpoints)
        .set({
          leaseUntil: new Date(now.getTime() + leaseTtlSeconds * 1000),
          updatedAt: now,
        })
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryWatcherCheckpoints.organizationId, org),
            eq(pgSchema.treasuryWatcherCheckpoints.checkpointKey, checkpointKey),
            or(
              isNull(pgSchema.treasuryWatcherCheckpoints.leaseUntil),
              lt(pgSchema.treasuryWatcherCheckpoints.leaseUntil, now),
            ),
          ),
        )
        .returning({ checkpointKey: pgSchema.treasuryWatcherCheckpoints.checkpointKey });
      return rows.length > 0;
    },

    async releaseLease(context, checkpointKey, now) {
      const org = requireOrgContext(context.organizationId);
      await ex
        .update(pgSchema.treasuryWatcherCheckpoints)
        .set({ leaseUntil: null, updatedAt: now })
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryWatcherCheckpoints.organizationId, org),
            eq(pgSchema.treasuryWatcherCheckpoints.checkpointKey, checkpointKey),
          ),
        );
    },

    async advanceCursor(context, checkpointKey, lastScannedBlock, now) {
      const org = requireOrgContext(context.organizationId);
      const existing = await this.getCheckpoint(org, checkpointKey);
      if (!existing) throw new TreasuryNotFoundError("checkpoint", checkpointKey);
      await ex
        .update(pgSchema.treasuryWatcherCheckpoints)
        .set({
          lastScannedBlock,
          lastScannedAt: now,
          lastError: null,
          lastErrorAt: null,
          cycleCount: existing.cycleCount + 1,
          updatedAt: now,
        })
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryWatcherCheckpoints.organizationId, org),
            eq(pgSchema.treasuryWatcherCheckpoints.checkpointKey, checkpointKey),
          ),
        );
    },

    async recordError(context, checkpointKey, message, now) {
      const org = requireOrgContext(context.organizationId);
      await ex
        .update(pgSchema.treasuryWatcherCheckpoints)
        .set({ lastError: message, lastErrorAt: now, updatedAt: now })
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryWatcherCheckpoints.organizationId, org),
            eq(pgSchema.treasuryWatcherCheckpoints.checkpointKey, checkpointKey),
          ),
        );
    },

    async getTransactionByCanonicalTransfer(context, query) {
      const org = requireOrgContext(context.organizationId);
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
      return rows[0] ?? null;
    },

    async listOrgTransactions(context) {
      const org = requireOrgContext(context.organizationId);
      return ex
        .select()
        .from(pgSchema.treasuryTransactions)
        .where(orgScopedWhere(pgSchema.treasuryTransactions.organizationId, org));
    },

    async insertBalanceReconciliation(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryBalanceReconciliations).values(record);
    },

    async listBalanceReconciliations(context) {
      const org = requireOrgContext(context.organizationId);
      return ex
        .select()
        .from(pgSchema.treasuryBalanceReconciliations)
        .where(orgScopedWhere(pgSchema.treasuryBalanceReconciliations.organizationId, org));
    },
  };
}
