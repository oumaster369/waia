import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { createSqliteWatcherCheckpointRepositoryAdapter } from "@/lib/waia-core/payment-watcher/checkpoint-repository-adapters";
import { CANONICAL_NETWORK } from "@/lib/waia-core/payment-watcher/watcher-config";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";

describe("watcher checkpoint repository (sqlite)", () => {
  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-watcher-checkpoint-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "checkpoint.sqlite")}`;
    migrateDatabaseFromEnv();
  });

  it("bootstraps, acquires lease, saves progress, and records errors", async () => {
    const db = getDb();
    const repo = createSqliteWatcherCheckpointRepositoryAdapter(db);

    const boot = await repo.bootstrap(CANONICAL_NETWORK, "1000");
    expect(boot.lastScannedBlock).toBe("1000");

    const acquired = await repo.tryAcquireLease(CANONICAL_NETWORK, 600);
    expect(acquired).toBe(true);

    const held = await repo.tryAcquireLease(CANONICAL_NETWORK, 600);
    expect(held).toBe(false);

    await repo.saveProgress(CANONICAL_NETWORK, "1100");
    const loaded = await repo.load(CANONICAL_NETWORK);
    expect(loaded?.lastScannedBlock).toBe("1100");
    expect(loaded?.cycleCount).toBe(1);

    await repo.recordError(CANONICAL_NETWORK, "rpc outage");
    const errored = await repo.load(CANONICAL_NETWORK);
    expect(errored?.lastError).toBe("rpc outage");
  });
});
