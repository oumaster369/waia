import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { claimRuntimeControlLeaseAtDatabaseTimeV2, readRuntimeDatabaseClockV2,
  assertRuntimeDatabaseClockHolderV2, lockRuntimeOrganizationV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { claimRecordedAcquisitionWithinHeldTransactionV1, lockRecordedAcquisitionOrganizationV1,
  assertRecordedAcquisitionHolderWithinHeldTransactionV1, type RecordedAcquisitionHolderV1 } from "@/lib/trader/runtime-authority/v2/noncapital-domain-lease-postgres-v1";
import type { DatabaseClockRuntimeHolderV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { ResearchRefusal } from "../research-understanding-v1/contract";
import { completeRecordedAnalysisPostgresV1, completeRecordedAcquisitionAnalysisPostgresV1 } from "@/lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2";
import { captureRecordedLoop, assertEnvironment, RecordedAnalysisRefusal, requireCondition as check,
  type RecordedLoopInput } from "./recorded-analysis-v1";
import { captureMandatoryBundle, normalizeMandatory } from "./normalize-mandatory-packet-v1";
import { readRecordedAnalysis, publishRecordedAnalysis, readRecordedAcquisitionAnalysis, publishRecordedAcquisitionAnalysis, requireAnalysisPool } from "./repository-postgres-v1";

/** No source/evaluator/capital callback is accepted. Transport substitution is test process fetch only. */
export async function runRecordedPaperLoopPostgres(pool: postgres.Sql, input: RecordedLoopInput) {
  return runRecordedLoopCore(pool, input, "CAPITAL_LEGACY_V2");
}
export async function runRecordedAcquisitionLoopPostgres(pool: postgres.Sql, input: RecordedLoopInput) {
  return runRecordedLoopCore(pool, input, "RECORDED_ACQUISITION_V1");
}
async function runRecordedLoopCore(pool: postgres.Sql, input: RecordedLoopInput, domain: "CAPITAL_LEGACY_V2" | "RECORDED_ACQUISITION_V1") {
  requireAnalysisPool(pool); assertEnvironment(); const { session, startSequence } = captureRecordedLoop(input);
  const db = drizzle(pool, { schema });
  const claimInput = { organizationId: session.organizationId, runtimeInstanceId: `recorded-analysis:${randomUUID()}`, durationMs: session.leaseDurationMs };
  type SelectedLease = { domain: "CAPITAL_LEGACY_V2"; holder: DatabaseClockRuntimeHolderV2 | null }
    | { domain: "RECORDED_ACQUISITION_V1"; holder: RecordedAcquisitionHolderV1 | null };
  const lease: SelectedLease = domain === "RECORDED_ACQUISITION_V1"
    ? { domain, holder: await db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '5s'`); await tx.execute(sql`set local statement_timeout = '30s'`);
      return claimRecordedAcquisitionWithinHeldTransactionV1(tx, claimInput);
    }, { isolationLevel: "read committed" }) }
    : { domain, holder: await claimRuntimeControlLeaseAtDatabaseTimeV2(db, claimInput) };
  if (!lease.holder) return { status: "LEASE_BUSY" as const, completed: [] };
  const read = (sequence: number) => domain === "RECORDED_ACQUISITION_V1"
    ? readRecordedAcquisitionAnalysis(pool, session, sequence) : readRecordedAnalysis(pool, session, sequence);
  const completed: Array<{ sequence: number; outcome: "COMMITTED" | "REPLAYED"; packetDigest: string; companionDigest: string; sourceOutcomes: Array<{ status: string; reason: string | null }> }> = [];
  try {
    for (let offset = 0; offset < session.maxCycles; offset++) {
      const sequence = startSequence + offset;
      assertEnvironment();
      const saved = await read(sequence);
      if (!saved.packet) {
        const previous = sequence > 0 ? await read(sequence - 1) : null;
        check(!previous || previous.companion, "PREDECESSOR_MISSING");
        if (previous) {
          const interval = 60_000;
          // Strict next existing minute boundary: exact boundary waits a whole minute.
          await new Promise(resolve => setTimeout(resolve, interval - Date.now() % interval));
        }
        await db.transaction(async tx => {
          if (lease.domain === "RECORDED_ACQUISITION_V1") {
            await lockRecordedAcquisitionOrganizationV1(tx, session.organizationId); await assertRecordedAcquisitionHolderWithinHeldTransactionV1(tx, lease.holder!);
          } else { await lockRuntimeOrganizationV2(tx, session.organizationId); await assertRuntimeDatabaseClockHolderV2(tx, lease.holder!); }
        }, { isolationLevel: "read committed" });
        // Lazy construction: a published/completed replay never owns a provider capability.
        const source = new HtxBarPollSource({ internalSymbol: session.symbol, disableOptionalProviders: true });
        const bundle = await source.fetchMandatoryEvaluationBundle();
        const captured = captureMandatoryBundle(bundle, session);
        const pit = await db.transaction(tx => readRuntimeDatabaseClockV2(tx), { isolationLevel: "read committed", accessMode: "read only" });
        const normalized = normalizeMandatory(captured, session, pit);
        check(!previous || previous.packet!.normalized.scheduledBarCloseTime < normalized.scheduledBarCloseTime, "SOURCE_NOT_ADVANCED");
        if (lease.domain === "RECORDED_ACQUISITION_V1") await publishRecordedAcquisitionAnalysis(pool, session, lease.holder, sequence, pit, normalized);
        else await publishRecordedAnalysis(pool, session, lease.holder, sequence, pit, normalized);
      }
      const result = lease.domain === "RECORDED_ACQUISITION_V1"
        ? await completeRecordedAcquisitionAnalysisPostgresV1(pool, session, lease.holder, sequence)
        : await completeRecordedAnalysisPostgresV1(pool, session, lease.holder, sequence);
      completed.push({ sequence, outcome: result.outcome, packetDigest: result.packet.contentDigest, companionDigest: result.companion.contentDigest,
        sourceOutcomes: result.packet.sources.map(source => ({ status: source.receipt.status, reason: source.receipt.reason })) });
    }
    return { status: "COMPLETE" as const, completed };
  } catch (error) {
    if (error instanceof RecordedAnalysisRefusal || (domain === "RECORDED_ACQUISITION_V1" && error instanceof ResearchRefusal)) return { status: error.code, completed };
    if (error instanceof Error && error.message === "RUNTIME_CONTROL_LEASE_STALE_HOLDER") return { status: "LEASE_LOST", completed };
    // Infrastructure failures retain their error semantics. The CLI emits a fixed, payload-free code.
    throw error;
  }
}
