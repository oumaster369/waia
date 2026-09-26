import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { authorizeAdminRoute, type AdminRouteHandlerDeps } from "@/lib/waia-core/permissions/admin-http";
import { handleAdminInvoicesListGet } from "@/lib/trader/billing/admin-route-handler";
import { handleHistoricalSimulationAdminLaunchPostV2 } from "@/lib/trader/historical-simulation-v2/admin-launch-handler-v2";
import { handleHistoricalRatificationAdminGetV2, handleHistoricalRatificationAdminPostV2 } from "@/lib/trader/historical-simulation-v2/ratification-admin-handler-v2";

const routeDeps = vi.hoisted(() => ({
  getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: vi.fn(),
}));
const forbidExtraRuntime = vi.hoisted(() => vi.fn((): never => {
  throw new Error("MUST_NOT_CONSTRUCT_DATABASE_CLIENT");
}));
vi.mock("@/db/postgres-client", async (original) => ({
  ...await original<typeof import("@/db/postgres-client")>(),
  createPerRequestPostgresRuntime: forbidExtraRuntime,
}));
vi.mock("@/lib/trader/admin-route-deps", () => ({
  createProductionAdminRouteDeps: () => routeDeps,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/components/trader/admin-console/shell/admin-console-shell", () => ({
  AdminConsoleShell: () => null,
}));
vi.mock("@/components/trader/admin-console/data/query-provider", () => ({
  AdminQueryProvider: () => null,
}));
vi.mock("@/components/trader/admin-console/data/read-context", () => ({
  AdminReadContextProvider: () => null,
}));
import TraderAdminLayout from "@/app/(trader)/admin/layout";
import { GET as historicalStreamGet } from "@/app/api/trader/admin/historical-v2/stream/route";

const ORGANIZATION_ID = "offline-disposal-org";
const permissions = ["admin.audit.read", "admin.trader.operations.mutate"] as const;

// No database client is constructed. The actual permission resolver executes
// against an inert read executor; only handle ownership/disposal is simulated.
function fixture(options: {
  userId?: string | null;
  role?: "admin" | "user";
  permissionError?: Error;
  invoiceReadError?: Error;
  disposeError?: Error;
} = {}) {
  const reads: string[] = [];
  const db = {
    select() {
      let table: unknown;
      const read = async (): Promise<Record<string, string>[]> => {
        if (table === schema.userPlatformRoles) {
          reads.push("role");
          if (options.permissionError) throw options.permissionError;
          return [{ role: options.role ?? "user" }];
        }
        if (table === schema.organizationMembers) {
          reads.push("membership");
          return [{ id: "offline-member" }];
        }
        if (table === schema.traderInvoices) {
          reads.push("invoices");
          if (options.invoiceReadError) throw options.invoiceReadError;
          return [];
        }
        throw new Error("UNEXPECTED_QUERY");
      };
      const query = {
        from(value: unknown) { table = value; return query; },
        where() { return query; },
        limit: read,
        orderBy: read,
      };
      return query;
    },
  };
  const runtime = { kind: "postgres", db, _sql: { inertResource: true } } as unknown as WaiaRuntimeDb;
  const closeResource = vi.fn(async () => {
    if (options.disposeError) throw options.disposeError;
  });
  const deps: AdminRouteHandlerDeps = {
    getUserId: vi.fn(async () => options.userId === undefined ? "offline-user" : options.userId),
    getRuntimeDb: vi.fn(async () => runtime),
    disposeRuntimeDb: vi.fn(async (value) => {
      if (value === undefined) return;
      expect(value).toBe(runtime);
      await closeResource();
    }),
  };
  return { runtime, deps, closeResource, reads };
}

function invoiceRequest() {
  return new Request(`https://offline.invalid/api/trader/admin/invoices?organization_id=${ORGANIZATION_ID}&exchange_account_id=offline-account`);
}

