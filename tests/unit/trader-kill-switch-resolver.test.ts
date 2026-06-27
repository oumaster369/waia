import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { traderKillSwitches } from "@/db/schema";
import { createKillSwitchResolver } from "@/lib/trader/risk/kill-switch/resolver";
import { createSqliteKillSwitchRepository } from "@/lib/trader/risk/kill-switch/repository-adapters";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000243a";
const USER_B = "00000000-0000-4000-8000-0000000243b";

describe("kill switch resolver (DEE-243)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-kill-switch-resolver-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "kill-switch-resolver.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "kill-switch-resolver-a@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Resolver Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "kill-switch-resolver-b@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Resolver Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Kill Switch Resolver Org A",
    });
    orgB = ensureUserCoreSeedSqlite(db, {
      userId: USER_B,
      displayName: "Kill Switch Resolver Org B",
    });

    db.insert(traderKillSwitches)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgA,
        scopeType: "organization",
        scopeRef: "",
        switchType: "CLOSE_ONLY",
        enforcementMode: "CLOSE_ONLY",
        state: "ACTIVE",
        origin: "manual",
        reason: "org close only",
      })
      .run();

    db.insert(traderKillSwitches)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgA,
        scopeType: "venue",
        scopeRef: "binance",
        switchType: "PAUSE",
        enforcementMode: "REJECT",
        state: "ACTIVE",
        origin: "automatic",
        reason: "reserved venue",
      })
      .run();
  });

  it("returns not blocked when no enforcing rows exist", () => {
    const db = getDb();
    const resolver = createKillSwitchResolver({
      repository: createSqliteKillSwitchRepository(db),
      nowMs: () => Date.now(),
    });

    return expect(resolver.getEffectiveState(requireOrgContext(orgB))).resolves.toMatchObject({
      blocked: false,
      resolutionStatus: "ok",
      contributors: [],
    });
  });

  it("merges platform and org rows with most-restrictive-wins", async () => {
    const db = getDb();
    db.insert(traderKillSwitches)
      .values({
        id: crypto.randomUUID(),
        organizationId: null,
        scopeType: "platform",
        scopeRef: "",
        switchType: "EMERGENCY_STOP",
        enforcementMode: "REJECT",
        state: "ACTIVE",
        origin: "manual",
        reason: "platform halt",
      })
      .run();

    const resolver = createKillSwitchResolver({
      repository: createSqliteKillSwitchRepository(db),
      nowMs: () => Date.now(),
    });

    const effective = await resolver.getEffectiveState(requireOrgContext(orgA));
    expect(effective.blocked).toBe(true);
    expect(effective.enforcementMode).toBe("CLOSE_ONLY");
    expect(effective.contributors).toHaveLength(2);
    expect(effective.resolutionStatus).toBe("ok");
  });

  it("returns fail_closed when repository read throws", async () => {
    const resolver = createKillSwitchResolver({
      repository: {
        listEnforcingRowsForResolution: () => {
          throw new Error("read failed");
        },
      } as never,
      nowMs: () => Date.now(),
    });

    const effective = await resolver.getEffectiveState(requireOrgContext(orgA));
    expect(effective.resolutionStatus).toBe("fail_closed");
    expect(effective.blocked).toBe(true);
    expect(effective.enforcementMode).toBe("STOP_ACCOUNT");
  });

  it("ignores reserved venue scope rows", async () => {
    const db = getDb();
    db.insert(traderKillSwitches)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgB,
        scopeType: "venue",
        scopeRef: "binance",
        switchType: "PAUSE",
        enforcementMode: "STOP_ACCOUNT",
        state: "ACTIVE",
        origin: "automatic",
        reason: "reserved only",
      })
      .run();

    const resolver = createKillSwitchResolver({
      repository: createSqliteKillSwitchRepository(db),
      nowMs: () => Date.now(),
    });

    const effective = await resolver.getEffectiveState(requireOrgContext(orgB));
    expect(effective.contributors.every((c) => c.scopeType !== "venue")).toBe(true);
  });
});
