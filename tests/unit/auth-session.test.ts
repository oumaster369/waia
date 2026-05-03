import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import {
  createSessionRow,
  deleteSessionById,
  resolveUserIdFromSessionId,
} from "@/lib/auth/session-service";

const SESSION_USER_ID = "session-test-user";

describe("session boundary", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-session-"));
    const dbPath = path.join(tmpRoot, "session.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: SESSION_USER_ID,
      email: "session-test@example.com",
      password: "password123",
    });
  });

  afterAll(() => {
    resetWaiaSqliteSingleton();
    if (prevDb === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = prevDb;
    }
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("resolves user id from a non-expired session row", () => {
    const db = getDb();
    const sessionId = crypto.randomUUID();
    const expiresAtMs = Date.now() + 60_000;
    createSessionRow(db, { sessionId, userId: SESSION_USER_ID, expiresAtMs });
    expect(resolveUserIdFromSessionId(db, sessionId)).toBe(SESSION_USER_ID);
    deleteSessionById(db, sessionId);
    expect(resolveUserIdFromSessionId(db, sessionId)).toBeNull();
  });

  it("returns null for expired sessions", () => {
    const db = getDb();
    const sessionId = crypto.randomUUID();
    createSessionRow(db, { sessionId, userId: SESSION_USER_ID, expiresAtMs: Date.now() - 1000 });
    expect(resolveUserIdFromSessionId(db, sessionId)).toBeNull();
  });
});
