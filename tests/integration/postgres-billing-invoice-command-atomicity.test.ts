import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { sql as query } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { seedWp13User } from "./wp13-intelligence-test-helpers";
import { handleAdminInvoiceCommandPost } from "@/lib/trader/billing/admin-route-handler";
import { handleAdminConsoleInvoiceCommandPost } from "@/lib/trader/admin-console/handlers/invoice-commands";
import { INVOICE_SELECT, invoiceReadRevision } from "@/lib/trader/admin-console/repositories/invoices.postgres";
import { createPostgresHwmLedgerService } from "@/lib/trader/billing/hwm-ledger-service";
import { createPostgresReportingPeriodLifecycleService } from "@/lib/trader/billing/reporting-period-lifecycle-service";
import { createPostgresDraftInvoiceService } from "@/lib/trader/billing/draft-invoice-service";
import { createPostgresInvoiceIssuanceService } from "@/lib/trader/billing/invoice-issuance-service";
import { ISSUANCE_ATTESTATION_KEYS } from "@/lib/trader/billing/invoice-issuance.types";
import type { IssuanceAttestation } from "@/lib/trader/billing/invoice-issuance.types";
import { billingV2PeriodCloseEvidence } from "@/tests/helpers/billing-v2-period-close-evidence";
import { lockInvoiceCommandAccountPostgres } from "@/lib/trader/billing/invoice-command-lock-postgres";
import { traderAuditActions } from "@/lib/trader/types";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES;
const attestations = Object.fromEntries(ISSUANCE_ATTESTATION_KEYS.map((key) => [key, true])) as IssuanceAttestation;
const start = new Date("2026-01-01T00:00:00.000Z");

