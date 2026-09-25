import { randomUUID } from "node:crypto";
import {
  traderAdminAccountValuation,
  traderAdminEquityPoint,
} from "@/db/schema.admin-console.postgres";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { readOverviewSnapshot } from "@/lib/trader/admin-console/repositories/overview.postgres";
import type { AdminScope } from "@/lib/trader/admin-console/contracts";

/** Collector-only immutable projections. A missing value is never written as zero. */
export async function collectAccountValuations(
  db: AdminPostgresDb,
  now: Date,
  scope?: AdminScope,
): Promise<{ processed: number; blocked: number }> {
  const snapshot = await readOverviewSnapshot(db, {
    currency: "USDT",
    mode: "live",
    start: now.toISOString(),
    end: now.toISOString(),
    nowMs: now.getTime(),
    includePeriod: false,
    scope,
    // Rotate the bounded collector slice; accounts beyond 64 must not starve.
    valuationOffset: Math.floor(now.getTime() / 60_000) * 64,
  });
  const bucket = new Date(Math.floor(now.getTime() / 300_000) * 300_000);
  return db.transaction(async (tx) => {
    let processed = 0;
    let blocked = 0;
    for (const account of snapshot.value.accounts) {
      const evidence = account.valuationEvidence;
      if (
        !evidence ||
        !account.organizationId ||
        !account.included ||
        !account.nativeValuation ||
        account.equity === null ||
        account.freeQuote === null ||
        account.lockedQuote === null ||
        account.holdingsValue === null ||
        account.traderLotsValue === null ||
        account.traderCostBasis === null ||
        account.traderUnrealized === null
      ) {
        blocked += 1;
        continue;
      }
      const version = await tx
        .insert(traderAdminAccountValuation)
        .values({
          id: randomUUID(),
          organizationId: account.organizationId,
          exchangeAccountId: account.exchangeAccountId,
          valuationKey: account.valuationKey,
          observationId: evidence.observationId,
          observationRecordedAt: new Date(evidence.recordedAt),
          lotsRevision: evidence.lotsRevision,
          quoteSetJson: evidence.quoteSet,
          quoteSetDigest: evidence.quoteSetDigest,
          methodVersion: account.method,
          equity: account.equity,
          freeQuote: account.freeQuote,
          lockedQuote: account.lockedQuote,
          holdingsValue: account.holdingsValue,
          traderLotsValue: account.traderLotsValue,
          traderCostBasis: account.traderCostBasis,
          traderUnrealized: account.traderUnrealized,
          currency: "USDT",
          // This is the monetary projection state. Incomplete order/trade
          // observations remain in reasons and the account's separate facets.
          state: "ok",
          reasons: account.reasons ?? [],
          computedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: traderAdminAccountValuation.id });
      const point = await tx
        .insert(traderAdminEquityPoint)
        .values({
          organizationId: account.organizationId,
          exchangeAccountId: account.exchangeAccountId,
          bucket,
          equity: account.equity,
          traderUnrealized: account.traderUnrealized,
          valuationKey: account.valuationKey,
          methodVersion: account.method,
          state: "ok",
        })
        .onConflictDoNothing()
        .returning({ bucket: traderAdminEquityPoint.bucket });
      processed += version.length + point.length;
    }
    return { processed, blocked };
  });
}
