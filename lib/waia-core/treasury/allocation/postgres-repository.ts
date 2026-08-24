import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type {
  FundAllocationRepository,
  FundAllocationStore,
} from "@/lib/waia-core/treasury/allocation/repository.types";
import {
  TREASURY_FUND_ALLOCATION_POLICY_CODE,
  TREASURY_FUND_ALLOCATION_POLICY_VERSION,
  type FundAllocationEvidenceRecord,
} from "@/lib/waia-core/treasury/allocation/types";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;
const FUND_ALLOCATION_SERIALIZATION_ATTEMPTS = 16;

function isSerializationFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "40001";
}

function mapEvidence(
  row: typeof pgSchema.treasuryFundAllocationEvidence.$inferSelect,
): FundAllocationEvidenceRecord {
  if (
    row.policyCode !== TREASURY_FUND_ALLOCATION_POLICY_CODE ||
    row.policyVersion !== TREASURY_FUND_ALLOCATION_POLICY_VERSION
  ) {
    throw new TreasuryValidationError(
      "FUND_ALLOCATION_POLICY_IDENTITY_INVALID",
      "persisted allocation evidence has an unsupported policy identity",
    );
  }
  return {
    ...row,
    policyCode: TREASURY_FUND_ALLOCATION_POLICY_CODE,
    policyVersion: TREASURY_FUND_ALLOCATION_POLICY_VERSION,
  };
}

function allocationStore(ex: PgExecutor): FundAllocationStore {
  return {
    async loadFacts(context) {
      const org = requireOrgContext(context.organizationId);
      const [transactions, commitments, idealBudgets, reconciliations, inceptions] =
        await Promise.all([
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
            .from(pgSchema.treasuryIdealAnnualBudgets)
            .where(orgScopedWhere(pgSchema.treasuryIdealAnnualBudgets.organizationId, org)),
          ex
            .select()
            .from(pgSchema.treasuryBalanceReconciliations)
            .where(orgScopedWhere(pgSchema.treasuryBalanceReconciliations.organizationId, org)),
          ex
            .select()
            .from(pgSchema.treasuryLedgerInceptions)
            .where(orgScopedWhere(pgSchema.treasuryLedgerInceptions.organizationId, org)),
        ]);
      return { transactions, commitments, idealBudgets, reconciliations, inceptions };
    },
    async getEvidenceByInputDigest(context, inputDigest) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryFundAllocationEvidence)
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryFundAllocationEvidence.organizationId, org),
            eq(pgSchema.treasuryFundAllocationEvidence.inputDigest, inputDigest),
          ),
        )
        .limit(1);
      return rows[0] ? mapEvidence(rows[0]) : null;
    },
    async getLatestEvidence(context) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryFundAllocationEvidence)
        .where(orgScopedWhere(pgSchema.treasuryFundAllocationEvidence.organizationId, org))
        .orderBy(
          desc(pgSchema.treasuryFundAllocationEvidence.createdAt),
          desc(pgSchema.treasuryFundAllocationEvidence.id),
        )
        .limit(1);
      return rows[0] ? mapEvidence(rows[0]) : null;
    },
    async insertEvidence(record) {
      requireOrgContext(record.organizationId);
      const inserted = await ex
        .insert(pgSchema.treasuryFundAllocationEvidence)
        .values(record)
        .onConflictDoNothing({
          target: [
            pgSchema.treasuryFundAllocationEvidence.organizationId,
            pgSchema.treasuryFundAllocationEvidence.inputDigest,
          ],
        })
        .returning();
      if (inserted[0]) return mapEvidence(inserted[0]);
      const existing = await this.getEvidenceByInputDigest(
        { organizationId: record.organizationId },
        record.inputDigest,
      );
      if (!existing) {
        throw new TreasuryValidationError(
          "FUND_ALLOCATION_IDEMPOTENCY_CONFLICT",
          "allocation evidence conflict did not resolve to an existing row",
        );
      }
      return existing;
    },
  };
}

export function createPostgresTreasuryFundAllocationRepository(
  db: WaiaPostgresDb,
): FundAllocationRepository {
  const root = allocationStore(db);
  return {
    ...root,
    async runExclusive(organizationId, fn) {
      const org = requireOrgContext(organizationId);
      for (let attempt = 1; attempt <= FUND_ALLOCATION_SERIALIZATION_ATTEMPTS; attempt += 1) {
        try {
          return await runWaiaPostgresTransaction(db, async (tx) => {
            await tx.execute(sql`set transaction isolation level repeatable read`);
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`treasury-fund-allocation:${org.organizationId}`}))`,
            );
            return fn(allocationStore(tx));
          });
        } catch (error) {
          if (
            !isSerializationFailure(error) ||
            attempt === FUND_ALLOCATION_SERIALIZATION_ATTEMPTS
          ) {
            throw error;
          }
        }
      }
      throw new TreasuryValidationError(
        "FUND_ALLOCATION_SERIALIZATION_RETRY_EXHAUSTED",
        "allocation evidence transaction retry budget was exhausted",
      );
    },
  };
}
