import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  accountExecutorLockIdentityV1,
  assertAccountExecutorIdentityV1,
  createMemoryAccountExecutorLeaseV1,
  runAccountExecutorLoopV1,
  type AccountExecutorFenceV1,
} from "@/lib/trader/execution/account-executor-lease-v1";
import { createPostgresAccountExecutorLeaseV1 } from "@/lib/trader/execution/account-executor-lease-postgres-v1";

const ORG = "00000000-0000-4000-8000-000000000115";
const ACCOUNT = "paper-account-1";

function reservedSqlMock<T extends (...args: never[]) => unknown>(sql: T): T & { release: ReturnType<typeof vi.fn> } {
  return Object.assign(sql, { release: vi.fn() });
}

function loopInput(
  lease: ReturnType<typeof createMemoryAccountExecutorLeaseV1>,
  patch: Partial<Parameters<typeof runAccountExecutorLoopV1>[0]> = {},
) {
  return {
    lease,
    organizationId: ORG,
    accountId: ACCOUNT,
    holderId: "holder-a",
    executionMode: "paper" as const,
    maxCycles: 1,
    tick: async () => "stop" as const,
    ...patch,
  };
}

describe("account executor lease", () => {
  it("lets only one holder run an account and gives the other account its own lease", async () => {
    const lease = createMemoryAccountExecutorLeaseV1();
    const first = runAccountExecutorLoopV1({
      ...loopInput(lease),
      tick: async () => {
        const second = await runAccountExecutorLoopV1(
          loopInput(lease, { holderId: "holder-b", maxCycles: 1 }),
        );
        expect(second).toMatchObject({ status: "LEASE_BUSY", cycles: 0, fence: null });
        const other = await runAccountExecutorLoopV1(
          loopInput(lease, { holderId: "holder-b", accountId: "paper-account-2" }),
        );
        expect(other.status).toBe("COMPLETE");
        return "stop";
      },
    });
    await expect(first).resolves.toMatchObject({ status: "COMPLETE", cycles: 1 });
  });

  it("drops the lock on crash so a restart gets a new fence and the old fence fails", async () => {
    const lease = createMemoryAccountExecutorLeaseV1();
    let seen: AccountExecutorFenceV1 | null = null;
    const crashed = await runAccountExecutorLoopV1({
      ...loopInput(lease, { maxCycles: 3 }),
      tick: async (fence) => {
        seen = fence;
        lease.crash(fence.holderId);
        return "continue";
      },
    });
    expect(crashed.status).toBe("FENCE_LOST");
    expect(crashed.cycles).toBe(1);
    expect(seen).not.toBeNull();
    expect(await lease.holds(seen!)).toBe(false);

    const restarted = await runAccountExecutorLoopV1(
      loopInput(lease, { holderId: "holder-restart" }),
    );
    expect(restarted.status).toBe("COMPLETE");
    expect(restarted.fence).toBeTruthy();
    expect(restarted.fence).not.toBe(seen!.fence);
    expect(await lease.holds(seen!)).toBe(false);
  });

  it("refuses a second start while the first loop still holds the account", async () => {
    const lease = createMemoryAccountExecutorLeaseV1();
    let releaseFirst: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = runAccountExecutorLoopV1({
      ...loopInput(lease, { maxCycles: 1 }),
      tick: async () => {
        const busy = await runAccountExecutorLoopV1(loopInput(lease, { holderId: "holder-b" }));
        expect(busy.status).toBe("LEASE_BUSY");
        releaseFirst!();
        return "stop";
      },
    });
    await gate;
    await expect(first).resolves.toMatchObject({ status: "COMPLETE", cycles: 1 });
    const after = await runAccountExecutorLoopV1(loopInput(lease, { holderId: "holder-b" }));
    expect(after.status).toBe("COMPLETE");
  });

  it("does not claim a lease for live execution", async () => {
    const lease = createMemoryAccountExecutorLeaseV1();
    const claim = vi.spyOn(lease, "claim");
    await expect(
      runAccountExecutorLoopV1(loopInput(lease, { executionMode: "live" as "paper" })),
    ).rejects.toThrow("ACCOUNT_EXECUTOR_LIVE_FORBIDDEN");
    expect(claim).not.toHaveBeenCalled();
  });

  it("stops before a tick when already aborted", async () => {
    const lease = createMemoryAccountExecutorLeaseV1();
    const signal = new AbortController();
    signal.abort();
    const tick = vi.fn(async () => "continue" as const);
    const result = await runAccountExecutorLoopV1(
      loopInput(lease, { signal: signal.signal, tick }),
    );
    expect(result).toEqual({ status: "ABORTED", cycles: 0, fence: null });
    expect(tick).not.toHaveBeenCalled();
    const next = await runAccountExecutorLoopV1(loopInput(lease));
    expect(next.status).toBe("COMPLETE");
  });
});

