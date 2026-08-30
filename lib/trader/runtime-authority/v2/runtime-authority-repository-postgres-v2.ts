import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  validateRuntimeControlLeaseClaimV2,
  type RuntimeControlLeaseClaimV2,
  type RuntimeControlLeaseRepositoryV2,
} from "./runtime-authority-repository-v2";

function mapHead(row: typeof pgSchema.traderRuntimeControlLeaseHeadsV2.$inferSelect): RuntimeControlLeaseClaimV2 {
  return Object.freeze({
    organizationId: row.organizationId,
    runtimeInstanceId: row.runtimeInstanceId,
    leaseEpoch: row.leaseEpoch,
    leaseContentDigest: row.contentDigest,
    validUntilUtc: row.validUntilUtc,
    adjudicatedAtUtc: "",
    expectedPreviousDigest: null,
  });
}

export function createPostgresRuntimeControlLeaseRepositoryV2(db: WaiaPostgresDb): RuntimeControlLeaseRepositoryV2 {
  return {
    async claimExclusive(value) {
      validateRuntimeControlLeaseClaimV2(value);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${value.organizationId}, 637))`);
        const rows = await tx.select().from(pgSchema.traderRuntimeControlLeaseHeadsV2)
          .where(eq(pgSchema.traderRuntimeControlLeaseHeadsV2.organizationId, value.organizationId)).limit(1);
        const head = rows[0];
        const admissible = head
          ? Date.parse(value.adjudicatedAtUtc) > Date.parse(head.validUntilUtc) &&
            value.leaseEpoch === head.leaseEpoch + 1 && value.expectedPreviousDigest === head.contentDigest
          : value.leaseEpoch === 1 && value.expectedPreviousDigest === null;
        if (!admissible) return "CONFLICT" as const;
        await tx.insert(pgSchema.traderRuntimeControlLeaseEpochHistoryV2).values({
          contentDigest: value.leaseContentDigest,
          organizationId: value.organizationId,
          runtimeInstanceId: value.runtimeInstanceId,
          leaseEpoch: value.leaseEpoch,
          priorContentDigest: value.expectedPreviousDigest,
          validUntilUtc: value.validUntilUtc,
          adjudicatedAtUtc: value.adjudicatedAtUtc,
        });
        await tx.insert(pgSchema.traderRuntimeControlLeaseHeadsV2).values({
          organizationId: value.organizationId,
          runtimeInstanceId: value.runtimeInstanceId,
          leaseEpoch: value.leaseEpoch,
          contentDigest: value.leaseContentDigest,
          validUntilUtc: value.validUntilUtc,
        }).onConflictDoUpdate({
          target: pgSchema.traderRuntimeControlLeaseHeadsV2.organizationId,
          set: { runtimeInstanceId: value.runtimeInstanceId, leaseEpoch: value.leaseEpoch,
            contentDigest: value.leaseContentDigest, validUntilUtc: value.validUntilUtc, updatedAt: new Date() },
        });
        return "CLAIMED" as const;
      }).catch((error: unknown) => {
        if ((error as { code?: string }).code === "23505") return "CONFLICT" as const;
        throw error;
      });
    },
    async current(organizationId) {
      const rows = await db.select().from(pgSchema.traderRuntimeControlLeaseHeadsV2)
        .where(eq(pgSchema.traderRuntimeControlLeaseHeadsV2.organizationId, organizationId)).limit(1);
      return rows[0] ? mapHead(rows[0]) : null;
    },
    async assertCurrentHolder(value) {
      const rows = await db.select().from(pgSchema.traderRuntimeControlLeaseHeadsV2)
        .where(eq(pgSchema.traderRuntimeControlLeaseHeadsV2.organizationId, value.organizationId)).limit(1);
      const head = rows[0];
      const now = Date.parse(value.adjudicatedAtUtc);
      if (!head || head.runtimeInstanceId !== value.runtimeInstanceId || head.leaseEpoch !== value.leaseEpoch ||
        head.contentDigest !== value.leaseContentDigest || !Number.isFinite(now) || now > Date.parse(head.validUntilUtc)) {
        throw new Error("RUNTIME_CONTROL_LEASE_STALE_HOLDER");
      }
    },
  };
}
