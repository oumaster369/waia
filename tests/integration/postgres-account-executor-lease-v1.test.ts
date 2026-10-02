import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresAccountExecutorLeaseV1 } from "@/lib/trader/execution/account-executor-lease-postgres-v1";
import type { AccountExecutorFenceV1 } from "@/lib/trader/execution/account-executor-lease-v1";

const urlText = process.env.DATABASE_URL_POSTGRES?.trim();
const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1" && Boolean(urlText);

function exactTestDatabase(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const safeLocal = url.protocol === "postgres:" || url.protocol === "postgresql:"
      ? url.hostname === "127.0.0.1" && url.port === "54329" &&
        url.username === "waia_validate" && url.pathname === "/postgres" &&
        !url.search && !url.hash
      : false;
    const safeCi = (process.env.CI === "true" || process.env.CI === "1") &&
      process.env.GITHUB_ACTIONS === "true" &&
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      url.hostname === "127.0.0.1" && url.port === "5432" &&
      url.username === "waia_it" && url.pathname === "/waia_it" &&
      !url.search && !url.hash;
    return safeLocal || safeCi;
  } catch {
    return false;
  }
}

if (integrationEnabled && !exactTestDatabase(urlText)) {
  throw new Error("ACCOUNT_EXECUTOR_TEST_DATABASE_REFUSED");
}

const testUrl = integrationEnabled ? urlText! : "postgres://invalid/disabled";

const LOWER_ORG = "a0000000-0000-4000-8000-000000000115";
const ACCOUNT_PREFIX = "lease-test-";

let pool: postgres.Sql | undefined;

function createLease(session: postgres.ReservedSql) {
  return createPostgresAccountExecutorLeaseV1(session);
}
function identity(accountId = ACCOUNT_PREFIX + randomUUID()) {
  return { organizationId: LOWER_ORG, accountId };
}
async function reserve(pool: postgres.Sql) {
  const session = await pool.reserve();
  return { session, lease: createLease(session) };
}
async function closeReserved(session: postgres.ReservedSql) {
  session.release();
}

