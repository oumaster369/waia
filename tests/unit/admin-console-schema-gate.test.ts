import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetAdminConsoleSchemaProbeForTests } from "@/lib/trader/admin-console/schema-probe";
import { consoleSchemaGate, HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";

const execute = vi.hoisted(() => vi.fn());
const runtimeEnd = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/trader/admin-console/auth", () => ({
  authorizeFleetAdmin: vi.fn(async () => ({
    ok: true,
    userId: "00000000-0000-4000-8000-000000000001",
    contextOrgId: "00000000-0000-4000-8000-000000000002",
    runtime: {
      kind: "postgres",
      db: {
        execute,
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute }),
      },
    },
  })),
  assertAdminConsoleSameOrigin: () => null,
}));

vi.mock("@/db/postgres-client", () => ({
  createPerRequestPostgresRuntime: () => ({
    kind: "postgres",
    db: { execute, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute }) },
    _sql: { end: runtimeEnd },
  }),
}));

function texts(value: unknown, seen = new Set<unknown>(), out: string[] = []): string[] {
  if (value == null || seen.has(value)) return out;
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (typeof value !== "object") return out;
  seen.add(value);
  for (const item of Object.values(value)) texts(item, seen, out);
  return out;
}

const row = {
  id: "inv-1",
  organization_id: "org-1",
  exchange_account_id: "acct-1",
  status: "DRAFT",
  performance_fee: "1.00",
  currency: "USDT",
  name: "Клиент",
  owner_email: "owner@example.com",
  registered_at: "2026-01-01T00:00:00.000Z",
  entitlement_enabled: true,
  has_invoice: true,
  has_credential: true,
  has_debt: false,
  has_open_lots: false,
  first_connected_at: null,
  invoice_id: "inv-1",
  reason: "спор",
  opened_at: "2026-01-02T00:00:00.000Z",
  resolved_at: null,
};

function installDb(): void {
  execute.mockImplementation(async (query: unknown) => {
    const blob = texts(query).join(" ");
    if (blob.includes("string_agg"))
      return [{ currency: "USDT", total: 1, amount: "1.00", digest: "fixture" }];
    if (blob.includes("pg_snapshot_xmin")) return [{ xmin: "42" }];
    if (blob.includes("to_regclass")) {
      const missing =
        blob.includes("trader_admin_") || blob.includes("trader_human_promotion_proposal_v2");
      return [{ present: !missing }];
    }
    return [row];
  });
}

const deps: AdminRouteHandlerDeps = {
  getUserId: async () => "00000000-0000-4000-8000-000000000001",
  getRuntimeDb: async () => {
    throw new Error("runtime comes from the auth mock");
  },
  disposeRuntimeDb: async () => undefined,
};

describe("admin console schema gate on a 0210 database", () => {
  beforeEach(() => {
    resetAdminConsoleSchemaProbeForTests();
    execute.mockReset();
    runtimeEnd.mockClear();
    installDb();
  });

  it("classifies invoices, disputes, and clients as ready without 0212 or 0214", () => {
    expect(consoleSchemaGate(HANDLER_TABLES.invoices)).toBe("ready-on-0210");
    expect(consoleSchemaGate(HANDLER_TABLES.disputes)).toBe("ready-on-0210");
    expect(consoleSchemaGate(HANDLER_TABLES.clients)).toBe("ready-on-0210");
    expect(consoleSchemaGate(HANDLER_TABLES.exportInvoices)).toBe("ready-on-0210");
    expect(consoleSchemaGate(HANDLER_TABLES.incidents)).toBe("waits-0214");
    expect(consoleSchemaGate(HANDLER_TABLES.proposals)).toBe("waits-0212");
  });

  it("returns invoice, dispute, and client rows when 0212 and 0214 tables are absent", async () => {
    const { handleAdminConsoleInvoicesGet } =
      await import("@/lib/trader/admin-console/handlers/invoices");
    const { handleAdminConsoleDisputesGet } =
      await import("@/lib/trader/admin-console/handlers/disputes");
    const { handleAdminConsoleClientsGet } =
      await import("@/lib/trader/admin-console/handlers/clients");
    const invoices = await handleAdminConsoleInvoicesGet(
      new Request("http://localhost/api/trader/admin/console/invoices"),
      deps,
    );
    const disputes = await handleAdminConsoleDisputesGet(
      new Request("http://localhost/api/trader/admin/console/disputes"),
      deps,
    );
    const clients = await handleAdminConsoleClientsGet(
      new Request("http://localhost/api/trader/admin/console/clients"),
      deps,
    );
    for (const result of [invoices, disputes, clients]) {
      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body)).not.toContain("ADMIN_CONSOLE_SCHEMA_NOT_APPLIED");
      expect(JSON.stringify(result.body)).toContain("inv-1");
    }
  });

  it("returns SCHEMA_NOT_APPLIED when the handler needs a 0214 table", async () => {
    const { handleAdminConsoleIncidentsGet } =
      await import("@/lib/trader/admin-console/handlers/incidents");
    const incidents = await handleAdminConsoleIncidentsGet(
      new Request("http://localhost/api/trader/admin/console/incidents"),
      deps,
    );
    expect(incidents.status).toBe(200);
    expect(JSON.stringify(incidents.body)).toContain("ADMIN_CONSOLE_SCHEMA_NOT_APPLIED");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("admin collectors skip a database without 0214 tables", () => {
  beforeEach(() => {
    resetAdminConsoleSchemaProbeForTests();
    execute.mockReset();
    runtimeEnd.mockClear();
    execute.mockResolvedValue([{ present: false }]);
  });

  it("logs schema_not_applied and does not write", async () => {
    const previous = process.env.DATABASE_URL_POSTGRES;
    const fetchImpl = vi.fn();
    const log = vi.fn();
    try {
      const { runDueAdminCollectors } =
        await import("@/lib/trader/admin-console/collectors/run-due");
      const result = await runDueAdminCollectors(
        {
          WAIA_ADMIN_CONSOLE_COLLECTORS_ENABLED: "1",
          DATABASE_URL_POSTGRES: "postgresql://schema-gate-test.invalid/unused",
        },
        { log, fetchImpl, now: new Date("2026-09-24T12:35:00.000Z") },
      );
      expect(result).toEqual({ ran: [], failed: [] });
      expect(log).toHaveBeenCalledWith("schema_not_applied");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(runtimeEnd).toHaveBeenCalled();
      const sqlText = execute.mock.calls.map((call) => texts(call[0]).join(" ")).join("\n");
      expect(sqlText).toContain("to_regclass");
      expect(sqlText).not.toMatch(/INSERT|UPDATE|DELETE/i);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL_POSTGRES;
      else process.env.DATABASE_URL_POSTGRES = previous;
    }
  });
});
