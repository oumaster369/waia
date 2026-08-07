/**
 * FHV Phase 1 — SQLite online backup + generation-scoped session isolation.
 */

import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  backupSqliteDatabaseToFile,
  getDb,
  getRawSqliteDatabase,
  resetWaiaSqliteSingleton,
} from "@/db/client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { resolveFhvGenerationSessionDbPath } from "@/lib/trader/observability/fhv-generation-session-path";
import { seedFhvSqliteResearchOrganization } from "@/lib/trader/observability/fhv-sqlite-research-org-seed";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";

const GEN1_ORG_ID = "00000000-0000-4000-8000-000000043601";
const GEN2_ORG_ID = "00000000-0000-4000-8000-000000043602";

function organizationExists(dbPath: string, organizationId: string): boolean {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare(`SELECT id FROM organizations WHERE id = @organizationId LIMIT 1`)
      .get({ organizationId });
    return row !== undefined;
  } finally {
    db.close();
  }
}

describe("FHV SQLite online backup + generation isolation", () => {
  afterEach(() => {
    resetWaiaSqliteSingleton();
  });

  it("FHV_SQLITE_WAL_BACKUP_CAPTURES_WAL_DATA_RED", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fhv-wal-backup-"));
    const dbPath = join(tempDir, "source.sqlite");
    const backupPath = join(tempDir, "online-backup.sqlite");
    const mainOnlyPath = join(tempDir, "main-only.sqlite");

    try {
      process.env.DATABASE_URL = dbPath;
      getDb();
      getRawSqliteDatabase().exec(`
        CREATE TABLE wal_probe (
          id INTEGER PRIMARY KEY,
          marker TEXT NOT NULL
        )
      `);
      getRawSqliteDatabase()
        .prepare(`INSERT INTO wal_probe (marker) VALUES (?)`)
        .run("wal-only-row");

      copyFileSync(dbPath, mainOnlyPath);

      const result = await backupSqliteDatabaseToFile(backupPath);
      expect(result.integrityCheck).toBe("ok");
      expect(result.bytes).toBeGreaterThan(0);

      const readMarker = (path: string): string | undefined => {
        const db = new Database(path, { readonly: true });
        try {
          const row = db.prepare(`SELECT marker FROM wal_probe LIMIT 1`).get() as
            | { marker: string }
            | undefined;
          return row?.marker;
        } catch {
          return undefined;
        } finally {
          db.close();
        }
      };

      expect(readMarker(mainOnlyPath)).toBeUndefined();
      expect(readMarker(backupPath)).toBe("wal-only-row");
      expect(existsSync(`${dbPath}-wal`)).toBe(true);
    } finally {
      resetWaiaSqliteSingleton();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("FHV_STALE_GENERATION_DB_ISOLATION_RED", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "fhv-gen-isolation-"));
    const gen1Path = resolveFhvGenerationSessionDbPath(runDir, 1);
    const gen2Path = resolveFhvGenerationSessionDbPath(runDir, 2);

    try {
      const sessionGen1 = await createInMemoryResearchBacktestSession({ sessionDbPath: gen1Path });
      try {
        seedFhvSqliteResearchOrganization({
          db: getDb(),
          organizationId: GEN1_ORG_ID,
          operatorId: "gen-1",
          slot: 601,
        });
      } finally {
        sessionGen1.cleanup();
      }

      const sessionGen2 = await createInMemoryResearchBacktestSession({ sessionDbPath: gen2Path });
      try {
        expect(organizationExists(gen2Path, GEN1_ORG_ID)).toBe(false);

        seedFhvSqliteResearchOrganization({
          db: getDb(),
          organizationId: GEN2_ORG_ID,
          operatorId: "gen-2",
          slot: 602,
        });
      } finally {
        sessionGen2.cleanup();
      }

      expect(organizationExists(gen1Path, GEN1_ORG_ID)).toBe(true);
      expect(organizationExists(gen1Path, GEN2_ORG_ID)).toBe(false);
      expect(organizationExists(gen2Path, GEN2_ORG_ID)).toBe(true);
      expect(organizationExists(gen2Path, GEN1_ORG_ID)).toBe(false);
      expect(gen1Path).not.toBe(gen2Path);
    } finally {
      resetWaiaSqliteSingleton();
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("captures and restores deterministic replay id frontier", () => {
    const factory = createDeterministicReplayIdFactory(437_001);
    const first = factory();
    const frontier = factory.captureFrontier();
    const second = factory();
    expect(second).not.toBe(first);

    factory.restoreFrontier(frontier);
    expect(factory()).toBe(second);
  });

  it("captures and restores order rate store snapshot", () => {
    const store = createInMemoryOrderRateStore();
    store.recordAndCount("acct-a", 1_000, 60_000);
    store.recordAndCount("acct-a", 2_000, 60_000);
    const snapshot = store.captureSnapshot();

    const restored = createInMemoryOrderRateStore();
    restored.restoreSnapshot(snapshot);
    expect(restored.captureSnapshot()).toEqual(snapshot);
  });

  it("captures and restores mock exchange connector checkpoint state", async () => {
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    await connector.placeOrder({
      clientOrderId: "client-1",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "0.01",
    });

    const checkpoint = connector.captureCheckpointState();
    const restored = new MockExchangeConnector();
    restored.restoreCheckpointState(checkpoint);

    expect(await restored.getOpenOrders()).toEqual(await connector.getOpenOrders());
    expect(await restored.getTradeHistory()).toEqual(await connector.getTradeHistory());
    expect(restored.captureCheckpointState()).toEqual(checkpoint);
  });
});
