import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { auditLogs } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { mapFhvActionToConfirmationPhraseClass } from "@/lib/trader/observability/fhv-campaign-control-executor";
import type { FhvOperatorAction } from "@/lib/trader/observability/fhv-observability.constants";
import { FHV_COMMAND_RATE_LIMIT_PER_HOUR } from "@/lib/trader/observability/fhv-observability.constants";
import { writeAuditLogPostgres, writeAuditLogSqlite } from "@/lib/waia-core/audit/write";

const FHV_RATE_LIMIT_ENTITY = "fhv_operator_command";
const FHV_RATE_LIMIT_ACTION = "fhv.operator.command.attempt";
const FHV_RATE_LIMIT_DENIED_ACTION = "fhv.operator.command.denied";

const sqliteRateLimitQueue = new WeakMap<import("@/db/types").WaiaDb, Promise<unknown>>();

function withSqliteRateLimitSerialization<T>(
  db: import("@/db/types").WaiaDb,
  fn: () => T,
): Promise<T> {
  const previous = sqliteRateLimitQueue.get(db) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  sqliteRateLimitQueue.set(
    db,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export type FhvCommandRateLimitInput = Readonly<{
  organizationId: string;
  operatorId: string;
  action: string;
  nowMs?: number;
  limit?: number;
}>;

export type FhvCommandRateLimitResult = Readonly<{
  allowed: boolean;
  remaining: number;
}>;

function actionClass(action: string): string {
  return mapFhvActionToConfirmationPhraseClass(action as FhvOperatorAction);
}

function timeBucket(nowMs: number): number {
  return Math.floor(nowMs / (60 * 60 * 1000));
}

function bucketEntityId(input: {
  organizationId: string;
  operatorId: string;
  action: string;
  nowMs: number;
}): string {
  return `${input.organizationId}:${input.operatorId}:${actionClass(input.action)}:${timeBucket(input.nowMs)}`;
}

async function recordFhvRateLimitEvent(
  runtime: WaiaRuntimeDb,
  input: {
    organizationId: string;
    operatorId: string;
    action: string;
    nowMs: number;
    denied: boolean;
  },
): Promise<void> {
  const payload = {
    actorType: "admin" as const,
    actorId: input.operatorId,
    action: input.denied ? FHV_RATE_LIMIT_DENIED_ACTION : FHV_RATE_LIMIT_ACTION,
    entityType: FHV_RATE_LIMIT_ENTITY,
    entityId: bucketEntityId(input),
    organizationId: input.organizationId,
    metadata: {
      actionClass: actionClass(input.action),
      timeBucket: timeBucket(input.nowMs),
      denied: input.denied,
      attemptedAtUtc: new Date(input.nowMs).toISOString(),
    },
  };
  if (runtime.kind === "sqlite") {
    writeAuditLogSqlite(runtime.db, payload);
    return;
  }
  await writeAuditLogPostgres(runtime.db, payload);
}

function countBucketAttemptsSqlite(
  db: import("@/db/types").WaiaDb,
  input: { organizationId: string; operatorId: string; entityId: string },
): number {
  const rows = db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, input.organizationId),
        eq(auditLogs.entityType, FHV_RATE_LIMIT_ENTITY),
        eq(auditLogs.entityId, input.entityId),
        eq(auditLogs.actorId, input.operatorId),
        eq(auditLogs.action, FHV_RATE_LIMIT_ACTION),
      ),
    )
    .all();
  return rows.filter((row) => row.id).length;
}

async function countBucketAttemptsPostgres(
  db: PostgresJsDatabase<typeof pgSchema>,
  input: { organizationId: string; operatorId: string; entityId: string },
): Promise<number> {
  const rows = await db
    .select({ id: pgSchema.auditLogs.id })
    .from(pgSchema.auditLogs)
    .where(
      and(
        eq(pgSchema.auditLogs.organizationId, input.organizationId),
        eq(pgSchema.auditLogs.entityType, FHV_RATE_LIMIT_ENTITY),
        eq(pgSchema.auditLogs.entityId, input.entityId),
        eq(pgSchema.auditLogs.actorId, input.operatorId),
        eq(pgSchema.auditLogs.action, FHV_RATE_LIMIT_ACTION),
      ),
    );
  return rows.length;
}

