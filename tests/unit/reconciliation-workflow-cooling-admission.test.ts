import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReconciliationWorkflowHandlerDeps } from "@/lib/trader/settlement/reconciliation/reconciliation-workflow-handler";
import {
  createReconciliationCommandMemory,
  RECONCILIATION_TEST_NOW,
  RECONCILIATION_TEST_USER,
} from "@/tests/helpers/reconciliation-command-memory";

const ports = vi.hoisted(() => ({ current: null as ReturnType<typeof createReconciliationCommandMemory> | null }));
vi.mock("@/lib/trader/settlement/reconciliation/reconciliation-case-repository-postgres", () => ({
  createPostgresReconciliationCaseRepository: () => ports.current!.caseRepository,
}));
vi.mock("@/lib/trader/settlement/reconciliation/reconciliation-case-repository-sqlite", () => ({
  createSqliteReconciliationCaseRepository: () => ports.current!.caseRepository,
}));
vi.mock("@/lib/trader/settlement/account-status-repository-postgres", () => ({
  createPostgresInvoiceSettlementRepository: () => ports.current!.invoiceSettlementRepository,
  createPostgresAccountStatusRepository: () => ports.current!.accountStatusRepository,
}));
vi.mock("@/lib/trader/settlement/account-status-repository-sqlite", () => ({
  createSqliteInvoiceSettlementRepository: () => ports.current!.invoiceSettlementRepository,
  createSqliteAccountStatusRepository: () => ports.current!.accountStatusRepository,
}));
vi.mock("@/lib/trader/settlement/settlement-applications-repository-postgres", () => ({
  createPostgresSettlementApplicationsRepository: () => ports.current!.settlementApplicationsRepository,
}));
vi.mock("@/lib/trader/settlement/settlement-applications-repository-sqlite", () => ({
  createSqliteSettlementApplicationsRepository: () => ports.current!.settlementApplicationsRepository,
}));
vi.mock("@/lib/trader/audit/write", () => ({
  writeTraderAuditLogPostgres: (_db: unknown, input: Parameters<ReturnType<typeof createReconciliationCommandMemory>["writeAudit"]>[0]) => ports.current!.writeAudit(input),
  writeTraderAuditLogSqlite: (_db: unknown, input: Parameters<ReturnType<typeof createReconciliationCommandMemory>["writeAudit"]>[0]) => ports.current!.writeAudit(input),
}));

import { handleReconciliationWorkflowCommand } from "@/lib/trader/settlement/reconciliation/reconciliation-workflow-handler";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(RECONCILIATION_TEST_NOW); vi.stubEnv("TRADER_RECONCILIATION_COOLING_OFF_MS", ""); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

function fixture(kind: "sqlite" | "postgres", amount = "30") {
  const memory = createReconciliationCommandMemory("30", amount); ports.current = memory;
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)) };
  const runtime = { kind, db };
  const deps = {
    getUserId: vi.fn(async (): Promise<string | null> => RECONCILIATION_TEST_USER),
    hasTraderAccess: vi.fn(async () => true), getRuntimeDb: vi.fn(async () => runtime),
    disposeRuntimeDb: vi.fn(async () => undefined),
  };
  const body = { expectedLastEventSeq: 3, idempotencyKey: "propose", resolutionType: "MANUAL_APPLY",
    targetInvoiceId: memory.invoice.id, rationale: "Synthetic manual review" };
  async function command(name: "propose" | "execute", value: unknown, raw = false) {
    const request = new Request("http://localhost/api/trader/settlement-reconciliation/cases/test/" + name, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: raw ? value as string : JSON.stringify(value),
    });
    return handleReconciliationWorkflowCommand(memory.caseId, name, request, deps as unknown as ReconciliationWorkflowHandlerDeps);
  }
  function executeBody() {
    const state = memory.readCase();
    return { expectedLastEventSeq: state.lastEventSeq, idempotencyKey: "execute",
      decisionId: state.currentDecisionId, confirmToken: "synthetic-confirmation" };
  }
  return { ...memory, runtime, db, deps, body, command, executeBody };
}

