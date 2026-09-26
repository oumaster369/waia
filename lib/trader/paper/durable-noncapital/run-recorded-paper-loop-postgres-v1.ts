import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { claimRuntimeControlLeaseAtDatabaseTimeV2, readRuntimeDatabaseClockV2,
  assertRuntimeDatabaseClockHolderV2, lockRuntimeOrganizationV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { completeRecordedAnalysisPostgresV1 } from "@/lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2";
import { captureRecordedLoop, assertEnvironment, RecordedAnalysisRefusal, requireCondition as check,
  type RecordedLoopInput } from "./recorded-analysis-v1";
import { captureMandatoryBundle, normalizeMandatory } from "./normalize-mandatory-packet-v1";
import { readRecordedAnalysis, publishRecordedAnalysis, requireAnalysisPool } from "./repository-postgres-v1";

/** No source/evaluator/capital callback is accepted. Transport substitution is test process fetch only. */
export async function runRecordedPaperLoopPostgres(pool: postgres.Sql, input: RecordedLoopInput) {
  requireAnalysisPool(pool); assertEnvironment(); const { session, startSequence } = captureRecordedLoop(input);
  const db = drizzle(pool, { schema });
  const holder = await claimRuntimeControlLeaseAtDatabaseTimeV2(db, { organizationId: session.organizationId,
    runtimeInstanceId: `recorded-analysis:${randomUUID()}`, durationMs: session.leaseDurationMs });
  if (!holder) return { status: "LEASE_BUSY" as const, completed: [] };
  const completed: Array<{ sequence: number; outcome: "COMMITTED" | "REPLAYED"; packetDigest: string; companionDigest: string; sourceOutcomes: Array<{ status: string; reason: string | null }> }> = [];
  try {
    for (let offset = 0; offset < session.maxCycles; offset++) {
      const sequence = startSequence + offset;
      assertEnvironment();
      const saved = await readRecordedAnalysis(pool, session, sequence);
      if (!saved.packet) {
        const previous = sequence > 0 ? await readRecordedAnalysis(pool, session, sequence - 1) : null;
        check(!previous || previous.companion, "PREDECESSOR_MISSING");
        if (previous) {
          const interval = 60_000;
          // Strict next existing minute boundary: exact boundary waits a whole minute.
          await new Promise(resolve => setTimeout(resolve, interval - Date.now() % interval));
        }
        await db.transaction(async tx => {
          await lockRuntimeOrganizationV2(tx, session.organizationId); await assertRuntimeDatabaseClockHolderV2(tx, holder);
        }, { isolationLevel: "read committed" });
        // Lazy construction: a published/completed replay never owns a provider capability.
        const source = new HtxBarPollSource({ internalSymbol: session.symbol, disableOptionalProviders: true });
        const bundle = await source.fetchMandatoryEvaluationBundle();
        const captured = captureMandatoryBundle(bundle, session);
        const pit = await db.transaction(tx => readRuntimeDatabaseClockV2(tx), { isolationLevel: "read committed", accessMode: "read only" });
        const normalized = normalizeMandatory(captured, session, pit);
        check(!previous || previous.packet!.normalized.scheduledBarCloseTime < normalized.scheduledBarCloseTime, "SOURCE_NOT_ADVANCED");
        await publishRecordedAnalysis(pool, session, holder, sequence, pit, normalized);
      }
      const result = await completeRecordedAnalysisPostgresV1(pool, session, holder, sequence);
      completed.push({ sequence, outcome: result.outcome, packetDigest: result.packet.contentDigest, companionDigest: result.companion.contentDigest,
        sourceOutcomes: result.packet.sources.map(source => ({ status: source.receipt.status, reason: source.receipt.reason })) });
    }
    return { status: "COMPLETE" as const, completed };
  } catch (error) {
    if (error instanceof RecordedAnalysisRefusal) return { status: error.code, completed };
    if (error instanceof Error && error.message === "RUNTIME_CONTROL_LEASE_STALE_HOLDER") return { status: "LEASE_LOST", completed };
    // Infrastructure failures retain their error semantics. The CLI emits a fixed, payload-free code.
    throw error;
  }
}
