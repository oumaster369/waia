import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { twinDialogueTurns, twinProfiles } from "@/db/schema";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { DEFAULT_READINESS_INPUT } from "@/lib/dashboard/readiness-snapshot-default";
import {
  appendTwinDialogueTurn,
  listTwinDialogueTurnsChronological,
  listTwinDialogueTurnsForUser,
  loadDashboardReadinessPayloadFromDb,
  persistUserTwinExchangeWithAssistantStub,
} from "@/lib/twin-persistence/loader";
import { eq, sql } from "drizzle-orm";

const TEST_USER_ID = "twin-loader-test-user";

describe("twin persistence loader", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;
  let twinProfileId: string;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-twin-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: TEST_USER_ID,
      email: "twin-loader@example.com",
      password: "password123",
    });
    const twin = db
      .select({ id: twinProfiles.id })
      .from(twinProfiles)
      .where(eq(twinProfiles.userId, TEST_USER_ID))
      .get();
    twinProfileId = twin!.id;
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
      /* best-effort */
    }
  });

  it("seeds defaults and flags no meaningful exchange until a user turn exists", async () => {
    const db = getDb();
    const payload = await loadDashboardReadinessPayloadFromDb(db, TEST_USER_ID);

    expect(payload.readinessInput).toEqual(DEFAULT_READINESS_INPUT);
    expect(payload.twinSignals.hasMeaningfulExchange).toBe(false);
  });

  it("appends turns in order, sets meaningful exchange after a user role, and ignores duplicate idempotency keys", async () => {
    const db = getDb();
    await appendTwinDialogueTurn(db, {
      twinProfileId,
      role: "user",
      content: "hello",
    });
    await appendTwinDialogueTurn(db, {
      twinProfileId,
      role: "assistant",
      content: "hi",
    });
    await appendTwinDialogueTurn(db, {
      twinProfileId,
      role: "user",
      content: "first",
      idempotencyKey: "dup",
    });
    await appendTwinDialogueTurn(db, {
      twinProfileId,
      role: "user",
      content: "retry",
      idempotencyKey: "dup",
    });

    const payload = await loadDashboardReadinessPayloadFromDb(db, TEST_USER_ID);
    expect(payload.twinSignals.hasMeaningfulExchange).toBe(true);

    const rows = await listTwinDialogueTurnsChronological(db, twinProfileId);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.sequence).toBeGreaterThan(rows[i - 1]!.sequence);
    }

    const [agg] = db
      .select({ c: sql<number>`count(*)`.mapWith(Number) })
      .from(twinDialogueTurns)
      .where(eq(twinDialogueTurns.idempotencyKey, "dup"))
      .all();
    expect(agg?.c).toBe(1);
  });

  it("listTwinDialogueTurnsForUser returns rows with ids, ISO timestamps, user then assistant pairing", async () => {
    const db = getDb();
    const twin = await persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId,
      userContent: "pair me unique",
      userIdempotencyKey: "dee26-pair-uniq",
      assistantContent: "stub reply",
    });
    expect(twin.userTurn.replayed).toBe(false);
    expect(twin.assistantTurn).not.toBeNull();
    const uSeq = twin.userTurn.sequence;
    const aSeq = twin.assistantTurn!.sequence;

    const pairRows = (await listTwinDialogueTurnsForUser(db, TEST_USER_ID)).filter(
      (t) => t.sequence === uSeq || t.sequence === aSeq,
    ).sort((a, b) => a.sequence - b.sequence);
    expect(pairRows).toHaveLength(2);
    expect(pairRows[0]?.role).toBe("user");
    expect(pairRows[0]?.content).toBe("pair me unique");
    expect(pairRows[1]?.role).toBe("assistant");
    expect(pairRows[1]?.content).toBe("stub reply");
    expect(pairRows.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
    expect(pairRows.every((r) => typeof r.createdAt === "string")).toBe(true);
  });

  it("listTwinDialogueTurnsChronological exposes id column on each row", async () => {
    const db = getDb();
    await appendTwinDialogueTurn(db, {
      twinProfileId,
      role: "user",
      content: "with id column",
      idempotencyKey: "id-col-test",
    });
    const rows = await listTwinDialogueTurnsChronological(db, twinProfileId);
    const mine = rows.find((r) => r.content === "with id column");
    expect(mine?.id).toBeTruthy();
    expect(typeof mine?.sequence).toBe("number");
  });
});