describe("PostgreSQL account executor lease identity and reservation", () => {
  it("canonicalizes UUID case in the exported lock identity", () => {
    const lower = "a0000000-0000-4000-8000-000000000115";
    const upper = lower.toUpperCase();
    expect(() =>
      assertAccountExecutorIdentityV1({
        organizationId: upper,
        accountId: ACCOUNT,
        holderId: "holder-a",
        executionMode: "paper",
      }),
    ).not.toThrow();
    expect(accountExecutorLockIdentityV1(upper, ACCOUNT)).toBe(
      accountExecutorLockIdentityV1(lower, ACCOUNT),
    );
  });

  it("rejects pool handles which are not reserved sessions", () => {
    const sql = vi.fn(async () => [{ acquired: false }]);
    expect(() => createPostgresAccountExecutorLeaseV1(sql as never)).toThrow(
      "ACCOUNT_EXECUTOR_RESERVED_SESSION_REQUIRED",
    );
  });

  it("captures claim identity before awaiting PostgreSQL", async () => {
    let finishQuery: ((rows: Array<{ acquired: boolean }>) => void) | undefined;
    const sql = reservedSqlMock(
      vi.fn(
        () =>
          new Promise<Array<{ acquired: boolean }>>((resolve) => {
            finishQuery = resolve;
          }),
      ),
    );
    const lease = createPostgresAccountExecutorLeaseV1(sql as never);
    const input = {
      organizationId: ORG,
      accountId: ACCOUNT,
      holderId: "holder-a",
    };
    const pending = lease.claim(input);
    expect(finishQuery).toBeDefined();
    input.organizationId = "10000000-0000-4000-8000-000000000115";
    input.accountId = "paper-account-mutated";
    input.holderId = "holder-b";
    finishQuery!([{ acquired: true }]);
    await expect(pending).resolves.toMatchObject({
      organizationId: ORG,
      accountId: ACCOUNT,
      holderId: "holder-a",
    });
  });

  it("taints the reserved session after an uncertain claim response", async () => {
    const sql = reservedSqlMock(vi.fn(async () => {
      throw new Error("simulated lost response");
    }));
    const lease = createPostgresAccountExecutorLeaseV1(sql as never);
    const input = { organizationId: ORG, accountId: ACCOUNT, holderId: "uncertain-holder" };
    await expect(lease.claim(input)).rejects.toThrow("simulated lost response");
    await expect(lease.claim({ ...input, accountId: "different-account" })).rejects.toThrow(
      "ACCOUNT_EXECUTOR_SESSION_UNCERTAIN",
    );
    expect(sql).toHaveBeenCalledTimes(1);
    await expect(lease.holds({ ...input, fence: "00000000-0000-4000-8000-000000000902" })).resolves.toBe(false);
  });

  it("makes concurrent release calls await one unlock", async () => {
    let finishUnlock: ((rows: Array<{ released: boolean }>) => void) | undefined;
    const sql = reservedSqlMock(vi.fn((strings: TemplateStringsArray) => {
      if (strings.join("?").includes("pg_try_advisory_lock")) {
        return Promise.resolve([{ acquired: true }]);
      }
      return new Promise<Array<{ released: boolean }>>(resolve => { finishUnlock = resolve; });
    }));
    const lease = createPostgresAccountExecutorLeaseV1(sql as never);
    const fence = await lease.claim({ organizationId: ORG, accountId: ACCOUNT, holderId: "release-holder" });
    expect(fence).not.toBeNull();
    const first = lease.release(fence!);
    const second = lease.release(fence!);
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(finishUnlock).toBeDefined();
    finishUnlock!([{ released: true }]);
    await Promise.all([first, second]);
    expect(secondSettled).toBe(true);
    expect(sql).toHaveBeenCalledTimes(2);
  });
});

