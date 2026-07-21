import { and, eq, gte } from "drizzle-orm";

import { auditLogs } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { FHV_COMMAND_RATE_LIMIT_PER_HOUR } from "@/lib/trader/observability/fhv-observability.constants";
import { writeAuditLogPostgres, writeAuditLogSqlite } from "@/lib/waia-core/audit/write";

const FHV_RATE_LIMIT_ENTITY = "fhv_operator_command";
const FHV_RATE_LIMIT_ACTION = "fhv.operator.command.attempt";

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

export async function checkAndRecordFhvCommandRateLimit(
  runtime: WaiaRuntimeDb,
  input: FhvCommandRateLimitInput,
): Promise<FhvCommandRateLimitResult> {
  const nowMs = input.nowMs ?? Date.now();
  const limit = input.limit ?? FHV_COMMAND_RATE_LIMIT_PER_HOUR;
  const windowStart = new Date(nowMs - 60 * 60 * 1000);

  const count = await countRecentFhvCommandAttempts(runtime, {
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    windowStart,
  });

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  await recordFhvCommandAttempt(runtime, {
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    action: input.action,
    nowMs,
  });

  return { allowed: true, remaining: Math.max(0, limit - count - 1) };
}

async function countRecentFhvCommandAttempts(
  runtime: WaiaRuntimeDb,
  input: { organizationId: string; operatorId: string; windowStart: Date },
): Promise<number> {
  if (runtime.kind === "sqlite") {
    const rows = runtime.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, input.organizationId),
          eq(auditLogs.entityType, FHV_RATE_LIMIT_ENTITY),
          eq(auditLogs.actorId, input.operatorId),
          eq(auditLogs.action, FHV_RATE_LIMIT_ACTION),
          gte(auditLogs.createdAt, input.windowStart),
        ),
      )
      .all();
    return rows.length;
  }

  const rows = await runtime.db
    .select({ id: pgSchema.auditLogs.id })
    .from(pgSchema.auditLogs)
    .where(
      and(
        eq(pgSchema.auditLogs.organizationId, input.organizationId),
        eq(pgSchema.auditLogs.entityType, FHV_RATE_LIMIT_ENTITY),
        eq(pgSchema.auditLogs.actorId, input.operatorId),
        eq(pgSchema.auditLogs.action, FHV_RATE_LIMIT_ACTION),
        gte(pgSchema.auditLogs.createdAt, input.windowStart),
      ),
    );
  return rows.length;
}

async function recordFhvCommandAttempt(
  runtime: WaiaRuntimeDb,
  input: { organizationId: string; operatorId: string; action: string; nowMs: number },
): Promise<void> {
  const payload = {
    actorType: "admin" as const,
    actorId: input.operatorId,
    action: FHV_RATE_LIMIT_ACTION,
    entityType: FHV_RATE_LIMIT_ENTITY,
    entityId: input.action,
    organizationId: input.organizationId,
    metadata: { action: input.action, attemptedAtUtc: new Date(input.nowMs).toISOString() },
  };
  if (runtime.kind === "sqlite") {
    writeAuditLogSqlite(runtime.db, payload);
    return;
  }
  await writeAuditLogPostgres(runtime.db, payload);
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
