import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  createMemoryAccountExecutorLeaseV1,
  runAccountExecutorLoopV1,
  type AccountExecutorFenceV1,
} from "@/lib/trader/execution/account-executor-lease-v1";
import { createPostgresAccountExecutorLeaseV1 } from "@/lib/trader/execution/account-executor-lease-postgres-v1";

const ORG = "00000000-0000-4000-8000-000000000115";
const ACCOUNT = "paper-account-1";

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

describe("postgres account executor lease statements", () => {
  it("acquires a session advisory lock and sets the fence only when the lock is granted", async () => {
    const statements: string[] = [];
    const values: unknown[][] = [];
    const sql = (strings: TemplateStringsArray, ...bound: unknown[]) => {
      const text = strings.join("?");
      statements.push(text);
      values.push(bound);
      if (text.includes("pg_try_advisory_lock")) return Promise.resolve([{ acquired: false }]);
      return Promise.resolve([{ current: false, released: false }]);
    };
    const lease = createPostgresAccountExecutorLeaseV1(sql as never);
    await expect(
      lease.claim({ organizationId: ORG, accountId: ACCOUNT, holderId: "holder-a" }),
    ).resolves.toBeNull();
    expect(statements[0]).toContain("pg_try_advisory_lock");
    expect(values[0]).toContain(1151);
    expect(statements[0]).toContain("CASE WHEN acquired THEN set_config");
    expect(statements[0]).not.toContain("placeOrder");
  });

  it("checks the fence and the held advisory key before a cycle", async () => {
    const statements: string[] = [];
    const sql = (strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      return Promise.resolve([{ current: true }]);
    };
    const lease = createPostgresAccountExecutorLeaseV1(sql as never);
    const fence: AccountExecutorFenceV1 = {
      organizationId: ORG,
      accountId: ACCOUNT,
      holderId: "holder-a",
      fence: "00000000-0000-4000-8000-000000000901",
    };
    await expect(lease.holds(fence)).resolves.toBe(true);
    expect(statements[0]).toContain("waia.account_executor_fence");
    expect(statements[0]).toContain("pg_locks");
    expect(statements[0]).toContain("classid");
    expect(statements[0]).toContain("objsubid = 2");
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
});
