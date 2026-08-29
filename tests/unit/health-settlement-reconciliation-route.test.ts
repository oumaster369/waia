import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/settlement-reconciliation/route";
import { resetWaiaSqliteSingleton } from "@/db/client";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";

describe("health settlement-reconciliation route", () => {
  let tmpRoot: string;
  let previousDatabaseUrl: string | undefined;
  let databasePath: string;

  beforeAll(() => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-settlement-health-"));
    databasePath = path.join(tmpRoot, "fresh.sqlite");
    expect(existsSync(databasePath)).toBe(false);
    process.env.DATABASE_URL = `file:${databasePath}`;
    migrateDatabaseFromEnv();
  });

  afterAll(() => {
    resetWaiaSqliteSingleton();
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns structured health payload", async () => {
    expect(existsSync(databasePath)).toBe(true);
    const response = await GET();
    const body = await response.json();
    expect(body).toHaveProperty("open_count");
    expect(body).toHaveProperty("stale_count");
    expect(body).toHaveProperty("orphan_exception_count");
    expect(body).toHaveProperty("ok");
    expect(typeof body.open_count).toBe("number");
    expect(typeof body.orphan_exception_count).toBe("number");
  });
});
