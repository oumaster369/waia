import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import {
  accountExecutorLockIdentityV1,
  type AccountExecutorLeasePortV1,
} from "@/lib/trader/execution/account-executor-lease-v1";

/**
 * Session advisory lock namespace for one paper/mock executor per account.
 * `hashtext` collisions only make two accounts share a lock (one waits). They do not
 * let the other account's fence pass `holds`.
 */
export const ACCOUNT_EXECUTOR_ADVISORY_CLASS_V1 = 1151;

/**
 * Dedicated session. The lock is not transaction-scoped, so it survives commits and
 * disappears when this connection closes (process crash or pool release).
 */
export function createPostgresAccountExecutorLeaseV1(
  sql: postgres.Sql,
): AccountExecutorLeasePortV1 {
  return {
    async claim(input) {
      const key = accountExecutorLockIdentityV1(input.organizationId, input.accountId);
      const fence = randomUUID();
      const [row] = await sql<{ acquired: boolean }[]>`
        WITH attempt AS (
          SELECT pg_try_advisory_lock(${ACCOUNT_EXECUTOR_ADVISORY_CLASS_V1}, hashtext(${key})) AS acquired
        )
        SELECT acquired,
               CASE WHEN acquired THEN set_config('waia.account_executor_fence', ${fence}, false) END AS fence_set,
               CASE WHEN acquired THEN set_config('waia.account_executor_holder', ${input.holderId}, false) END AS holder_set,
               CASE WHEN acquired THEN set_config('waia.account_executor_account', ${key}, false) END AS account_set
        FROM attempt`;
      if (row?.acquired !== true) return null;
      return Object.freeze({
        organizationId: input.organizationId,
        accountId: input.accountId,
        holderId: input.holderId,
        fence,
      });
    },
    async holds(fence) {
      const key = accountExecutorLockIdentityV1(fence.organizationId, fence.accountId);
      const [row] = await sql<{ current: boolean }[]>`
        SELECT (
          current_setting('waia.account_executor_fence', true) = ${fence.fence}
          AND current_setting('waia.account_executor_holder', true) = ${fence.holderId}
          AND current_setting('waia.account_executor_account', true) = ${key}
          AND EXISTS (
            SELECT 1 FROM pg_locks
            WHERE locktype = 'advisory'
              AND granted
              AND pid = pg_backend_pid()
              AND classid = ${ACCOUNT_EXECUTOR_ADVISORY_CLASS_V1}
              AND objsubid = 2
              AND objid = hashtext(${key})::oid
          )
        ) AS current`;
      return row?.current === true;
    },
    async release(fence) {
      const key = accountExecutorLockIdentityV1(fence.organizationId, fence.accountId);
      await sql`
        WITH unlocked AS (
          SELECT CASE
            WHEN current_setting('waia.account_executor_fence', true) = ${fence.fence}
             AND current_setting('waia.account_executor_account', true) = ${key}
            THEN pg_advisory_unlock(${ACCOUNT_EXECUTOR_ADVISORY_CLASS_V1}, hashtext(${key}))
            ELSE false
          END AS released
        )
        SELECT released,
               CASE WHEN released THEN set_config('waia.account_executor_fence', '', false) END,
               CASE WHEN released THEN set_config('waia.account_executor_holder', '', false) END,
               CASE WHEN released THEN set_config('waia.account_executor_account', '', false) END
        FROM unlocked`;
    },
  };
}
