// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ResearchReadBudget } from "@/lib/trader/paper/research-understanding-v1/bounded-source-postgres";

// Reflect also executes the real pre-extraction constructor, which ignored the
// extra command ledger. These RED controls concern the new composed boundary.
function local(maximum: number, shared: ResearchReadBudget): ResearchReadBudget {
  return Reflect.construct(ResearchReadBudget, [maximum, shared]);
}
function admit(budget: ResearchReadBudget, size: number, projection: string, id = "row") {
  Reflect.apply(budget.admit, budget, ["table", id, size, 100, projection]);
}
describe("held research shared projected-input budget", () => {
  it("keeps legacy independent limits and exact duplicate behavior", () => {
    const a = new ResearchReadBudget(10); const b = new ResearchReadBudget(10);
    a.admit("t", "a", 10, 10); b.admit("t", "b", 10, 10); a.admit("t", "a", 10, 10);
    expect(a.total).toBe(10); expect(b.total).toBe(10);
    expect(() => a.admit("t", "c", 1, 10)).toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
  });
  it("rejects combined overflow even when each packet is independently below its local cap", () => {
    const shared = new ResearchReadBudget(10); const a = local(10, shared); const b = local(10, shared);
    admit(a, 6, "packet", "a");
    expect(() => admit(b, 5, "packet", "b")).toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
    expect(b.total).toBe(0); expect(shared.total).toBe(6);
  });
  it("rejects changed size for the same shared projection across different packet readers", () => {
    const shared = new ResearchReadBudget(20); admit(local(10, shared), 6, "profile");
    expect(() => admit(local(10, shared), 5, "profile")).toThrow("SNAPSHOT_ROW_IDENTITY_CONFLICT");
  });
  it("deduplicates repeated projection but separately accounts for a smaller predecessor projection", () => {
    const shared = new ResearchReadBudget(20);
    const a = local(10, shared);
    admit(a, 6, "completion"); admit(local(10, shared), 6, "completion"); admit(a, 3, "predecessor");
    expect(shared.total).toBe(9);
  });
});

// The real Drizzle adapter emits SQL to an inert transaction client. No DB is opened.
import type postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterEach, vi } from "vitest";
import { createHeldResearchReplay, HeldResearchAccounting } from "@/lib/trader/paper/research-understanding-v1/held-replay";
import { APPLICATION_LIMITS } from "@/lib/trader/paper/research-application-v1/contract";
afterEach(() => vi.restoreAllMocks());
function transport() {
  const unsafe = vi.fn(() => Object.assign(Promise.resolve([]), { values: async () => [] }));
  const client = { unsafe, savepoint() { throw new Error("SAVEPOINT_FORBIDDEN"); } } as unknown as postgres.TransactionSql;
  const accounting = new HeldResearchAccounting(); return { unsafe, accounting, executor: createHeldResearchReplay(client, accounting).executor };
}
describe("actual held dispatch and invocation accounting", () => {
  it("allows exactly512 dispatches and refuses the513th before the driver call", async () => {
    const f = transport();
    for (let i = 0; i < 512; i++) await f.executor.execute(sql`select ${i}`);
    expect(f.unsafe).toHaveBeenCalledTimes(512); expect(f.accounting.statements).toBe(512);
    await expect(f.executor.execute(sql`select 513`)).rejects.toThrow("STATEMENT_LIMIT_EXCEEDED");
    expect(f.unsafe).toHaveBeenCalledTimes(512);
  });
  it("retains counted reserved rollback after business exhaustion and deadline", async () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = transport(); f.accounting.reserveFinalization(1);
    for (let i = 0; i < 511; i++) await f.executor.execute(sql`select 1`);
    await expect(f.executor.execute(sql`select 2`)).rejects.toThrow("STATEMENT_LIMIT_EXCEEDED");
    now = 120001; expect(() => f.accounting.beforeFinalizationStatement()).not.toThrow();
    expect(f.accounting.statements).toBe(512); expect(() => f.accounting.beforeFinalizationStatement()).toThrow("FINALIZATION_SLOT_REQUIRED");
  });
  it("keeps one64MiB ledger across independently bounded reads, with no rounding", () => {
    const accounting = new HeldResearchAccounting();
    for (let i = 0; i < 4; i++) accounting.budget(16_777_216).admit("t", String(i), 16_777_216, 16_777_216, "packet");
    expect(accounting.inputs.total).toBe(APPLICATION_LIMITS.uniqueInputAggregate);
    expect(() => accounting.budget(10).admit("t", "extra", 1, 10)).toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
  });
  it("shares the original deadline with previously created local budgets", () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = transport(); const budget = f.accounting.budget(10);
    now = 119999; budget.admit("t", "a", 1, 10);
    now = 120001; expect(() => budget.admit("t", "b", 1, 10)).toThrow("INVOCATION_DEADLINE_EXCEEDED");
    expect(() => f.accounting.budget(10)).toThrow("INVOCATION_DEADLINE_EXCEEDED"); expect(f.unsafe).not.toHaveBeenCalled();
  });
});
