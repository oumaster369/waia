import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as pgSchema from "@/db/schema.postgres";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  dispose: vi.fn(),
  membership: vi.fn(),
  entitlement: vi.fn(),
  permission: vi.fn(),
  projection: vi.fn(),
  end: vi.fn(),
  resolve: vi.fn(),
  latest: vi.fn(),
}));

vi.mock("@/lib/auth/session-user", () => ({ getFreshOptionalAdminSessionUserId: mocks.user }));
vi.mock("@/db/waia-runtime-db", () => ({
  getWaiaRuntimeDb: mocks.access,
  disposeWaiaRuntimeDb: mocks.dispose,
}));
vi.mock("@/lib/waia-core/scope/org-context", () => ({
  assertOrgMembershipPostgres: mocks.membership,
}));
vi.mock("@/lib/waia-core/entitlements/authoritative", () => ({
  hasModuleEntitlementPostgres: mocks.entitlement,
}));
vi.mock("@/lib/waia-core/permissions/admin-http", () => ({
  assertAdminPermission: mocks.permission,
}));
vi.mock("@/lib/trader/account-observation/projection-client", () => ({
  createProjectionClient: mocks.projection,
}));
import {
  accountObservationRoute,
  createAccountObservationRouteDependencies,
} from "@/lib/trader/account-observation/route";
import { GET as tenantStream } from "@/app/api/trader/account-observation/stream/route";
import { GET as adminStream } from "@/app/api/trader/admin/account-observation/stream/route";
const binding = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002",
  exchangeAccountId: "account",
  credentialRevision: "1",
  configurationRevision: "config-1",
};
const request = () =>
  new Request("http://localhost/api/trader/account-observation?" + new URLSearchParams(binding));

function postgresSqlOnSqlite(sqlite: Database.Database) {
  return drizzle(
    async (query, params) => {
      const sql = query.replace(/\$(\d+)/g, "?");
      const objects = sqlite.prepare(sql).all(...(params ?? [])) as Record<string, unknown>[];
      return { rows: objects.map((row) => Object.values(row)) };
    },
    { schema: pgSchema },
  );
}