describe("admin authorization runtime ownership", () => {
  it.each(permissions)("disposes denied %s before returning no owned handle", async (permission) => {
    const f = fixture();
    const result = await authorizeAdminRoute(f.deps, ORGANIZATION_ID, permission);
    expect(result).toEqual({ ok: false, result: {
      status: 403, outcome: "client_error",
      body: { error: { code: "FORBIDDEN", message: "Admin permission required." } },
    } });
    expect(f.deps.getRuntimeDb).toHaveBeenCalledOnce();
    expect(f.closeResource).toHaveBeenCalledOnce();
  });

  it("never acquires a handle for a signed-out request", async () => {
    const f = fixture({ userId: null });
    expect(await authorizeAdminRoute(f.deps, ORGANIZATION_ID)).toMatchObject({ ok: false, result: { status: 401 } });
    expect(f.deps.getRuntimeDb).not.toHaveBeenCalled();
    expect(f.closeResource).not.toHaveBeenCalled();
  });

  it("preserves acquisition failures without attempting disposal", async () => {
    const f = fixture();
    const error = new Error("OFFLINE_ACQUISITION_FAILURE");
    vi.mocked(f.deps.getRuntimeDb).mockRejectedValueOnce(error);
    await expect(authorizeAdminRoute(f.deps, ORGANIZATION_ID)).rejects.toBe(error);
    expect(f.deps.disposeRuntimeDb).not.toHaveBeenCalled();
  });

  it("closes once and preserves a permission-read exception", async () => {
    const error = new Error("OFFLINE_PERMISSION_FAILURE");
    const f = fixture({ permissionError: error });
    await expect(authorizeAdminRoute(f.deps, ORGANIZATION_ID)).rejects.toBe(error);
    expect(f.closeResource).toHaveBeenCalledOnce();
  });

  it("awaits denied-resource cleanup before returning the refusal", async () => {
    const f = fixture();
    let startClosing!: () => void;
    let finishClosing!: () => void;
    const started = new Promise<void>((resolve) => { startClosing = resolve; });
    const finished = new Promise<void>((resolve) => { finishClosing = resolve; });
    f.closeResource.mockImplementationOnce(async () => {
      startClosing();
      await finished;
    });
    let returned = false;
    const pending = authorizeAdminRoute(f.deps, ORGANIZATION_ID).then((result) => {
      returned = true;
      return result;
    });
    await started;
    expect(returned).toBe(false);
    finishClosing();
    expect(await pending).toMatchObject({ ok: false, result: { status: 403 } });
    expect(f.closeResource).toHaveBeenCalledOnce();
  });

  it.each(permissions)("transfers the permitted %s handle without disposing it", async (permission) => {
    const f = fixture({ role: "admin" });
    expect(await authorizeAdminRoute(f.deps, ORGANIZATION_ID, permission)).toEqual({
      ok: true, userId: "offline-user", runtime: f.runtime,
    });
    expect(f.closeResource).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not retry a failed cleanup (permission exception=%s)", async (permissionThrows) => {
    const disposeError = new Error("OFFLINE_DISPOSAL_FAILURE");
    const f = fixture({ disposeError,
      ...(permissionThrows ? { permissionError: new Error("OFFLINE_PERMISSION_FAILURE") } : {}),
    });
    await expect(authorizeAdminRoute(f.deps, ORGANIZATION_ID)).rejects.toBe(disposeError);
    expect(f.closeResource).toHaveBeenCalledOnce();
  });
});

