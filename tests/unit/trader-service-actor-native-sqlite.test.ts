import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "@/db/client";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createPostgresActorServices, createSqliteActorServices } from "@/tests/helpers/trader-actor-services";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { requireServiceOrgContext } from "@/lib/trader/security/service-org-context";

const owner = crypto.randomUUID();
const outsider = crypto.randomUUID();
const inventory = createPostgresActorServices({} as WaiaPostgresDb);
const createProvider = vi.fn();
let services: ReturnType<typeof createSqliteActorServices>;
let organizationId: string;

describe("DEE-1100 native SQLite membership", () => {
  beforeAll(() => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "waia-actor-membership-"));
    process.env.DATABASE_URL = `file:${path.join(directory, "test.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    for (const id of [owner, outsider]) {
      insertEmailPasswordUser(db, { id, email: `${id}@waia.invalid`, password: "test-only-password" });
      ensureUserCoreSeedSqlite(db, { userId: id, displayName: "Actor fixture" });
    }
    organizationId = ensureUserCoreSeedSqlite(db, { userId: owner, displayName: "Actor owner" });
    services = createSqliteActorServices(db, { createProvider });
  });
  for (const [name, sample] of Object.entries(inventory)) {
    for (const operation of Object.keys(sample)) {
      it(`${name}.${operation} rejects a real non-member`, async () => {
        const service = services[name as keyof typeof services];
        const method = Reflect.get(service, operation);
        await expect(Reflect.apply(method, service, [{ organizationId, userId: outsider }, {}, {}, {}]))
          .rejects.toThrow("ORG_MEMBERSHIP_REQUIRED");
        expect(createProvider).not.toHaveBeenCalled();
      });
    }
  }
  it("keeps owner access and the trusted internal scope", async () => {
    expect(await services.credential.listCredentialMetadata({ organizationId, userId: owner })).toEqual([]);
    expect(await services.credential.listCredentialMetadata({ organizationId })).toEqual([]);
    expect(await services.source.listSources({ organizationId, userId: owner })).toEqual([]);
  });
});

describe("DEE-1100 service actor context is fail closed", () => {
  it.each(["", " ", " actor ", null, false, 0])("refuses malformed supplied actor %j", async (userId) => {
    const check = vi.fn();
    await expect(requireServiceOrgContext({ organizationId: "org", userId } as never, check))
      .rejects.toThrow("ORG_ACTOR_INVALID");
    expect(check).not.toHaveBeenCalled();
  });
  it("requires a verifier when a user is supplied", async () => {
    await expect(requireServiceOrgContext({ organizationId: "org", userId: "actor" }))
      .rejects.toThrow("ORG_MEMBERSHIP_CHECK_REQUIRED");
  });
  it("normalizes the org but preserves and verifies the actor", async () => {
    const check = vi.fn();
    expect(await requireServiceOrgContext({ organizationId: " org ", userId: "actor" }, check))
      .toEqual({ organizationId: "org", userId: "actor" });
    expect(check).toHaveBeenCalledWith({ organizationId: "org", userId: "actor" });
  });
});