describe.skipIf(!integrationEnabled)("PostgreSQL account executor session lease v1", () => {
  beforeAll(async () => {
    pool = postgres(testUrl, { max: 8 });
  });
  afterAll(async () => {
    await pool?.end({ timeout: 2 });
  });

  it("allows one winner when mixed-case spellings name the same UUID and account", async () => {
    const accountId = identity().accountId;
    const lower = await reserve(pool!);
    const upper = await reserve(pool!);
    const upperIdentity = { organizationId: LOWER_ORG.toUpperCase(), accountId };
    let lowerFence: AccountExecutorFenceV1 | null = null;
    let upperFence: AccountExecutorFenceV1 | null = null;
    try {
      lowerFence = await lower.lease.claim({ ...identity(accountId), holderId: "mixed-case-lower" });
      upperFence = await upper.lease.claim({ ...upperIdentity, holderId: "mixed-case-upper" });
      expect(lowerFence).not.toBeNull();
      expect(upperFence).toBeNull();
      expect(await lower.lease.holds(lowerFence!)).toBe(true);
    } finally {
      if (lowerFence) await lower.lease.release(lowerFence);
      if (upperFence) await upper.lease.release(upperFence);
      await closeReserved(lower.session);
      await closeReserved(upper.session);
    }
  });

  it("refuses a second lease factory claim on the same reserved session", async () => {
    const account = identity();
    const reserved = await pool!.reserve();
    const firstLease = createLease(reserved);
    const secondLease = createLease(reserved);
    let first: AccountExecutorFenceV1 | null = null;
    let second: AccountExecutorFenceV1 | null = null;
    try {
      first = await firstLease.claim({ ...account, holderId: "factory-one" });
      second = await secondLease.claim({ ...account, holderId: "factory-two" });
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(await secondLease.claim({ ...identity(), holderId: "same-session-other-account" })).toBeNull();
      expect(await firstLease.holds(first!)).toBe(true);
    } finally {
      if (first) await firstLease.release(first);
      if (second) await secondLease.release(second);
      await closeReserved(reserved);
    }
  });

  it("retains lease ownership across BEGIN rollback and unlocks normally", async () => {
    const account = identity();
    const owner = await reserve(pool!);
    const contender = await reserve(pool!);
    let fence: AccountExecutorFenceV1 | null = null;
    let next: AccountExecutorFenceV1 | null = null;
    try {
      await owner.session`BEGIN`;
      fence = await owner.lease.claim({ ...account, holderId: "rollback-owner" });
      expect(fence).not.toBeNull();
      await owner.session`ROLLBACK`;

      expect(await owner.lease.holds(fence!)).toBe(true);
      expect(await contender.lease.claim({ ...account, holderId: "rollback-contender" })).toBeNull();
      await owner.lease.release(fence!);
      fence = null;

      next = await contender.lease.claim({ ...account, holderId: "after-rollback-release" });
      expect(next).not.toBeNull();
      await contender.lease.release(next!);
      next = null;
    } finally {
      if (fence) await owner.lease.release(fence);
      if (next) await contender.lease.release(next);
      await closeReserved(owner.session);
      await closeReserved(contender.session);
    }
  });

  it("retains lease ownership across savepoint rollback and rejects stale fences", async () => {
    const account = identity();
    const owner = await reserve(pool!);
    const contender = await reserve(pool!);
    let original: AccountExecutorFenceV1 | null = null;
    let current: AccountExecutorFenceV1 | null = null;
    let afterRelease: AccountExecutorFenceV1 | null = null;
    try {
      await owner.session`BEGIN`;
      await owner.session`SAVEPOINT before_lease`;
      original = await owner.lease.claim({ ...account, holderId: "savepoint-owner" });
      expect(original).not.toBeNull();
      await owner.session`ROLLBACK TO SAVEPOINT before_lease`;

      expect(await owner.lease.holds(original!)).toBe(true);
      expect(await contender.lease.claim({ ...account, holderId: "savepoint-contender" })).toBeNull();
      await owner.lease.release(original!);
      current = await owner.lease.claim({ ...account, holderId: "savepoint-new-owner" });
      expect(current).not.toBeNull();
      expect(await owner.lease.holds(original!)).toBe(false);
      await owner.lease.release(original!);
      expect(await owner.lease.holds(current!)).toBe(true);
      await owner.session`ROLLBACK`;
      expect(await owner.lease.holds(current!)).toBe(true);
      await owner.lease.release(current!);
      current = null;
      afterRelease = await contender.lease.claim({ ...account, holderId: "savepoint-after-release" });
      expect(afterRelease).not.toBeNull();
      await contender.lease.release(afterRelease!);
      afterRelease = null;
    } finally {
      if (original) await owner.lease.release(original);
      if (current) await owner.lease.release(current);
      if (afterRelease) await contender.lease.release(afterRelease);
      await closeReserved(owner.session);
      await closeReserved(contender.session);
    }
  });

  it("unlocks once when concurrent release calls race a competing session", async () => {
    const account = identity();
    const owner = await reserve(pool!);
    const contender = await reserve(pool!);
    let fence: AccountExecutorFenceV1 | null = null;
    let next: AccountExecutorFenceV1 | null = null;
    try {
      fence = await owner.lease.claim({ ...account, holderId: "concurrent-release-owner" });
      expect(fence).not.toBeNull();
      await Promise.all([owner.lease.release(fence!), owner.lease.release(fence!)]);
      fence = null;
      next = await contender.lease.claim({ ...account, holderId: "concurrent-release-contender" });
      expect(next).not.toBeNull();
      await contender.lease.release(next!);
      next = null;
    } finally {
      if (fence) await owner.lease.release(fence);
      if (next) await contender.lease.release(next);
      await closeReserved(owner.session);
      await closeReserved(contender.session);
    }
  });

  it("serializes concurrent same-session claims instead of reentering the lock", async () => {
    const account = identity();
    const reserved = await pool!.reserve();
    const firstLease = createLease(reserved);
    const secondLease = createLease(reserved);
    let first: AccountExecutorFenceV1 | null = null;
    let second: AccountExecutorFenceV1 | null = null;
    try {
      [first, second] = await Promise.all([
        firstLease.claim({ ...account, holderId: "parallel-one" }),
        secondLease.claim({ ...account, holderId: "parallel-two" }),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect(first === null).not.toBe(second === null);
    } finally {
      if (first) await firstLease.release(first);
      if (second) await secondLease.release(second);
      await closeReserved(reserved);
    }
  });

  it("preserves the held lock for a wrong-holder release and supports another account", async () => {
    const account = identity();
    const differentAccount = identity();
    const owner = await reserve(pool!);
    const contender = await reserve(pool!);
    const differentAccountSession = await reserve(pool!);
    let fence: AccountExecutorFenceV1 | null = null;
    let otherFence: AccountExecutorFenceV1 | null = null;
    let recovered: AccountExecutorFenceV1 | null = null;
    try {
      fence = await owner.lease.claim({ ...account, holderId: "owner" });
      expect(fence).not.toBeNull();
      await owner.lease.release({ ...fence!, holderId: "intruder" });
      expect(await owner.lease.holds(fence!)).toBe(true);
      expect(await contender.lease.claim({ ...account, holderId: "contender" })).toBeNull();
      otherFence = await differentAccountSession.lease.claim({ ...differentAccount, holderId: "other-account" });
      expect(otherFence).not.toBeNull();
      await owner.lease.release(fence!);
      fence = null;
      recovered = await contender.lease.claim({ ...account, holderId: "contender-after-release" });
      expect(recovered).not.toBeNull();
      await contender.lease.release(recovered!);
      recovered = null;
    } finally {
      if (otherFence) await differentAccountSession.lease.release(otherFence);
      if (fence) await owner.lease.release(fence);
      if (recovered) await contender.lease.release(recovered);
      await closeReserved(owner.session);
      await closeReserved(contender.session);
      await closeReserved(differentAccountSession.session);
    }
  });

  it("recovers after the owning PostgreSQL session disconnects", async () => {
    const account = identity();
    const ownerPool = postgres(testUrl, { max: 1 });
    const otherPool = postgres(testUrl, { max: 1 });
    const ownerSession = await ownerPool.reserve();
    const other = await reserve(otherPool);
    let ownerFence: AccountExecutorFenceV1 | null = null;
    let otherFence: AccountExecutorFenceV1 | null = null;
    let ownerPoolClosed = false;
    try {
      const owner = createLease(ownerSession);
      ownerFence = await owner.claim({ ...account, holderId: "disconnecting-owner" });
      expect(ownerFence).not.toBeNull();
      expect(await other.lease.claim({ ...account, holderId: "other-before-disconnect" })).toBeNull();

      ownerSession.release();
      await ownerPool.end({ timeout: 2 });
      ownerPoolClosed = true;

      otherFence = await other.lease.claim({ ...account, holderId: "other-after-disconnect" });
      expect(otherFence).not.toBeNull();
      await other.lease.release(otherFence!);
      otherFence = null;
    } finally {
      if (!ownerPoolClosed) {
        ownerSession.release();
        await ownerPool.end({ timeout: 2 });
      }
      if (ownerFence && !ownerPoolClosed) {
        // A broken implementation may have created a reentrant hold; pool shutdown is the cleanup.
        ownerFence = null;
      }
      if (otherFence) await other.lease.release(otherFence);
      await closeReserved(other.session);
      await otherPool.end({ timeout: 2 });
    }
  });
});