export async function checkAndRecordFhvCommandRateLimit(
  runtime: WaiaRuntimeDb,
  input: FhvCommandRateLimitInput,
): Promise<FhvCommandRateLimitResult> {
  const nowMs = input.nowMs ?? Date.now();
  const limit = input.limit ?? FHV_COMMAND_RATE_LIMIT_PER_HOUR;
  const entityId = bucketEntityId({ ...input, nowMs });

  if (runtime.kind === "sqlite") {
    return withSqliteRateLimitSerialization(runtime.db, () =>
      runtime.db.transaction(
        (tx) => {
          const count = countBucketAttemptsSqlite(tx, {
            organizationId: input.organizationId,
            operatorId: input.operatorId,
            entityId,
          });
          if (count >= limit) {
            writeAuditLogSqlite(tx, {
              actorType: "admin",
              actorId: input.operatorId,
              action: FHV_RATE_LIMIT_DENIED_ACTION,
              entityType: FHV_RATE_LIMIT_ENTITY,
              entityId,
              organizationId: input.organizationId,
              metadata: {
                actionClass: actionClass(input.action),
                timeBucket: timeBucket(nowMs),
                denied: true,
                attemptedAtUtc: new Date(nowMs).toISOString(),
              },
            });
            return { allowed: false, remaining: 0 };
          }
          writeAuditLogSqlite(tx, {
            actorType: "admin",
            actorId: input.operatorId,
            action: FHV_RATE_LIMIT_ACTION,
            entityType: FHV_RATE_LIMIT_ENTITY,
            entityId,
            organizationId: input.organizationId,
            metadata: {
              actionClass: actionClass(input.action),
              timeBucket: timeBucket(nowMs),
              denied: false,
              attemptedAtUtc: new Date(nowMs).toISOString(),
            },
          });
          return { allowed: true, remaining: Math.max(0, limit - count - 1) };
        },
        { behavior: "immediate" },
      ),
    );
  }

  if (typeof runtime.db.transaction === "function") {
    return runtime.db.transaction(async (tx) => {
      const count = await countBucketAttemptsPostgres(tx, {
        organizationId: input.organizationId,
        operatorId: input.operatorId,
        entityId,
      });
      if (count >= limit) {
        await writeAuditLogPostgres(tx, {
          actorType: "admin",
          actorId: input.operatorId,
          action: FHV_RATE_LIMIT_DENIED_ACTION,
          entityType: FHV_RATE_LIMIT_ENTITY,
          entityId,
          organizationId: input.organizationId,
          metadata: {
            actionClass: actionClass(input.action),
            timeBucket: timeBucket(nowMs),
            denied: true,
            attemptedAtUtc: new Date(nowMs).toISOString(),
          },
        });
        return { allowed: false, remaining: 0 };
      }
      await writeAuditLogPostgres(tx, {
        actorType: "admin",
        actorId: input.operatorId,
        action: FHV_RATE_LIMIT_ACTION,
        entityType: FHV_RATE_LIMIT_ENTITY,
        entityId,
        organizationId: input.organizationId,
        metadata: {
          actionClass: actionClass(input.action),
          timeBucket: timeBucket(nowMs),
          denied: false,
          attemptedAtUtc: new Date(nowMs).toISOString(),
        },
      });
      return { allowed: true, remaining: Math.max(0, limit - count - 1) };
    });
  }

  const count = await countBucketAttemptsPostgres(runtime.db, {
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    entityId,
  });
  if (count >= limit) {
    await recordFhvRateLimitEvent(runtime, { ...input, nowMs, denied: true });
    return { allowed: false, remaining: 0 };
  }
  await recordFhvRateLimitEvent(runtime, { ...input, nowMs, denied: false });
  return { allowed: true, remaining: Math.max(0, limit - count - 1) };
}

/** Test-only in-memory fallback for unit tests without DB wiring. */
const testBuckets = new Map<string, number[]>();

export function checkFhvAdminCommandRateLimitInMemory(
  key: string,
  nowMs = Date.now(),
  limit = FHV_COMMAND_RATE_LIMIT_PER_HOUR,
): FhvCommandRateLimitResult {
  const windowMs = 60 * 60 * 1000;
  const timestamps = (testBuckets.get(key) ?? []).filter((ts) => nowMs - ts < windowMs);
  if (timestamps.length >= limit) {
    testBuckets.set(key, timestamps);
    return { allowed: false, remaining: 0 };
  }
  timestamps.push(nowMs);
  testBuckets.set(key, timestamps);
  return { allowed: true, remaining: limit - timestamps.length };
}

export function resetFhvAdminCommandRateLimitsForTests(): void {
  testBuckets.clear();
}
