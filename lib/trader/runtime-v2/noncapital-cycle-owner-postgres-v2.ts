import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { Sql as PostgresSql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as allSchema from "@/db/schema.postgres";
import { assertEnvironment, assertSession, copy, digest, seal, requireCondition as check, ANALYSIS_CONTRACT,
  type AnalysisSession } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import { requireAnalysisPool, readRecordedAnalysis, readAnalysisWithinTransaction, precedingAnalysis,
  verifyRecordedSources, encodeBody, holderColumns } from "@/lib/trader/paper/durable-noncapital/repository-postgres-v1";
import { evaluateRecordedAnalysis } from "@/lib/trader/paper/durable-noncapital/evaluate-recorded-analysis-v1";

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
  return db.transaction(tx => commitRecordedNoncapitalWithinTransaction(tx, context, holder, normalized));
}

// Private held core. The old public API still permits its accepted held-transaction callers.
async function commitRecordedNoncapitalWithinTransaction(
  tx: Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0], context: OrgContext,
  holder: DatabaseClockRuntimeHolderV2, normalized: RecordedNoncapitalInputV2,
) {
  const inputDigest = recordedNoncapitalInputDigestV2(normalized);
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


/** Full new completion owns its evaluator, transaction and output; no injected authority callback. */
export async function completeRecordedAnalysisPostgresV1(
  pool: PostgresSql, session: AnalysisSession, holder: DatabaseClockRuntimeHolderV2, sequence: number,
) {
  requireAnalysisPool(pool); assertEnvironment(); session = copy(session); holder = copy(holder); assertSession(session);
  check(holder.organizationId === session.organizationId, "TENANT_MISMATCH");
  const saved = await readRecordedAnalysis(pool, session, sequence);
  check(saved.packet, "PACKET_MISSING");
  // Every explicit completion/replay verifies the fixed evaluator against the exact saved input.
  // An incompatible evaluator result refuses replay; immutable history is never rewritten.
  const output = evaluateRecordedAnalysis(saved.packet);
  return drizzle(pool, { schema: allSchema }).transaction(async tx => {
    const db = tx;
    await lockRuntimeOrganizationV2(tx, session.organizationId);
    await assertRuntimeDatabaseClockHolderV2(tx, holder);
    const current = await readAnalysisWithinTransaction(db, session, sequence);
    check(current.packet && current.packet.contentDigest === saved.packet!.contentDigest, "PACKET_CONFLICT");
    const packet = current.packet;
    const previous = await precedingAnalysis(db, session, sequence);
    check(packet.previousCompletionDigest === previous.digest && packet.previousStateDigest === digest(previous.state), "PREDECESSOR_CONFLICT");
    await verifyRecordedSources(db, packet);
    const input = normalizeRecordedNoncapitalInputV2({ organizationId: session.organizationId, accountId: session.accountId,
      releaseSha: session.releaseSha, bar: packet.normalized.bars["1m"]!.at(-1)! });
    const old = (await db.select().from(cycles).where(and(eq(cycles.organizationId, session.organizationId),
      eq(cycles.accountId, session.accountId), eq(cycles.symbol, session.symbol), eq(cycles.barInterval, "1m"),
      eq(cycles.pitAnchor, input.bar.barCloseTime))))[0];
    if (current.companion) {
      check(digest(output) === digest(current.companion.output), "ANALYTICAL_REPLAY_CONFLICT");
      check(old && current.companion.canonicalReceiptDigest === old.contentDigest, "CANONICAL_RECEIPT_CONFLICT");
      const terminal = await commitRecordedNoncapitalWithinTransaction(tx, { organizationId: session.organizationId }, holder, input);
      check(terminal.receipt.contentDigest === current.companion.canonicalReceiptDigest, "CANONICAL_RECEIPT_CONFLICT");
      return { outcome: "REPLAYED" as const, packet, companion: current.companion, receipt: terminal.receipt };
    }
    check(!old, "LEGACY_ONLY_OWNER_CONFLICT");
    const terminal = await commitRecordedNoncapitalWithinTransaction(tx, { organizationId: session.organizationId }, holder, input);
    check(terminal.outcome === "COMMITTED", "LEGACY_ONLY_OWNER_CONFLICT");
    const companion = seal({ schemaVersion: ANALYSIS_CONTRACT, organizationId: session.organizationId, sessionId: session.sessionId,
      sequence, packetDigest: packet.contentDigest, previousCompletionDigest: previous.digest,
      canonicalReceiptDigest: terminal.receipt.contentDigest, output });
    await db.insert(allSchema.traderRecordedAnalysisCompanionsV1).values({ organizationId: session.organizationId, sessionId: session.sessionId,
      sequence, packetDigest: packet.contentDigest, accountId: session.accountId, symbol: session.symbol, barInterval: "1m",
      scheduledBarCloseTime: input.bar.barCloseTime, contentDigest: companion.contentDigest,
      bodyJson: encodeBody(companion), ...holderColumns(holder) });
    await assertRuntimeDatabaseClockHolderV2(tx, holder);
    return { outcome: "COMMITTED" as const, packet, companion, receipt: terminal.receipt };
  }, { isolationLevel: "read committed" });
}