describe.skipIf(!enabled)("DEE-1112 actual PostgreSQL invoice commands", () => {
  let sql: postgres.Sql;
  let orgId: string;
  let otherOrg: string;
  const adminId = randomUUID();
  const memberId = randomUUID();
  beforeAll(async () => {
    if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
      throw new Error("DEE1112_NATIVE_TESTS_REQUIRE_LOOPBACK_POSTGRES");
    }
    sql = postgres(url, { max: 2, onnotice: () => {} });
    orgId = await seedWp13User(url, adminId, "DEE-1112 synthetic invoice admin");
    otherOrg = await seedWp13User(url, memberId, "DEE-1112 synthetic invoice member");
    await sql`UPDATE user_platform_roles SET role = 'admin' WHERE user_id = ${adminId}::uuid`;
  });
  afterAll(async () => { await removeFault(); await sql?.end({ timeout: 5 }); vi.unstubAllEnvs(); });

  async function draft(account: string = randomUUID(), month = 1) {
    const db = drizzle(sql, { schema });
    const context = { organizationId: orgId };
    const hwm = createPostgresHwmLedgerService(db);
    if (!await hwm.getCurrentHwm(context, account)) await hwm.bootstrapHwm(context, {
      exchangeAccountId: account, initialHwm: "0", valuationSource: "DEE1112-synthetic", effectiveAt: start,
    });
    const periodStart = new Date(Date.UTC(2026, month - 1, 1));
    const periodEnd = new Date(Date.UTC(2026, month, 1) - 1);
    const lifecycle = createPostgresReportingPeriodLifecycleService(db);
    await lifecycle.openReportingPeriod(context, { exchangeAccountId: account, periodStart,
      startingEquity: "10000", openPositionsSnapshotRef: "DEE1112-synthetic", valuationSource: "DEE1112-synthetic", startingSnapshotAt: periodStart });
    const period = await lifecycle.closeReportingPeriod(context, billingV2PeriodCloseEvidence({
      organizationId: orgId, accountId: account, periodStart, periodEnd,
      realizedPnl: "100", unrealizedPnl: "0", endingEquity: "10100",
    }));
    const invoice = await createPostgresDraftInvoiceService(db).getDraftInvoiceByPeriod(context, account, period.id);
    if (!invoice) throw new Error("fixture draft missing");
    return invoice;
  }
  async function approvePast(invoiceId: string) {
    // Trusted internal fixture clock; HTTP caller never chooses cooling-off or timestamps.
    await createPostgresInvoiceIssuanceService(drizzle(sql, { schema })).approveInvoiceIssuance(
      { organizationId: orgId, userId: adminId },
      { invoiceId, attestations, approvedAt: new Date(Date.now() - 60_000), coolingOffMs: 1 });
  }
  async function revision(invoiceId: string) {
    const rows = await drizzle(sql, { schema }).execute(query`SELECT ${INVOICE_SELECT} FROM trader_invoices i WHERE i.id = ${invoiceId}::uuid`);
    return invoiceReadRevision(rows[0]);
  }
  async function invoke(invoiceId: string, body: Record<string, unknown>, opts: {
    userId?: string; org?: string; name?: string; console?: boolean; expectedRevision?: string; repeatableReadDefault?: boolean;
  } = {}) {
    const client = postgres(url!, { max: 1, connection: { application_name: opts.name ?? "dee1112-invoice" } });
    if (opts.repeatableReadDefault) await client.unsafe("SET default_transaction_isolation TO 'repeatable read'");
    const runtime = { kind: "postgres" as const, db: drizzle(client, { schema }) };
    const deps = { getUserId: async () => opts.userId ?? adminId, getRuntimeDb: async () => runtime,
      disposeRuntimeDb: async () => { await client.end({ timeout: 5 }); } };
    const request = new Request("http://localhost/api/trader/admin/invoice", { method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ organization_id: opts.org ?? orgId, ...body,
        ...(opts.console ? { expectedRevision: opts.expectedRevision, ...(body.command === "issue" ? { confirmed: true } : {}) } : {}) }) });
    try { return opts.console
      ? await handleAdminConsoleInvoiceCommandPost(request, deps, invoiceId)
      : await handleAdminInvoiceCommandPost(request, deps, invoiceId);
    } finally { await client.end({ timeout: 5 }); }
  }
  async function snapshot(account: string) {
    return {
      invoices: [...await sql`SELECT id, status, record_content_digest, issuance_approved_at, issuance_approved_by, cooling_off_until, issued_at, issued_by
        FROM trader_invoices WHERE organization_id = ${orgId}::uuid AND exchange_account_id = ${account} ORDER BY id`],
      hwm: [...await sql`SELECT id, high_water_mark, previous_high_water_mark, source_invoice_id, record_content_digest
        FROM trader_hwm_ledger WHERE organization_id = ${orgId}::uuid AND exchange_account_id = ${account} ORDER BY id`],
      audits: [...await sql`SELECT a.id, a.action, a.metadata_json FROM audit_logs a
        WHERE a.organization_id = ${orgId}::uuid AND a.entity_id IN (SELECT id::text FROM trader_invoices
          WHERE organization_id = ${orgId}::uuid AND exchange_account_id = ${account}) ORDER BY a.id`],
    };
  }
  async function removeFault() {
    if (!sql) return;
    for (const table of ["audit_logs", "trader_invoices", "trader_hwm_ledger"]) {
      await sql.unsafe(`DROP TRIGGER IF EXISTS dee1112_invoice_fault ON ${table}`);
    }
    await sql.unsafe("DROP FUNCTION IF EXISTS dee1112_invoice_fault()");
  }
  async function inject(table: "audit_logs" | "trader_invoices" | "trader_hwm_ledger", timing: "BEFORE" | "AFTER", action?: string) {
    if (!/^[a-f0-9-]{36}$/.test(orgId) || (action && !/^[a-z._]+$/.test(action))) throw new Error("Invalid fixture fault");
    await sql.unsafe(`CREATE FUNCTION dee1112_invoice_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.organization_id = '${orgId}'::uuid ${action ? `AND NEW.action = '${action}'` : table === "trader_invoices" ? "AND NEW.status = 'ISSUED'" : "AND NEW.entry_type = 'RATCHET_UP'"}
      THEN RAISE EXCEPTION 'DEE1112_INVOICE_FAILURE'; END IF; RETURN NEW; END $$`);
    await sql.unsafe(`CREATE TRIGGER dee1112_invoice_fault ${timing} ${table === "trader_invoices" ? "UPDATE" : "INSERT"}
      ON ${table} FOR EACH ROW EXECUTE FUNCTION dee1112_invoice_fault()`);
  }

  for (const command of ["approve", "cancel-pending"] as const) {
    for (const timing of ["BEFORE", "AFTER"] as const) {
      it(`rolls back ${command} metadata when its ${timing} audit fails; valid retry creates one audit`, async () => {
        const invoice = await draft();
        if (command === "cancel-pending") await approvePast(invoice.id);
        const before = await snapshot(invoice.exchangeAccountId);
        const action = command === "approve" ? traderAuditActions.invoiceIssuanceApproved : traderAuditActions.invoiceIssuanceCancelled;
        await inject("audit_logs", timing, action);
        try {
          expect(JSON.stringify(await invoke(invoice.id, { command, attestations, reason: "synthetic cancellation" }))).toContain("DEE1112_INVOICE_FAILURE");
          expect(await snapshot(invoice.exchangeAccountId)).toEqual(before);
        } finally { await removeFault(); }
        expect((await invoke(invoice.id, { command, attestations, reason: "synthetic cancellation" })).status).toBe(200);
        const after = await snapshot(invoice.exchangeAccountId);
        expect(after.hwm).toEqual(before.hwm);
        expect(after.audits.filter((a) => a.action === action)).toHaveLength(1);
        expect(after.invoices[0].issuance_approved_at === null).toBe(command === "cancel-pending");
      });
    }
  }
  for (const fault of [
    { table: "trader_invoices", timing: "AFTER" },
    { table: "trader_hwm_ledger", timing: "BEFORE" },
    { table: "trader_hwm_ledger", timing: "AFTER" },
    { table: "audit_logs", timing: "BEFORE", action: traderAuditActions.invoiceIssued },
    { table: "audit_logs", timing: "AFTER", action: traderAuditActions.invoiceIssued },
  ] as const) {
    it(`rolls back issue on ${fault.table} ${fault.timing} failure and retries without duplicate effects`, async () => {
      const invoice = await draft(); await approvePast(invoice.id);
      const before = await snapshot(invoice.exchangeAccountId);
      await inject(fault.table, fault.timing, "action" in fault ? fault.action : undefined);
      try {
        expect(JSON.stringify(await invoke(invoice.id, { command: "issue" }))).toContain("DEE1112_INVOICE_FAILURE");
        expect(await snapshot(invoice.exchangeAccountId)).toEqual(before);
      } finally { await removeFault(); }
      expect((await invoke(invoice.id, { command: "issue" })).status).toBe(200);
      const after = await snapshot(invoice.exchangeAccountId);
      expect(after.invoices[0].status).toBe("ISSUED");
      expect(after.hwm.filter((h) => h.source_invoice_id === invoice.id)).toHaveLength(1);
      expect(after.audits.filter((a) => a.action === traderAuditActions.invoiceIssued)).toHaveLength(1);
      expect((await invoke(invoice.id, { command: "issue" })).status).toBe(200);
      expect(await snapshot(invoice.exchangeAccountId)).toEqual(after);
    });
  }
  it("requires literal manual booleans, refuses caller delay, and preserves server cooling-off", async () => {
    const invoice = await draft(); const before = await snapshot(invoice.exchangeAccountId);
    for (const value of ["true", "false", 1, null, [], undefined]) {
      expect((await invoke(invoice.id, { command: "approve", attestations: { ...attestations, depositsVerified: value } })).status).toBe(400);
    }
    for (const cooling_off_ms of [0, -1, 1, null, "1"]) {
      expect((await invoke(invoice.id, { command: "approve", attestations, cooling_off_ms })).status).toBe(400);
    }
    expect(await snapshot(invoice.exchangeAccountId)).toEqual(before);
    vi.stubEnv("TRADER_INVOICE_ISSUANCE_COOLING_OFF_MS", "120000");
    try {
      expect((await invoke(invoice.id, { command: "approve", attestations })).status).toBe(200);
      const after = await snapshot(invoice.exchangeAccountId);
      expect(new Date(after.invoices[0].cooling_off_until).getTime() - new Date(after.invoices[0].issuance_approved_at).getTime()).toBe(120000);
      expect(JSON.stringify(await invoke(invoice.id, { command: "issue" }))).toContain("IssuanceCoolingOffNotElapsedError");
      expect(await snapshot(invoice.exchangeAccountId)).toEqual(after);
    } finally { vi.unstubAllEnvs(); }
  });
  it("refuses foreign-org invoice and non-admin without changing records", async () => {
    const invoice = await draft(); const before = await snapshot(invoice.exchangeAccountId);
    expect((await invoke(invoice.id, { command: "approve", attestations }, { org: otherOrg })).status).toBe(404);
    expect((await invoke(invoice.id, { command: "approve", attestations }, { userId: memberId })).status).toBe(403);
    expect(await snapshot(invoice.exchangeAccountId)).toEqual(before);
  });

  for (const consoleSurface of [false, true]) {
    it(`commits stale approval invalidation on ${consoleSurface ? "console" : "legacy"} after a different invoice advances HWM`, async () => {
      const first = await draft(); const second = await draft(first.exchangeAccountId, 2);
      await approvePast(first.id); await approvePast(second.id);
      const expectedRevision = await revision(second.id);
      expect((await invoke(first.id, { command: "issue" })).status).toBe(200);
      const before = await snapshot(first.exchangeAccountId);
      const result = await invoke(second.id, { command: "issue" }, { console: consoleSurface, expectedRevision });
      expect(result.status).toBe(400);
      expect(JSON.stringify(result)).toMatch(/DraftInvoiceDigestMismatchError|IssuanceHwmInconsistentError/);
      const after = await snapshot(first.exchangeAccountId);
      expect(after.hwm).toEqual(before.hwm);
      expect(after.audits).toEqual(before.audits);
      const refused = after.invoices.find((i) => i.id === second.id)!;
      expect(refused.status).toBe("DRAFT");
      expect(refused.issuance_approved_at).toBeNull();
      expect(refused.cooling_off_until).toBeNull();
    });
  }
  it("preserves console revision refusal before any effect", async () => {
    const invoice = await draft(); await approvePast(invoice.id);
    const before = await snapshot(invoice.exchangeAccountId);
    expect((await invoke(invoice.id, { command: "issue" }, { console: true, expectedRevision: "stale" })).status).toBe(409);
    expect(await snapshot(invoice.exchangeAccountId)).toEqual(before);
  });

  for (const consoleSurface of [false, true]) {
    it(`keeps ${consoleSurface ? "console" : "legacy"} cancellation available when the HWM anchor is missing`, async () => {
      const invoice = await draft(); await approvePast(invoice.id);
      // Deliberately corrupt only this random synthetic account's fixture. No
      // production data or protective trigger is changed/bypassed.
      await sql`DELETE FROM trader_hwm_ledger WHERE organization_id = ${orgId}::uuid
        AND exchange_account_id = ${invoice.exchangeAccountId} AND entry_type = 'BOOTSTRAP'`;
      const before = await snapshot(invoice.exchangeAccountId);
      const expectedRevision = await revision(invoice.id);
      expect((await invoke(invoice.id, { command: "cancel-pending", reason: "synthetic missing-anchor cancellation" },
        { console: consoleSurface, expectedRevision })).status).toBe(200);
      const after = await snapshot(invoice.exchangeAccountId);
      expect(after.hwm).toEqual(before.hwm);
      expect(after.invoices[0].status).toBe("DRAFT");
      expect(after.invoices[0].issuance_approved_at).toBeNull();
      expect(after.invoices[0].cooling_off_until).toBeNull();
      expect(after.audits.filter((a) => a.action === traderAuditActions.invoiceIssuanceCancelled)).toHaveLength(1);
    });
  }
  it("refuses a missing stable HWM anchor instead of proceeding without an account lock", async () => {
    await expect(drizzle(sql, { schema }).transaction((tx) =>
      lockInvoiceCommandAccountPostgres(tx, orgId, randomUUID())))
      .rejects.toMatchObject({ code: "HWM_LEDGER_NOT_BOOTSTRAPPED" });
  });

  async function race(invoiceIds: string[], crossSurface: boolean, accountLock: boolean, commands = ["issue", "issue"]) {
    const gate = postgres(url!, { max: 1 });
    let release!: () => void; const released = new Promise<void>((resolve) => { release = resolve; });
    let ready!: () => void; const locked = new Promise<void>((resolve) => { ready = resolve; });
    const gateTx = gate.begin(async (tx) => {
      if (accountLock) await tx`SELECT id FROM trader_hwm_ledger WHERE organization_id = ${orgId}::uuid
        AND exchange_account_id = (SELECT exchange_account_id FROM trader_invoices WHERE id = ${invoiceIds[0]}::uuid)
        AND entry_type = 'BOOTSTRAP' FOR UPDATE`;
      else await tx`SELECT id FROM trader_invoices WHERE id = ${invoiceIds[0]}::uuid FOR UPDATE`;
      ready(); await released;
    });
    await locked;
    const expectedRevision = crossSurface ? await revision(invoiceIds[1]) : undefined;
    const pending = invoiceIds.map((id, i) => invoke(id, { command: commands[i], ...(commands[i] === "cancel-pending" ? { reason: "synthetic concurrent cancellation" } : {}) }, {
      name: `dee1112-invoice-race-${i}`, repeatableReadDefault: true, console: crossSurface && i === 1, expectedRevision,
    }));
    try {
      let count = 0;
      for (let attempt = 0; attempt < 150; attempt++) {
        const rows = await sql`SELECT pid FROM pg_stat_activity WHERE application_name IN ('dee1112-invoice-race-0', 'dee1112-invoice-race-1') AND wait_event_type = 'Lock'`;
        count = new Set(rows.map((r) => r.pid)).size;
        if (count === 2) break;
        await delay(20);
      }
      expect(count, "both distinct command connections must really contend").toBe(2);
    } finally { release(); await gateTx; await gate.end({ timeout: 5 }); }
    return Promise.all(pending);
  }
  it("serializes concurrent legacy retries for one invoice into one ratchet and audit", async () => {
    const invoice = await draft(); await approvePast(invoice.id);
    expect((await race([invoice.id, invoice.id], false, false)).map((r) => r.status)).toEqual([200, 200]);
    const after = await snapshot(invoice.exchangeAccountId);
    expect(after.hwm.filter((h) => h.source_invoice_id === invoice.id)).toHaveLength(1);
    expect(after.audits.filter((a) => a.action === traderAuditActions.invoiceIssued)).toHaveLength(1);
  });
  it("serializes competing issue and cancellation on the same invoice", async () => {
    const invoice = await draft(); await approvePast(invoice.id);
    const results = await race([invoice.id, invoice.id], false, false, ["cancel-pending", "issue"]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const after = await snapshot(invoice.exchangeAccountId);
    const issued = after.invoices[0].status === "ISSUED";
    expect(after.hwm.filter((h) => h.source_invoice_id)).toHaveLength(issued ? 1 : 0);
    expect(after.audits.filter((a) => a.action === traderAuditActions.invoiceIssued)).toHaveLength(issued ? 1 : 0);
    expect(after.audits.filter((a) => a.action === traderAuditActions.invoiceIssuanceCancelled)).toHaveLength(issued ? 0 : 1);
    if (!issued) expect(after.invoices[0].issuance_approved_at).toBeNull();
    expect(JSON.stringify(results)).toMatch(/IssuanceAlreadyIssuedError|IssuanceApprovalRequiredError/);
  });
  it("coordinates legacy and console issuance for different invoices on one account, then invalidates stale approval", async () => {
    const first = await draft(); const second = await draft(first.exchangeAccountId, 2);
    await approvePast(first.id); await approvePast(second.id);
    const results = await race([first.id, second.id], true, true);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const after = await snapshot(first.exchangeAccountId);
    expect(after.invoices.filter((i) => i.status === "ISSUED")).toHaveLength(1);
    expect(after.hwm.filter((h) => h.source_invoice_id)).toHaveLength(1);
    expect(after.audits.filter((a) => a.action === traderAuditActions.invoiceIssued)).toHaveLength(1);
    const refused = after.invoices.find((i) => i.status === "DRAFT")!;
    expect(refused.issuance_approved_at).toBeNull();
    expect(refused.cooling_off_until).toBeNull();
    expect(JSON.stringify(results)).toMatch(/DraftInvoiceDigestMismatchError|IssuanceHwmInconsistentError/);
  });
});
