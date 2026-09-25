import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as schema from "@/db/schema.postgres";
import { createPostgresActorServices } from "@/tests/helpers/trader-actor-services";
import { seedHtrPostgresUser } from "@/tests/integration/htr-postgres-fixture-prelude";
import { createPostgresCredentialService } from "@/lib/trader/credentials/credential-service";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { handleExchangeCredentialsGet, type ConnectHandlerDeps } from "@/lib/trader/credentials/connect-handler";
import { handleAdminExchangeCredentialsGet } from "@/lib/trader/credentials/admin-route-handler";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const owner = crypto.randomUUID();
const outsider = crypto.randomUUID();
const admin = crypto.randomUUID();
const inventory = createPostgresActorServices({} as WaiaPostgresDb);
const createProvider = vi.fn();
let services: ReturnType<typeof createPostgresActorServices>;
let organizationId: string;
let outsiderOrg: string;
let credentialId: string;

describe.skipIf(!enabled || !url)("DEE-1100 actual PostgreSQL service membership and HTTP composition", () => {
  beforeAll(async () => {
    organizationId = await seedHtrPostgresUser(url!, owner, "Actor Owner");
    outsiderOrg = await seedHtrPostgresUser(url!, outsider, "Actor Outsider");
    await seedHtrPostgresUser(url!, admin, "Actor Admin");
    const db = getPostgresDrizzle();
    await db.update(schema.userPlatformRoles).set({ role: "admin" }).where(eq(schema.userPlatformRoles.userId, admin));
    const master = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    const seed = createPostgresCredentialService(db, {
      createProvider: () => createMasterKeyProvider({ injectSecretGetter: async () => master, productionReady: true }),
    });
    const row = await seed.storeCredentials({ organizationId, userId: owner }, {
      venue: "mock", exchangeAccountId: "actor-fixture-account",
      credentials: { apiKey: "synthetic-actor-key", apiSecret: "synthetic-actor-secret" },
    });
    credentialId = row.id;
    services = createPostgresActorServices(db, { createProvider });
  });
  afterAll(() => { resetPostgresSingletonForTests(); }); // Preserve append-only fixture evidence.
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
  it("retains authorized owner metadata and leaves rejected mutations unchanged", async () => {
    const rows = await services.credential.listCredentialMetadata({ organizationId, userId: owner });
    expect(rows.map((row) => [row.id, row.status])).toEqual([[credentialId, "active"]]);
    expect(JSON.stringify(rows)).not.toContain("synthetic-actor-secret");
    expect(await services.source.listSources({ organizationId, userId: owner })).toEqual([]);
    expect(await services.credential.listCredentialMetadata({ organizationId: outsiderOrg, userId: outsider })).toEqual([]);
  });
  function requestDeps(userId: string | null): ConnectHandlerDeps {
    return {
      getUserId: async () => userId, hasTraderAccess: async () => true,
      getRuntimeDb: async () => ({ kind: "postgres", db: getPostgresDrizzle() }),
      disposeRuntimeDb: async () => undefined, createProvider,
      createConnector: () => { throw new Error("NO_VENUE_CALL_EXPECTED"); },
      createCredentialService: (runtime) => createPostgresCredentialService(runtime.db as WaiaPostgresDb, { createProvider }),
    };
  }
  it("HTTP list derives org from authenticated user and reaches native membership", async () => {
    const own = await handleExchangeCredentialsGet(requestDeps(owner));
    const other = await handleExchangeCredentialsGet(requestDeps(outsider));
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).toContain(credentialId);
    expect(other.status).toBe(200);
    expect(other.body).toEqual({ credentials: [] });
    expect(createProvider).not.toHaveBeenCalled();
  });
  it("anonymous HTTP never reaches a service", async () => {
    const deps = requestDeps(null);
    const createService = vi.spyOn(deps, "createCredentialService");
    expect((await handleExchangeCredentialsGet(deps)).status).toBe(401);
    expect(createService).not.toHaveBeenCalled();
  });
  it("explicit admin capability reads a client org, ordinary outsider is forbidden", async () => {
    const request = new Request(`https://example.invalid/api/trader/admin/credentials?organization_id=${organizationId}`);
    const allowed = await handleAdminExchangeCredentialsGet(request, requestDeps(admin));
    expect(allowed.status).toBe(200);
    expect(JSON.stringify(allowed.body)).toContain(credentialId);
    expect((await handleAdminExchangeCredentialsGet(request, requestDeps(outsider))).status).toBe(403);
  });
});
