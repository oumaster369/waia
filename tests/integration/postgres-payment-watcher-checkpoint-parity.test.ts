/**
 * DEE-321 — payment watcher checkpoint Postgres parity (opt-in).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { createPostgresWatcherCheckpointRepositoryAdapter } from "@/lib/waia-core/payment-watcher/checkpoint-repository-adapters";
import { CANONICAL_NETWORK } from "@/lib/waia-core/payment-watcher/watcher-config";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres payment watcher checkpoint parity (DEE-321)",
  () => {
    beforeAll(async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        await sql.unsafe(`DELETE FROM payment_watcher_checkpoints WHERE network = $1`, [
          CANONICAL_NETWORK,
        ]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    afterAll(() => {
      resetPostgresSingletonForTests();
    });

    it("bootstraps and saves checkpoint on postgres", async () => {
      const db = getPostgresDrizzle();
      const repo = createPostgresWatcherCheckpointRepositoryAdapter(db);

      const boot = await repo.bootstrap(CANONICAL_NETWORK, "5000");
      expect(boot.lastScannedBlock).toBe("5000");

      const acquired = await repo.tryAcquireLease(CANONICAL_NETWORK, 600);
      expect(acquired).toBe(true);

      await repo.saveProgress(CANONICAL_NETWORK, "5200");
      const loaded = await repo.load(CANONICAL_NETWORK);
      expect(loaded?.lastScannedBlock).toBe("5200");
    });
  },
);