describe.each(["sqlite", "postgres"] as const)("reconciliation %s HTTP cooling admission", (kind) => {
  it.each([0, -1, 1, 900000, 1e100, null, "0", false, true, {}, []])("rejects supplied coolingOffMs=%j before runtime/effects", async (value) => {
    const f = fixture(kind);
    const result = await f.command("propose", { ...f.body, coolingOffMs: value });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "COOLING_OFF_OVERRIDE_FORBIDDEN" } });
    expect(f.deps.getRuntimeDb).not.toHaveBeenCalled();
    expect(f.caseRepository.findById).not.toHaveBeenCalled();
    expect(f.events).toHaveLength(3); expect(f.audits).toHaveLength(0); expect(f.applications).toHaveLength(0);
  });
  it("rejects a raw JSON number that parses to Infinity before runtime", async () => {
    const f = fixture(kind);
    const raw = JSON.stringify(f.body).replace(/}$/, ',"coolingOffMs":1e400}');
    expect((await f.command("propose", raw, true)).status).toBe(400);
    expect(f.deps.getRuntimeDb).not.toHaveBeenCalled();
    expect(f.audits).toHaveLength(0);
  });
  it.each(["", "600000", "0"])("omitted field retains server configuration %j and real manual execution guards", async (env) => {
    vi.stubEnv("TRADER_RECONCILIATION_COOLING_OFF_MS", env);
    const f = fixture(kind);
    const proposal = await f.command("propose", f.body);
    expect(proposal.status).toBe(200);
    const delay = env === "600000" ? 600000 : 900000;
    expect(f.readCase().coolingOffUntil!.getTime()).toBe(RECONCILIATION_TEST_NOW.getTime() + delay);
    expect(f.invoice.performanceFee).toBe("30"); expect(f.applications).toHaveLength(0);
    expect((await f.command("execute", f.executeBody())).status).toBe(409);
    expect(f.invoiceSettlementRepository.markInvoicePaid).not.toHaveBeenCalled();
    vi.setSystemTime(RECONCILIATION_TEST_NOW.getTime() + delay);
    expect((await f.command("execute", { ...f.executeBody(), confirmToken: "" })).status).toBe(409);
    expect((await f.command("execute", { ...f.executeBody(), decisionId: "wrong" })).status).toBe(409);
    expect((await f.command("execute", f.executeBody())).status).toBe(200);
    expect(f.readCase().status).toBe("RESOLVED"); expect(f.invoice.performanceFee).toBe("30");
    expect(f.applications).toHaveLength(1); expect(f.invoice.settledAmount).toBe("30");
    expect((await f.command("execute", f.executeBody())).status).toBe(200);
    expect(f.applications).toHaveLength(1); expect(f.invoiceSettlementRepository.markInvoicePaid).toHaveBeenCalledTimes(1);
    expect(f.deps.disposeRuntimeDb).toHaveBeenLastCalledWith(f.runtime);
    if (kind === "postgres") expect(f.db.transaction).toHaveBeenCalled();
  });
  it("accepts equivalent source decimal representation through proposal and execution", async () => {
    const f = fixture(kind, "30.000000");
    expect((await f.command("propose", f.body)).status).toBe(200);
    vi.setSystemTime(RECONCILIATION_TEST_NOW.getTime() + 900000);
    expect((await f.command("execute", f.executeBody())).status).toBe(200);
    expect(f.invoice.performanceFee).toBe("30"); expect(f.invoice.settledAmount).toBe("30");
    expect(f.applications).toHaveLength(1);
  });
  it("keeps authentication and entitlement precedence before rejecting the field", async () => {
    const f = fixture(kind);
    f.deps.getUserId.mockResolvedValue(null);
    expect((await f.command("propose", { ...f.body, coolingOffMs: 0 })).status).toBe(401);
    f.deps.getUserId.mockResolvedValue(RECONCILIATION_TEST_USER); f.deps.hasTraderAccess.mockResolvedValue(false);
    expect((await f.command("propose", { ...f.body, coolingOffMs: 0 })).status).toBe(403);
    expect(f.deps.getRuntimeDb).not.toHaveBeenCalled(); expect(f.audits).toHaveLength(0);
  });
  it("retains scoped missing-case, stale-version and lease-holder refusals", async () => {
    const f = fixture(kind);
    expect((await f.command("propose", { ...f.body, expectedLastEventSeq: 2 })).status).toBe(409);
    vi.mocked(f.caseRepository.findById).mockResolvedValueOnce({ ...f.readCase(), assignedTo: "other-operator" });
    expect((await f.command("propose", f.body)).status).toBe(409);
    vi.mocked(f.caseRepository.findById).mockResolvedValueOnce(null);
    expect((await f.command("propose", f.body)).status).toBe(404);
    expect(f.audits).toHaveLength(0); expect(f.applications).toHaveLength(0);
  });
  it("refuses a supplied override on execute as well", async () => {
    const f = fixture(kind);
    expect((await f.command("execute", { ...f.executeBody(), coolingOffMs: 0 })).status).toBe(400);
    expect(f.deps.getRuntimeDb).not.toHaveBeenCalled();
  });
});
