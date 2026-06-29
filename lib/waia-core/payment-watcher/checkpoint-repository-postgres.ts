import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  WatcherCheckpointRepository,
  WatcherCheckpointView,
} from "@/lib/waia-core/payment-watcher/checkpoint-repository.types";

type PgCheckpointExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapRow(
  row: typeof pgSchema.paymentWatcherCheckpoints.$inferSelect,
): WatcherCheckpointView {
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

export function createPostgresWatcherCheckpointRepository(
  ex: PgCheckpointExecutor,
): WatcherCheckpointRepository {
  return {
    async load(network) {
      const rows = await ex
        .select()
        .from(pgSchema.paymentWatcherCheckpoints)
        .where(eq(pgSchema.paymentWatcherCheckpoints.network, network))
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },

    async bootstrap(network, startBlock) {
      const now = new Date();
      await ex.insert(pgSchema.paymentWatcherCheckpoints).values({
        network,
        lastScannedBlock: startBlock,
        lastScannedAt: now,
        leaseUntil: null,
        lastError: null,
        lastErrorAt: null,
        cycleCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      const rows = await ex
        .select()
        .from(pgSchema.paymentWatcherCheckpoints)
        .where(eq(pgSchema.paymentWatcherCheckpoints.network, network))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new Error("[waia-core] watcher checkpoint bootstrap failed");
      }
      return mapRow(row);
    },

    async tryAcquireLease(network, leaseTtlSeconds) {
      const rows = await ex
        .update(pgSchema.paymentWatcherCheckpoints)
        .set({
          leaseUntil: sql`now() + (${leaseTtlSeconds} * interval '1 second')`,
          updatedAt: sql`now()`,
        })
        .where(
          sql`${pgSchema.paymentWatcherCheckpoints.network} = ${network}
            AND (${pgSchema.paymentWatcherCheckpoints.leaseUntil} IS NULL
              OR ${pgSchema.paymentWatcherCheckpoints.leaseUntil} < now())`,
        )
        .returning({ network: pgSchema.paymentWatcherCheckpoints.network });
      return rows.length > 0;
    },

    async releaseLease(network) {
      await ex
        .update(pgSchema.paymentWatcherCheckpoints)
        .set({ leaseUntil: null, updatedAt: new Date() })
        .where(eq(pgSchema.paymentWatcherCheckpoints.network, network));
    },

    async saveProgress(network, lastScannedBlock, incrementCycle = true) {
      const existingRows = await ex
        .select()
        .from(pgSchema.paymentWatcherCheckpoints)
        .where(eq(pgSchema.paymentWatcherCheckpoints.network, network))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) {
        throw new Error("[waia-core] watcher checkpoint missing on save");
      }
      const now = new Date();
      await ex
        .update(pgSchema.paymentWatcherCheckpoints)
        .set({
          lastScannedBlock,
          lastScannedAt: now,
          leaseUntil: null,
          lastError: null,
          lastErrorAt: null,
          cycleCount: incrementCycle ? existing.cycleCount + 1 : existing.cycleCount,
          updatedAt: now,
        })
        .where(eq(pgSchema.paymentWatcherCheckpoints.network, network));
      const rows = await ex
        .select()
        .from(pgSchema.paymentWatcherCheckpoints)
        .where(eq(pgSchema.paymentWatcherCheckpoints.network, network))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new Error("[waia-core] watcher checkpoint save failed");
      }
      return mapRow(row);
    },

    async recordError(network, message) {
      const now = new Date();
      await ex
        .update(pgSchema.paymentWatcherCheckpoints)
        .set({
          lastError: message,
          lastErrorAt: now,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(eq(pgSchema.paymentWatcherCheckpoints.network, network));
    },
  };
}
