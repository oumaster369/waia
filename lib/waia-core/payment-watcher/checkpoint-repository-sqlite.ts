import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, isNull, lt, or } from "drizzle-orm";

import { paymentWatcherCheckpoints } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type {
  WatcherCheckpointRepository,
  WatcherCheckpointView,
} from "@/lib/waia-core/payment-watcher/checkpoint-repository.types";

function mapRow(row: typeof paymentWatcherCheckpoints.$inferSelect): WatcherCheckpointView {
  return {
    network: row.network,
    lastScannedBlock: row.lastScannedBlock,
    lastScannedAt: row.lastScannedAt,
    leaseUntil: row.leaseUntil ?? null,
    lastError: row.lastError ?? null,
    lastErrorAt: row.lastErrorAt ?? null,
    cycleCount: row.cycleCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createSqliteWatcherCheckpointRepository(db: WaiaDb): WatcherCheckpointRepository {
  return {
    async load(network) {
      const row = db
        .select()
        .from(paymentWatcherCheckpoints)
        .where(eq(paymentWatcherCheckpoints.network, network))
        .limit(1)
        .all()[0];
      return row ? mapRow(row) : null;
    },

    async bootstrap(network, startBlock) {
      const now = new Date();
      db.insert(paymentWatcherCheckpoints)
        .values({
          network,
          lastScannedBlock: startBlock,
          lastScannedAt: now,
          leaseUntil: null,
          lastError: null,
          lastErrorAt: null,
          cycleCount: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const row = db
        .select()
        .from(paymentWatcherCheckpoints)
        .where(eq(paymentWatcherCheckpoints.network, network))
        .limit(1)
        .all()[0];
      if (!row) {
        throw new Error("[waia-core] watcher checkpoint bootstrap failed");
      }
      return mapRow(row);
    },

    async tryAcquireLease(network, leaseTtlSeconds) {
      const now = new Date();
      const leaseUntil = new Date(now.getTime() + leaseTtlSeconds * 1000);
      const result = db
        .update(paymentWatcherCheckpoints)
        .set({ leaseUntil, updatedAt: now })
        .where(
          and(
            eq(paymentWatcherCheckpoints.network, network),
            or(
              isNull(paymentWatcherCheckpoints.leaseUntil),
              lt(paymentWatcherCheckpoints.leaseUntil, now),
            ),
          ),
        )
        .run();
      return result.changes > 0;
    },

    async releaseLease(network) {
      const now = new Date();
      db.update(paymentWatcherCheckpoints)
        .set({ leaseUntil: null, updatedAt: now })
        .where(eq(paymentWatcherCheckpoints.network, network))
        .run();
    },

    async saveProgress(network, lastScannedBlock, incrementCycle = true) {
      const now = new Date();
      const existing = db
        .select()
        .from(paymentWatcherCheckpoints)
        .where(eq(paymentWatcherCheckpoints.network, network))
        .limit(1)
        .all()[0];
      if (!existing) {
        throw new Error("[waia-core] watcher checkpoint missing on save");
      }
      db.update(paymentWatcherCheckpoints)
        .set({
          lastScannedBlock,
          lastScannedAt: now,
          leaseUntil: null,
          lastError: null,
          lastErrorAt: null,
          cycleCount: incrementCycle ? existing.cycleCount + 1 : existing.cycleCount,
          updatedAt: now,
        })
        .where(eq(paymentWatcherCheckpoints.network, network))
        .run();
      const row = db
        .select()
        .from(paymentWatcherCheckpoints)
        .where(eq(paymentWatcherCheckpoints.network, network))
        .limit(1)
        .all()[0];
      if (!row) {
        throw new Error("[waia-core] watcher checkpoint save failed");
      }
      return mapRow(row);
    },

    async recordError(network, message) {
      const now = new Date();
      db.update(paymentWatcherCheckpoints)
        .set({
          lastError: message,
          lastErrorAt: now,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(eq(paymentWatcherCheckpoints.network, network))
        .run();
    },
  };
}