describe("postgres account executor lease statements", () => {
  it("acquires a session advisory lock and records ownership only after it is granted", async () => {
    const statements: string[] = [];
    const values: unknown[][] = [];
    const sql = reservedSqlMock((strings: TemplateStringsArray, ...bound: unknown[]) => {
      const text = strings.join("?");
      statements.push(text);
      values.push(bound);
      if (text.includes("pg_try_advisory_lock")) return Promise.resolve([{ acquired: true }]);
      return Promise.resolve([{ current: true, released: true }]);
    });
    const lease = createPostgresAccountExecutorLeaseV1(sql as never);
    const fence = await lease.claim({ organizationId: ORG, accountId: ACCOUNT, holderId: "holder-a" });
    expect(fence).not.toBeNull();
    expect(statements[0]).toContain("pg_try_advisory_lock");
    expect(values[0]).toContain(1151);
    expect(statements[0]).not.toContain("set_config");
    expect(statements[0]).not.toContain("placeOrder");
    await expect(lease.holds(fence!)).resolves.toBe(true);
    await lease.release(fence!);
  });

  it("checks locally recorded ownership and the held advisory key before a cycle", async () => {
    const statements: string[] = [];
    const sql = reservedSqlMock((strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      return Promise.resolve(strings.join("?").includes("pg_try_advisory_lock")
        ? [{ acquired: true }]
        : [{ current: true, released: true }]);
    });
    const lease = createPostgresAccountExecutorLeaseV1(sql as never);
    const fence = await lease.claim({ organizationId: ORG, accountId: ACCOUNT, holderId: "holder-a" });
    expect(fence).not.toBeNull();
    await expect(lease.holds(fence!)).resolves.toBe(true);
    expect(statements.join("\n")).not.toContain("waia.account_executor_fence");
    expect(statements.join("\n")).toContain("pg_locks");
    expect(statements.join("\n")).toContain("classid");
    expect(statements.join("\n")).toContain("objsubid = 2");
    await lease.release(fence!);
  });

  it("does not mention live order placement", () => {
    const source = [
      "lib/trader/execution/account-executor-lease-v1.ts",
      "lib/trader/execution/account-executor-lease-postgres-v1.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/placeOrder|submitOrder|WAIA_TRADER_LIVE_ENABLED/);
  });

  it("stays off the scheduled NONCAPITAL production caller", async () => {
    const worker = readFileSync("custom-worker.ts", "utf8");
    const owner = readFileSync("lib/trader/paper/scheduled-noncapital-owner-postgres-v1.ts", "utf8");
    const lease = readFileSync("lib/trader/execution/account-executor-lease-postgres-v1.ts", "utf8");
    expect(worker).toContain("runScheduledNoncapitalPaperLoopFromEnv");
    expect(worker).not.toContain("account-executor-lease");
    expect(owner).not.toContain("account-executor-lease");
    expect(owner).toContain("const ADVISORY_CLASS = 1_125_001");
    expect(owner).toContain("pg_try_advisory_xact_lock");
    expect(lease).toContain("ACCOUNT_EXECUTOR_ADVISORY_CLASS_V1 = 1151");
    expect(lease).toContain("pg_try_advisory_lock");
    expect(lease).not.toContain("pg_try_advisory_xact_lock");

    const { runScheduledNoncapitalPaperLoopFromEnv } = await import(
      "@/lib/trader/paper/scheduled-noncapital-owner-postgres-v1"
    );
    const disabled = { PAPER_LOOP_ENABLED: "0" };
    await expect(runScheduledNoncapitalPaperLoopFromEnv(disabled)).resolves.toEqual({
      status: "NOOP_DISABLED",
      report: null,
    });
    await expect(runScheduledNoncapitalPaperLoopFromEnv(disabled)).resolves.toEqual({
      status: "NOOP_DISABLED",
      report: null,
    });
  });
});
