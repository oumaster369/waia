import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { paymentWatcherCheckpoints } from "@/db/schema";
import { createSqlitePaymentService } from "@/lib/waia-core/payments";
import { createSqliteWatcherCheckpointRepositoryAdapter } from "@/lib/waia-core/payment-watcher/checkpoint-repository-adapters";
import {
  CANONICAL_NETWORK,
  loadWatcherConfig,
} from "@/lib/waia-core/payment-watcher/watcher-config";
import {
  runWatcherCycle,
  tryAcquireWatcherLeaseWithStaleRecovery,
} from "@/lib/waia-core/payment-watcher/run-watcher-cycle";
import type { WatcherDeps } from "@/lib/waia-core/payment-watcher/watcher-cycle.types";
import { createStdoutWatcherLogger } from "@/lib/waia-core/payment-watcher/watcher-logger";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";

function setupDb(): ReturnType<typeof getDb> {
  resetWaiaSqliteSingleton();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-watcher-stale-lease-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "stale-lease.sqlite")}`;
  migrateDatabaseFromEnv();
  return getDb();
}

function buildDeps(db: ReturnType<typeof getDb>, now: Date): WatcherDeps {
  const config = loadWatcherConfig({
    WATCHER_ENABLED: "true",
    WATCHER_STALE_THRESHOLD_SECONDS: "300",
    WATCHER_LEASE_TTL_SECONDS: "600",
  });
  return {
    config,
    chainAdapter: {
      getTipBlock: async () => ({ ok: true, value: "100", provider: "primary" }),
      getTransfersInRange: async () => ({ ok: true, value: [], provider: "primary" }),
      getTransactionExists: async () => ({ ok: true, value: true, provider: "primary" }),
    },
    checkpointRepository: createSqliteWatcherCheckpointRepositoryAdapter(db),
    paymentService: createSqlitePaymentService(db),
    inboundResolver: {
      resolveOwnerByDepositAddress: async () => null,
    },
    logger: createStdoutWatcherLogger(),
    listDetectedInboundPayments: async () => [],
    now: () => now,
  };
}

describe("tryAcquireWatcherLeaseWithStaleRecovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("releases an orphaned lease when scan lag exceeds stale threshold and retries once", async () => {
    const db = setupDb();
    const repo = createSqliteWatcherCheckpointRepositoryAdapter(db);
    const now = new Date("2026-06-29T10:00:00.000Z");
    const staleScannedAt = new Date(now.getTime() - 400_000);

    await repo.bootstrap(CANONICAL_NETWORK, "1000");

    const leaseUntil = new Date(now.getTime() + 600_000);
    db.update(paymentWatcherCheckpoints)
      .set({ lastScannedAt: staleScannedAt, leaseUntil })
      .where(eq(paymentWatcherCheckpoints.network, CANONICAL_NETWORK))
      .run();

    const deps = buildDeps(db, now);
    const logSpy = vi.spyOn(deps.logger, "log");

    const acquired = await tryAcquireWatcherLeaseWithStaleRecovery(deps, now);
    expect(acquired).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "lease_stale_recovery",
        scan_lag_seconds: 400,
      }),
    );

    const secondAcquire = await repo.tryAcquireLease(CANONICAL_NETWORK, 600);
    expect(secondAcquire).toBe(false);
  });

  it("does not steal a fresh legitimate lease", async () => {
    const db = setupDb();
    const repo = createSqliteWatcherCheckpointRepositoryAdapter(db);
    const now = new Date("2026-06-29T11:00:00.000Z");

    await repo.bootstrap(CANONICAL_NETWORK, "2000");

    const leaseUntil = new Date(now.getTime() + 600_000);
    db.update(paymentWatcherCheckpoints)
      .set({ lastScannedAt: now, leaseUntil })
      .where(eq(paymentWatcherCheckpoints.network, CANONICAL_NETWORK))
      .run();

    const deps = buildDeps(db, now);
    const acquired = await tryAcquireWatcherLeaseWithStaleRecovery(deps, now);
    expect(acquired).toBe(false);
  });

  it("keeps normal lease_held when recovery is not applicable", async () => {
    const db = setupDb();
    const repo = createSqliteWatcherCheckpointRepositoryAdapter(db);
    const now = new Date("2026-06-29T12:00:00.000Z");

    await repo.bootstrap(CANONICAL_NETWORK, "3000");

    const leaseUntil = new Date(now.getTime() + 600_000);
    db.update(paymentWatcherCheckpoints)
      .set({ lastScannedAt: now, leaseUntil })
      .where(eq(paymentWatcherCheckpoints.network, CANONICAL_NETWORK))
      .run();

    const deps = buildDeps(db, now);
    const report = await runWatcherCycle(deps);
    expect(report.outcome).toBe("noop_lease_held");
  });
});
