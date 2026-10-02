import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { randomUUID } from "node:crypto";

/** Paper and mock only. Live execution is not a mode of this loop. */
export type AccountExecutorModeV1 = "paper" | "mock";

export type AccountExecutorFenceV1 = Readonly<{
  organizationId: string;
  accountId: string;
  holderId: string;
  fence: string;
}>;

export type AccountExecutorLeasePortV1 = {
  claim(input: {
    organizationId: string;
    accountId: string;
    holderId: string;
  }): Promise<AccountExecutorFenceV1 | null>;
  holds(fence: AccountExecutorFenceV1): Promise<boolean>;
  release(fence: AccountExecutorFenceV1): Promise<void>;
};

export type AccountExecutorLoopStatusV1 = "LEASE_BUSY" | "COMPLETE" | "ABORTED" | "FENCE_LOST";

export type AccountExecutorLoopResultV1 = Readonly<{
  status: AccountExecutorLoopStatusV1;
  cycles: number;
  fence: string | null;
}>;

const ACCOUNT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function accountExecutorLockIdentityV1(organizationId: string, accountId: string): string {
  if (typeof organizationId !== "string" || organizationId.length !== 36 ||
      !UUID.test(organizationId) || typeof accountId !== "string" ||
      accountId !== accountId.trim() || !ACCOUNT_KEY.test(accountId)) {
    throw new Error("ACCOUNT_EXECUTOR_IDENTITY_INVALID");
  }
  return `${organizationId.toLowerCase()}:${accountId}`;
}

/** Capture once before an asynchronous claim; PostgreSQL UUID case is not identity. */
export function captureAccountExecutorScopeV1(input: Pick<
  AccountExecutorFenceV1, "organizationId" | "accountId" | "holderId"
>): Readonly<Pick<AccountExecutorFenceV1, "organizationId" | "accountId" | "holderId">> {
  const { organizationId, accountId, holderId } = input;
  accountExecutorLockIdentityV1(organizationId, accountId);
  if (typeof holderId !== "string" || !holderId.trim() || holderId.includes("\0")) {
    throw new Error("ACCOUNT_EXECUTOR_IDENTITY_INVALID");
  }
  return Object.freeze({ organizationId: organizationId.toLowerCase(), accountId, holderId });
}

export function assertAccountExecutorIdentityV1(input: {
  organizationId: string;
  accountId: string;
  holderId: string;
  executionMode: string;
}): void {
  if (input.executionMode === "live") {
    throw new Error("ACCOUNT_EXECUTOR_LIVE_FORBIDDEN");
  }
  if (input.executionMode !== "paper" && input.executionMode !== "mock") {
    throw new Error("ACCOUNT_EXECUTOR_MODE_FORBIDDEN");
  }
  captureAccountExecutorScopeV1(input);
}

type MemoryRow = { holderId: string; fence: string };

/** Process-local stand-in for a session advisory lock. `crash` drops the holder's locks. */
export function createMemoryAccountExecutorLeaseV1(): AccountExecutorLeasePortV1 & {
  crash(holderId: string): void;
} {
  const held = new Map<string, MemoryRow>();
  return {
    async claim(input) {
      const captured = captureAccountExecutorScopeV1(input);
      const key = accountExecutorLockIdentityV1(captured.organizationId, captured.accountId);
      if (held.has(key)) return null;
      const fence: AccountExecutorFenceV1 = Object.freeze({
        ...captured,
        fence: randomUUID(),
      });
      held.set(key, { holderId: fence.holderId, fence: fence.fence });
      return fence;
    },
    async holds(fence) {
      captureAccountExecutorScopeV1(fence);
      const row = held.get(accountExecutorLockIdentityV1(fence.organizationId, fence.accountId));
      return row?.holderId === fence.holderId && row.fence === fence.fence;
    },
    async release(fence) {
      captureAccountExecutorScopeV1(fence);
      const key = accountExecutorLockIdentityV1(fence.organizationId, fence.accountId);
      const row = held.get(key);
      if (row?.holderId === fence.holderId && row.fence === fence.fence) held.delete(key);
    },
    crash(holderId) {
      for (const [key, row] of held) {
        if (row.holderId === holderId) held.delete(key);
      }
    },
  };
}

/**
 * One paper/mock loop for one account. The lease is claimed before the first tick and
 * re-checked before every later tick. A second starter receives LEASE_BUSY. After the
 * holder crashes, the lock is gone and a new start receives a new fence; the old fence
 * no longer holds.
 */
export async function runAccountExecutorLoopV1(input: {
  lease: AccountExecutorLeasePortV1;
  organizationId: string;
  accountId: string;
  holderId: string;
  executionMode: AccountExecutorModeV1;
  maxCycles?: number;
  signal?: AbortSignal;
  tick: (fence: AccountExecutorFenceV1) => Promise<"continue" | "stop">;
}): Promise<AccountExecutorLoopResultV1> {
  assertAccountExecutorIdentityV1(input);
  if (
    input.maxCycles !== undefined &&
    (!Number.isSafeInteger(input.maxCycles) || input.maxCycles < 1)
  ) {
    throw new Error("ACCOUNT_EXECUTOR_MAX_CYCLES_INVALID");
  }
  if (input.signal?.aborted) return { status: "ABORTED", cycles: 0, fence: null };
  const fence = await input.lease.claim({
    organizationId: input.organizationId,
    accountId: input.accountId,
    holderId: input.holderId,
  });
  if (!fence) return { status: "LEASE_BUSY", cycles: 0, fence: null };
  let cycles = 0;
  try {
    while (input.maxCycles === undefined || cycles < input.maxCycles) {
      if (input.signal?.aborted) return { status: "ABORTED", cycles, fence: fence.fence };
      if (!(await input.lease.holds(fence)))
        return { status: "FENCE_LOST", cycles, fence: fence.fence };
      const step = await input.tick(fence);
      cycles += 1;
      if (step === "stop") return { status: "COMPLETE", cycles, fence: fence.fence };
    }
    return { status: "COMPLETE", cycles, fence: fence.fence };
  } finally {
    await input.lease.release(fence);
  }
}