function cabinetSqlite() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE organizations (id text PRIMARY KEY, kind text NOT NULL);
    CREATE TABLE exchange_credentials (
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      venue text NOT NULL,
      status text NOT NULL
    );
  `);
  return sqlite;
}

function seedCabinet(
  sqlite: Database.Database,
  row: { id: string; kind: string; credentialId?: string; venue?: string; status?: string },
) {
  sqlite.prepare("INSERT INTO organizations (id, kind) VALUES (?, ?)").run(row.id, row.kind);
  if (row.credentialId) {
    sqlite
      .prepare(
        "INSERT INTO exchange_credentials (id, organization_id, venue, status) VALUES (?, ?, ?, ?)",
      )
      .run(row.credentialId, row.id, row.venue, row.status);
  }
}

function configureProjection() {
  vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_PROJECTION_ENABLED", "1");
  vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_PROJECTION_HMAC_KEY_HEX", "09".repeat(32));
  vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_PROJECTION_EPOCH", "11111111-1111-4111-8111-111111111111");
  vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_PROJECTION_KEY_ID", "synthetic-key-id");
  vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_PROJECTION_ACCESS_CLIENT_ID", "synthetic-access-id");
  vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_PROJECTION_ACCESS_CLIENT_SECRET", "synthetic-access-secret");
  vi.stubEnv("WAIA_RELEASE_SHA", "a".repeat(40));
}
let cabinet: Database.Database;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_PROJECTION_ENABLED", "0");
  cabinet = cabinetSqlite();
  seedCabinet(cabinet, {
    id: binding.organizationId,
    kind: "personal",
    credentialId: binding.credentialId,
    venue: "htx",
    status: "active",
  });
  mocks.user.mockResolvedValue("synthetic-user");
  mocks.access.mockResolvedValue({ kind: "postgres", db: postgresSqlOnSqlite(cabinet) });
  mocks.entitlement.mockResolvedValue(true);
  mocks.membership.mockResolvedValue(undefined);
  mocks.permission.mockResolvedValue({ allowed: true });
  mocks.resolve.mockResolvedValue(binding);
  mocks.latest.mockResolvedValue(null);
  mocks.end.mockResolvedValue(undefined);
  mocks.projection.mockReturnValue({ resolveActiveBinding: mocks.resolve, readLatest: mocks.latest, dispose: mocks.end });
});
afterEach(() => {
  cabinet?.close();
  vi.unstubAllEnvs();
});
describe("account observation route wiring, no external requests", () => {
  it.each([tenantStream, adminStream])(
    "stream wrapper opens/disposes independent read contexts and revalidates fresh identity",
    async (get) => {
      configureProjection();
      vi.useFakeTimers();
      try {
        const response = await get(request());
        const reader = response.body!.getReader();
        await reader.read();
        expect(mocks.projection).toHaveBeenCalledTimes(2);
        expect(mocks.end).toHaveBeenCalledTimes(2);
        expect(mocks.dispose).toHaveBeenCalledTimes(2);
        expect(mocks.user.mock.calls.length).toBeGreaterThanOrEqual(8);
        mocks.user.mockResolvedValue(null);
        const next = reader.read();
        await vi.advanceTimersByTimeAsync(5000);
        expect(new TextDecoder().decode((await next).value)).toContain("event: revoked");
        expect((await reader.read()).done).toBe(true);
        expect(mocks.projection).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("does not acquire either database for anonymous requests", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await accountObservationRoute(request(), "tenant")).status).toBe(401);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.projection).not.toHaveBeenCalled();
  });
  it("missing projection configuration fails closed without direct SQL fallback", async () => {
    vi.stubEnv("DATABASE_URL_POSTGRES", "synthetic-forbidden-fallback");
    vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_DATABASE_URL", "synthetic-reader-fallback");
    const response = await accountObservationRoute(request(), "tenant");
    expect(response.status).toBe(503);
    expect(mocks.projection).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("fallback");
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("uses the fixed projection and disposes it after every poll", async () => {
    configureProjection();
    expect((await accountObservationRoute(request(), "tenant")).status).toBe(204);
    expect(mocks.projection).toHaveBeenCalledWith(
      expect.objectContaining({
        tuple: expect.objectContaining({ audience: "https://observation-reader.waia.life", releaseSha: "a".repeat(40) }),
        deadlineMs: expect.any(Number), accessClientId: "synthetic-access-id",
      }),
    );
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it.each([
    ["personal active htx", "personal", "htx", "active", true],
    ["business active htx", "business", "htx", "active", false],
    ["personal revoked htx", "personal", "htx", "revoked", false],
    ["personal without a credential", "personal", null, null, false],
  ] as const)(
    "executes the cabinet-list query: %s",
    async (_label, kind, venue, status, listed) => {
      const organizationId = "00000000-0000-4000-8000-0000000000aa";
      seedCabinet(cabinet, {
        id: organizationId,
        kind,
        ...(venue && status
          ? { credentialId: "00000000-0000-4000-8000-0000000000bb", venue, status }
          : {}),
      });
      const context = createAccountObservationRouteDependencies();
      try {
        await expect(
          context.deps.isAdminListedOrganization(organizationId, new AbortController().signal),
        ).resolves.toBe(listed);
      } finally {
        await context.dispose();
      }
    },
  );
  it("does not give an unauthorized operator a projection connection", async () => {
    mocks.permission.mockResolvedValue({ allowed: false });
    expect((await accountObservationRoute(request(), "admin")).status).toBe(403);
    expect(mocks.projection).not.toHaveBeenCalled();
  });
  it("does not fall back to SQLite for this new storage path", async () => {
    mocks.access.mockResolvedValue({ kind: "sqlite", db: {} });
    expect((await accountObservationRoute(request(), "tenant")).status).toBe(503);
    expect(mocks.projection).not.toHaveBeenCalled();
  });
  it("never exposes driver details and still closes a failed reader", async () => {
    configureProjection();
    mocks.resolve.mockRejectedValue(new Error("synthetic-private-driver-detail"));
    const response = await accountObservationRoute(request(), "tenant");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("driver-detail");
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("captures the shared deadline before auth awaits and passes exact three-field resolve scopes", async () => {
    configureProjection();
    const now = 1_800_000_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    mocks.user.mockImplementation(async () => { clock.mockReturnValue(now + 4000); return "synthetic-user"; });
    try {
      expect((await accountObservationRoute(request(), "tenant")).status).toBe(204);
      expect(mocks.projection.mock.calls[0][0].deadlineMs).toBe(now + 5000);
      for (const [scope, signal] of mocks.resolve.mock.calls) {
        expect(scope).toEqual({ organizationId: binding.organizationId,
          credentialId: binding.credentialId, exchangeAccountId: binding.exchangeAccountId });
        expect(signal).toBeInstanceOf(AbortSignal);
      }
      expect(mocks.latest).toHaveBeenCalledWith(binding, expect.any(AbortSignal));
    } finally { clock.mockRestore(); }
  });
  it("expired authorization never starts signing and does not renew the route deadline", async () => {
    configureProjection();
    const now = 1_800_000_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    mocks.user.mockImplementation(async () => { clock.mockReturnValue(now + 5000); return "synthetic-user"; });
    try {
      expect((await accountObservationRoute(request(), "tenant")).status).toBe(503);
      expect(mocks.projection).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });
  it("revoked access after the read returns no snapshot and still disposes the transport", async () => {
    configureProjection();
    mocks.latest.mockImplementation(async () => { mocks.user.mockResolvedValue(null); return null; });
    expect((await accountObservationRoute(request(), "tenant")).status).toBe(403);
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
