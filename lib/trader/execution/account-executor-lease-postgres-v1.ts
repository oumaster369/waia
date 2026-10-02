import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import {
  accountExecutorLockIdentityV1,
  captureAccountExecutorScopeV1,
  type AccountExecutorFenceV1,
  type AccountExecutorLeasePortV1,
} from "@/lib/trader/execution/account-executor-lease-v1";

/** Hash collisions serialize unrelated accounts; they never grant another fence. */
export const ACCOUNT_EXECUTOR_ADVISORY_CLASS_V1 = 1151;

type SessionOwner = {
  readonly key: string;
  readonly fence: AccountExecutorFenceV1;
  state: "PENDING" | "ACTIVE" | "RELEASING" | "TAINTED";
  releasePromise?: Promise<void>;
};

// Shared by every factory over the same reserved handle. Unlike SET/session GUCs,
// this ownership record cannot roll back while a session advisory lock survives.
const sessionOwners = new WeakMap<postgres.ReservedSql, SessionOwner>();

function sameFence(owner: SessionOwner | undefined, fence: AccountExecutorFenceV1): owner is SessionOwner {
  return owner !== undefined &&
    owner.key === accountExecutorLockIdentityV1(fence.organizationId, fence.accountId) &&
    owner.fence.holderId === fence.holderId && owner.fence.fence === fence.fence;
}

function matches(owner: SessionOwner | undefined, fence: AccountExecutorFenceV1): owner is SessionOwner {
  return sameFence(owner, fence) && owner.state === "ACTIVE";
}

/**
 * Caller-owned reserved session, exclusively used for this lease. Release the
 * lease before returning the reservation; never reuse a released handle. Pool
 * return does not close the backend or free advisory locks. After any uncertain
 * lease SQL error, the caller must close that backend (not return it to its pool).
 * This helper never commits/rolls back caller work or silently closes its pool.
 */
export function createPostgresAccountExecutorLeaseV1(
  sql: postgres.ReservedSql,
): AccountExecutorLeasePortV1 {
  if (typeof sql !== "function" || typeof sql.release !== "function" ||
      typeof sql.reserve === "function") {
    throw new Error("ACCOUNT_EXECUTOR_RESERVED_SESSION_REQUIRED");
  }
  return {
    async claim(input) {
      const captured = captureAccountExecutorScopeV1(input);
      const existing = sessionOwners.get(sql);
      if (existing?.state === "TAINTED") throw new Error("ACCOUNT_EXECUTOR_SESSION_UNCERTAIN");
      if (existing) return null;
      const key = accountExecutorLockIdentityV1(captured.organizationId, captured.accountId);
      const fence = Object.freeze({ ...captured, fence: randomUUID() });
      const owner: SessionOwner = { key, fence, state: "PENDING" };
      // Reserve synchronously, before the first await, including other factories.
      sessionOwners.set(sql, owner);
      try {
        const [row] = await sql<{ acquired: boolean }[]>`
          SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid()
              AND classid = ${ACCOUNT_EXECUTOR_ADVISORY_CLASS_V1} AND objsubid = 2
          )
          THEN pg_try_advisory_lock(${ACCOUNT_EXECUTOR_ADVISORY_CLASS_V1}, hashtext(${key}))
          ELSE false END AS acquired`;
        if (row?.acquired === false) {
          sessionOwners.delete(sql);
          return null;
        }
        if (row?.acquired !== true) throw new Error("ACCOUNT_EXECUTOR_CLAIM_RESULT_INVALID");
        owner.state = "ACTIVE";
        return fence;
      } catch (error) {
        // The server may have acquired the lock before the response was lost.
        // Never forget that uncertainty or retry on the same backend.
        owner.state = "TAINTED";
        throw error;
      }
    },
    async holds(fence) {
      const captured = Object.freeze({ ...captureAccountExecutorScopeV1(fence), fence: fence.fence });
      const owner = sessionOwners.get(sql);
      if (!matches(owner, captured)) return false;
      try {
        const [row] = await sql<{ current: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid()
              AND classid = ${ACCOUNT_EXECUTOR_ADVISORY_CLASS_V1} AND objsubid = 2
              AND objid = hashtext(${owner.key})::oid
          ) AS current`;
        // A release may have started while the SELECT was in flight.
        return row?.current === true && sessionOwners.get(sql) === owner && matches(owner, captured);
      } catch (error) {
        owner.state = "TAINTED";
        throw error;
      }
    },
    async release(fence) {
      const captured = Object.freeze({ ...captureAccountExecutorScopeV1(fence), fence: fence.fence });
      const owner = sessionOwners.get(sql);
      if (sameFence(owner, captured) && owner.releasePromise) return owner.releasePromise;
      if (!matches(owner, captured)) return;
      owner.state = "RELEASING";
      owner.releasePromise = (async () => {
        try {
          const [row] = await sql<{ released: boolean }[]>`
            SELECT pg_advisory_unlock(${ACCOUNT_EXECUTOR_ADVISORY_CLASS_V1}, hashtext(${owner.key})) AS released`;
          if (row?.released !== true) throw new Error("ACCOUNT_EXECUTOR_RELEASE_UNCONFIRMED");
          sessionOwners.delete(sql);
        } catch (error) {
          owner.state = "TAINTED";
          throw error;
        }
      })();
      await owner.releasePromise;
    },
  };
}