describe("actual admin caller composition", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("invoice denial closes once without reading invoices", async () => {
    const f = fixture();
    const result = await handleAdminInvoicesListGet(invoiceRequest(), f.deps);
    expect(result.status).toBe(403);
    expect(f.closeResource).toHaveBeenCalledOnce();
    expect(f.reads).toEqual(["role", "membership"]);
  });

  it("signed-out invoice request acquires nothing", async () => {
    const f = fixture({ userId: null });
    expect((await handleAdminInvoicesListGet(invoiceRequest(), f.deps)).status).toBe(401);
    expect(f.deps.getRuntimeDb).not.toHaveBeenCalled();
    expect(f.closeResource).not.toHaveBeenCalled();
  });

  it.each(["permission", "invoices"] as const)("invoice %s error preserves refusal and closes once", async (source) => {
    const error = new Error("OFFLINE_READ_FAILURE");
    const f = fixture(source === "permission" ? { permissionError: error } : { role: "admin", invoiceReadError: error });
    expect((await handleAdminInvoicesListGet(invoiceRequest(), f.deps)).status).toBe(400);
    expect(f.closeResource).toHaveBeenCalledOnce();
  });

  it("successful invoice read keeps its existing response and closes once", async () => {
    const f = fixture({ role: "admin" });
    expect(await handleAdminInvoicesListGet(invoiceRequest(), f.deps)).toEqual({
      status: 200, body: { invoices: [] }, outcome: "success", waiaDbBackend: "postgres",
    });
    expect(f.closeResource).toHaveBeenCalledOnce();
  });

  function bindPageDeps(f: ReturnType<typeof fixture>) {
    routeDeps.getUserId.mockImplementation(f.deps.getUserId);
    routeDeps.getRuntimeDb.mockImplementation(f.deps.getRuntimeDb);
    routeDeps.disposeRuntimeDb.mockImplementation(f.deps.disposeRuntimeDb);
  }

  it("the layout does not close a denied handle a second time", async () => {
    const f = fixture(); bindPageDeps(f);
    await expect(TraderAdminLayout({ children: "protected" })).rejects.toThrow("NOT_FOUND");
    expect(f.closeResource).toHaveBeenCalledOnce();
  });

  it("the layout still owns and closes the granted handle", async () => {
    const f = fixture({ role: "admin" }); bindPageDeps(f);
    await expect(TraderAdminLayout({ children: "protected" })).resolves.toBeDefined();
    expect(f.closeResource).toHaveBeenCalledOnce();
  });

  it("the layout redirects a signed-out visitor without acquiring a handle", async () => {
    const f = fixture({ userId: null }); bindPageDeps(f);
    await expect(TraderAdminLayout({ children: "protected" })).rejects.toThrow("REDIRECT:/");
    expect(f.deps.getRuntimeDb).not.toHaveBeenCalled();
    expect(f.closeResource).not.toHaveBeenCalled();
  });

  it.each(["launch", "review", "ratify"] as const)("historical %s denial closes once without opening another runtime", async (kind) => {
    const f = fixture();
    const open = vi.fn((): never => { throw new Error("MUST_NOT_OPEN_DOMAIN_RUNTIME"); });
    const request = new Request(`https://offline.invalid/api?organization_id=${ORGANIZATION_ID}&run_id=offline-run&release_sha=${"a".repeat(40)}`, { method: kind === "review" ? "GET" : "POST" });
    const result = kind === "launch"
      ? await handleHistoricalSimulationAdminLaunchPostV2(request, { ...f.deps, openLifecycle: open })
      : kind === "review"
        ? await handleHistoricalRatificationAdminGetV2(request, { ...f.deps, openRatification: open })
        : await handleHistoricalRatificationAdminPostV2(request, { ...f.deps, openRatification: open });
    expect(result.status).toBe(403);
    expect(f.closeResource).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it("historical stream denial closes once and does not acquire a stream client", async () => {
    const f = fixture(); bindPageDeps(f);
    const result = await historicalStreamGet(new Request(`https://offline.invalid/api?organization_id=${ORGANIZATION_ID}&run_id=offline-run`));
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(f.closeResource).toHaveBeenCalledOnce();
    expect(f.deps.getRuntimeDb).toHaveBeenCalledOnce();
    expect(forbidExtraRuntime).not.toHaveBeenCalled();
  });
});
