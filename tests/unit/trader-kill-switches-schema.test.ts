import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { traderKillSwitches } from "@/db/schema";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000206c";

function baseKillSwitchRow(
  overrides: Partial<typeof traderKillSwitches.$inferInsert> = {},
): typeof traderKillSwitches.$inferInsert {
  return {
    id: crypto.randomUUID(),
    organizationId: null,
    scopeType: "platform",
    scopeRef: "",
    switchType: "EMERGENCY_STOP",
    enforcementMode: "REJECT",
    state: "INACTIVE",
    origin: "manual",
    ...overrides,
  };
}

describe("trader_kill_switches schema (DEE-206A)", () => {
  let orgA: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-kill-switch-schema-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "kill-switch-schema.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "kill-switch-schema-a@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Schema Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Kill Switch Schema Org A",
    });
  });

  it("inserts platform-scoped row with null organization_id", () => {
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(traderKillSwitches)
      .values(
        baseKillSwitchRow({
          id,
          organizationId: null,
          scopeType: "platform",
          state: "ACTIVE",
        }),
      )
      .run();

    const row = db
      .select()
      .from(traderKillSwitches)
      .where(and(eq(traderKillSwitches.id, id), isNull(traderKillSwitches.organizationId)))
      .all()[0];

    expect(row?.scopeType).toBe("platform");
    expect(row?.organizationId).toBeNull();
    expect(row?.stateVersion).toBe(1);
    expect(row?.reason).toBe("");
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("rejects duplicate org-scoped rows for the same scope key", () => {
    const db = getDb();
    const shared = {
      organizationId: orgA,
      scopeType: "organization" as const,
      scopeRef: "",
      switchType: "PAUSE" as const,
    };

    db.insert(traderKillSwitches)
      .values(
        baseKillSwitchRow({
          ...shared,
          id: crypto.randomUUID(),
          state: "ACTIVE",
        }),
      )
      .run();

    expect(() =>
      db
        .insert(traderKillSwitches)
        .values(
          baseKillSwitchRow({
            ...shared,
            id: crypto.randomUUID(),
            state: "INACTIVE",
          }),
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("rejects duplicate platform-scoped rows for the same scope key", () => {
    const db = getDb();
    const shared = {
      organizationId: null,
      scopeType: "platform" as const,
      scopeRef: "global",
      switchType: "CLOSE_ONLY" as const,
    };

    db.insert(traderKillSwitches)
      .values(
        baseKillSwitchRow({
          ...shared,
          id: crypto.randomUUID(),
          state: "ACTIVE",
        }),
      )
      .run();

    expect(() =>
      db
        .insert(traderKillSwitches)
        .values(
          baseKillSwitchRow({
            ...shared,
            id: crypto.randomUUID(),
            state: "INACTIVE",
          }),
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("persists reserved scope_type and switch_type values without interpretation", () => {
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(traderKillSwitches)
      .values(
        baseKillSwitchRow({
          id,
          organizationId: orgA,
          scopeType: "venue",
          scopeRef: "binance",
          switchType: "DATA_QUALITY",
          enforcementMode: "STOP_ACCOUNT",
          state: "CLEARING",
          origin: "automatic",
          reason: "reserved enum round-trip",
        }),
      )
      .run();

    const row = db.select().from(traderKillSwitches).where(eq(traderKillSwitches.id, id)).all()[0];

    expect(row?.scopeType).toBe("venue");
    expect(row?.switchType).toBe("DATA_QUALITY");
    expect(row?.origin).toBe("automatic");
    expect(row?.enforcementMode).toBe("STOP_ACCOUNT");
    expect(row?.state).toBe("CLEARING");
    expect(row?.reason).toBe("reserved enum round-trip");
  });
});
