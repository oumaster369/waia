import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { traderRuntimeNoncapitalCyclesV2 as cycles } from "@/db/schema.postgres";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { assertRuntimeDatabaseClockHolderV2, lockRuntimeOrganizationV2,
  type DatabaseClockRuntimeHolderV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { runCanonicalOrdinaryCapitalCycleV2 } from "./canonical-recurring-cycle-v2";
import { SHADOW_PRE_QUALIFICATION_UNAVAILABLE_SOURCES, SHADOW_PRE_QUALIFICATION_ADMISSION } from "./shadow-canonical-runner-v2";
import { buildNoncapitalCycleReceiptV2, normalizeRecordedNoncapitalInputV2,
  recordedNoncapitalInputDigestV2, serializeNoncapitalCycleReceiptV2,
  type RecordedNoncapitalInputV2, type NoncapitalCycleReceiptV2 } from "./noncapital-cycle-receipt-v2";

/** Only inert recorded input. There is deliberately no injectable capital/source callback. */
export async function commitRecordedNoncapitalCyclePostgresV2(
  db: WaiaPostgresDb, context: OrgContext, holder: DatabaseClockRuntimeHolderV2,
  input: RecordedNoncapitalInputV2,
): Promise<Readonly<{ outcome: "COMMITTED" | "REPLAYED"; receipt: NoncapitalCycleReceiptV2 }>> {
  context = Object.freeze({ organizationId: context.organizationId });
  holder = Object.freeze({ organizationId: holder.organizationId, runtimeInstanceId: holder.runtimeInstanceId,
    leaseEpoch: holder.leaseEpoch, leaseContentDigest: holder.leaseContentDigest });
  const normalized = normalizeRecordedNoncapitalInputV2(input);
  if (context.organizationId !== normalized.organizationId || holder.organizationId !== context.organizationId) {
    throw new Error("NONCAPITAL_CYCLE_TENANT_MISMATCH");
  }
  const inputDigest = recordedNoncapitalInputDigestV2(normalized);
  return db.transaction(async tx => {
    await lockRuntimeOrganizationV2(tx, context.organizationId);
    // Even receipt replay through the owner requires the currently valid owner.
    await assertRuntimeDatabaseClockHolderV2(tx, holder);
    const existing = (await tx.select().from(cycles).where(and(
      eq(cycles.organizationId, context.organizationId), eq(cycles.accountId, normalized.accountId),
      eq(cycles.symbol, normalized.bar.symbol), eq(cycles.barInterval, normalized.bar.interval),
      eq(cycles.pitAnchor, normalized.bar.barCloseTime),
    )).limit(1))[0];
    if (existing) {
      if (existing.inputDigest !== inputDigest) throw new Error("NONCAPITAL_CYCLE_INPUT_CONFLICT");
      const receipt = JSON.parse(existing.canonicalJson) as NoncapitalCycleReceiptV2;
      if (serializeNoncapitalCycleReceiptV2(receipt) !== existing.canonicalJson ||
          receipt.inputDigest !== inputDigest || receipt.contentDigest !== existing.contentDigest ||
          receipt.holder.organizationId !== context.organizationId ||
          receipt.holder.runtimeInstanceId !== existing.runtimeInstanceId ||
          receipt.holder.leaseEpoch !== existing.leaseEpoch ||
          receipt.holder.leaseContentDigest !== existing.leaseContentDigest ||
          Date.parse(receipt.recordedAtUtc) !== Date.parse(existing.recordedAtUtc)) {
        throw new Error("NONCAPITAL_CYCLE_RECEIPT_CORRUPT");
      }
      await assertRuntimeDatabaseClockHolderV2(tx, holder);
      return { outcome: "REPLAYED" as const, receipt };
    }
    const result = await runCanonicalOrdinaryCapitalCycleV2({
      epistemic: { kind: "CONTEXT_UNAVAILABLE", sources: SHADOW_PRE_QUALIFICATION_UNAVAILABLE_SOURCES,
        predictiveAdmissionVerdict: SHADOW_PRE_QUALIFICATION_ADMISSION },
      capitalRequest: { executionMode: "paper" },
    });
    const recordedAtUtc = await assertRuntimeDatabaseClockHolderV2(tx, holder);
    const receipt = buildNoncapitalCycleReceiptV2(normalized, holder, recordedAtUtc, result);
    await tx.insert(cycles).values({ organizationId: normalized.organizationId, accountId: normalized.accountId,
      symbol: normalized.bar.symbol, barInterval: normalized.bar.interval, pitAnchor: normalized.bar.barCloseTime,
      inputDigest, contentDigest: receipt.contentDigest, canonicalJson: serializeNoncapitalCycleReceiptV2(receipt),
      runtimeInstanceId: holder.runtimeInstanceId, leaseEpoch: holder.leaseEpoch,
      leaseContentDigest: holder.leaseContentDigest, recordedAtUtc });
    await assertRuntimeDatabaseClockHolderV2(tx, holder);
    // The deferred database trigger additionally fences an outer/held transaction at actual commit.
    return { outcome: "COMMITTED" as const, receipt };
  });
}

/** Acknowledges only this supplied ordered prefix; it is not a complete market-stream frontier. */
export async function runRecordedNoncapitalPrefixPostgresV2(
  db: WaiaPostgresDb, context: OrgContext, holder: DatabaseClockRuntimeHolderV2,
  inputs: readonly RecordedNoncapitalInputV2[],
): Promise<readonly NoncapitalCycleReceiptV2[]> {
  const normalized = inputs.map(normalizeRecordedNoncapitalInputV2);
  for (let index = 1; index < normalized.length; index++) {
    const before = normalized[index - 1]!; const current = normalized[index]!;
    if (before.organizationId !== current.organizationId || before.accountId !== current.accountId ||
        before.bar.symbol !== current.bar.symbol || before.bar.interval !== current.bar.interval ||
        before.releaseSha !== current.releaseSha || before.bar.barCloseTime >= current.bar.barCloseTime) {
      throw new Error("NONCAPITAL_CYCLE_PREFIX_INVALID");
    }
  }
  const receipts: NoncapitalCycleReceiptV2[] = [];
  for (const input of normalized) {
    receipts.push((await commitRecordedNoncapitalCyclePostgresV2(db, context, holder, input)).receipt);
  }
  return receipts;
}
