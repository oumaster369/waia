import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { eq, sql } from "drizzle-orm";
import { traderRuntimeControlLeaseHeadsV2 } from "@/db/schema.postgres";
import type { WaiaPostgresDb, WaiaPostgresTransactionCallback } from "@/db/waia-postgres-transaction";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { createPostgresRuntimeControlLeaseRepositoryV2 } from "./runtime-authority-repository-postgres-v2";
import type { RuntimeControlLeaseClaimV2 } from "./runtime-authority-repository-v2";

type Transaction = Parameters<WaiaPostgresTransactionCallback<unknown>>[0];
export type DatabaseClockRuntimeHolderV2 = Pick<RuntimeControlLeaseClaimV2,
  "organizationId" | "runtimeInstanceId" | "leaseEpoch" | "leaseContentDigest">;

/** Operational clock only. The existing deterministic adjudication/replay API is unchanged. */
export async function readRuntimeDatabaseClockV2(tx: Transaction): Promise<string> {
  const rows = await tx.execute<{ now: string }>(sql`select to_char(clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`);
  return rows[0]!.now;
}

export async function lockRuntimeOrganizationV2(tx: Transaction, organizationId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 637))`);
}

/** Caller holds lockRuntimeOrganizationV2 until commit. Never use the bar's PIT as operational time. */
export async function assertRuntimeDatabaseClockHolderV2(
  tx: Transaction, holder: DatabaseClockRuntimeHolderV2,
): Promise<string> {
  // A held REPEATABLE READ snapshot must not revive a head replaced before lock acquisition.
  // FOR UPDATE forces a serialization refusal if this row changed after that snapshot.
  await tx.select().from(traderRuntimeControlLeaseHeadsV2)
    .where(eq(traderRuntimeControlLeaseHeadsV2.organizationId, holder.organizationId)).for("update");
  const now = await readRuntimeDatabaseClockV2(tx);
  await createPostgresRuntimeControlLeaseRepositoryV2(tx).assertCurrentHolder({ ...holder, adjudicatedAtUtc: now });
  return now;
}

/** A lease is operational exclusion, not qualification, readiness, or capital authority. No renewal. */
export async function claimRuntimeControlLeaseAtDatabaseTimeV2(
  db: WaiaPostgresDb,
  input: Readonly<{ organizationId: string; runtimeInstanceId: string; durationMs: number }>,
): Promise<RuntimeControlLeaseClaimV2 | null> {
  input = Object.freeze({ organizationId: input.organizationId, runtimeInstanceId: input.runtimeInstanceId, durationMs: input.durationMs });
  if (!input.organizationId.trim() || !input.runtimeInstanceId.trim()) {
    throw new Error("RUNTIME_CONTROL_LEASE_INVALID_IDENTITY");
  }
  // A bounded integer duration is supplied by the local owner; no trading TTL is changed.
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > 2_147_483_647) {
    throw new Error("RUNTIME_CONTROL_LEASE_INVALID_DURATION");
  }
  return db.transaction(async tx => {
    await lockRuntimeOrganizationV2(tx, input.organizationId);
    const adjudicatedAtUtc = await readRuntimeDatabaseClockV2(tx);
    const repository = createPostgresRuntimeControlLeaseRepositoryV2(tx);
    const current = await repository.current(input.organizationId);
    if (current && Date.parse(adjudicatedAtUtc) <= Date.parse(current.validUntilUtc)) return null;
    const body = {
      organizationId: input.organizationId, runtimeInstanceId: input.runtimeInstanceId,
      leaseEpoch: (current?.leaseEpoch ?? 0) + 1,
      expectedPreviousDigest: current?.leaseContentDigest ?? null,
      adjudicatedAtUtc,
      validUntilUtc: new Date(Date.parse(adjudicatedAtUtc) + input.durationMs).toISOString(),
    };
    if (body.leaseEpoch > 2_147_483_647) throw new Error("RUNTIME_CONTROL_LEASE_EPOCH_EXHAUSTED");
    const value = Object.freeze({ ...body, leaseContentDigest: computeSemanticSha256Hex({
      schemaVersion: "waia.trader.database_clock_control_lease.v2", ...body,
    }) });
    if (await repository.claimExclusive(value) !== "CLAIMED") return null;
    await assertRuntimeDatabaseClockHolderV2(tx, value);
    return value;
  });
}
