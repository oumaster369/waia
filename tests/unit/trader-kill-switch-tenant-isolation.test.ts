import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  KillSwitchAuthorizationError,
  createSqliteKillSwitchService,
} from "@/lib/trader/risk/kill-switch";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000243e";
const USER_B = "00000000-0000-4000-8000-0000000243f";
const SERVICE_ACTOR = { actorType: "service" as const, actorId: null };

describe("kill switch tenant isolation (DEE-243 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-kill-switch-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "kill-switch-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "kill-switch-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Iso Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "kill-switch-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Iso Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Kill Switch Iso Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Kill Switch Iso Org B" });

    const service = createSqliteKillSwitchService(db);
    await service.trip(
      SERVICE_ACTOR,
      requireOrgContext(orgA),
      { scopeType: "organization", organizationId: orgA },
      { scopeType: "organization", scopeRef: null, switchType: "EMERGENCY_STOP" },
      { enforcementMode: "REJECT", origin: "manual", reason: "org A trip" },
    );
  });

  it("org B cannot read org A switch via get", async () => {
    const db = getDb();
    const service = createSqliteKillSwitchService(db);

    const crossOrg = await service.get(
      requireOrgContext(orgB),
      { scopeType: "organization", organizationId: orgB },
      { scopeType: "organization", scopeRef: null, switchType: "EMERGENCY_STOP" },
    );

    expect(crossOrg).toBeNull();
  });

  it("org B list does not include org A rows", async () => {
    const db = getDb();
    const service = createSqliteKillSwitchService(db);
    const rows = await service.list(requireOrgContext(orgB));
    expect(rows).toHaveLength(0);
  });

  it("org B cannot mutate org A switch via stale org-scoped update path", async () => {
    const db = getDb();
    const service = createSqliteKillSwitchService(db);

    const orgAView = await service.get(
      requireOrgContext(orgA),
      { scopeType: "organization", organizationId: orgA },
      { scopeType: "organization", scopeRef: null, switchType: "EMERGENCY_STOP" },
    );
    expect(orgAView).not.toBeNull();

    await expect(
      service.beginClear(
        SERVICE_ACTOR,
        requireOrgContext(orgB),
        { scopeType: "organization", organizationId: orgA },
        { scopeType: "organization", scopeRef: null, switchType: "EMERGENCY_STOP" },
        { expectedStateVersion: orgAView!.stateVersion },
      ),
    ).rejects.toThrow(KillSwitchAuthorizationError);
  });

  it("platform switch is visible to both orgs via getEffectiveState", async () => {
    const db = getDb();
    const service = createSqliteKillSwitchService(db);

    await service.trip(
      SERVICE_ACTOR,
      null,
      { scopeType: "platform" },
      { scopeType: "platform", scopeRef: null, switchType: "PAUSE" },
      { enforcementMode: "REJECT", origin: "manual", reason: "platform pause" },
    );

    const orgAEffective = await service.getEffectiveState(requireOrgContext(orgA));
    const orgBEffective = await service.getEffectiveState(requireOrgContext(orgB));

    expect(orgAEffective.contributors.some((c) => c.scopeType === "platform")).toBe(true);
    expect(orgBEffective.contributors.some((c) => c.scopeType === "platform")).toBe(true);
  });
});
