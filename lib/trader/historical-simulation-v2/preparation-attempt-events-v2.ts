import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { bindPostgresReservedSession } from "@/db/postgres-session-transaction";
import { withHistoricalLaunchCleanupV2 } from "./launch-cleanup-v2";
import { requireHistoricalSimulationRunnerLoginV2,
  assumeHistoricalSimulationRunnerRoleV2, resetHistoricalSimulationRunnerRoleV2 } from
  "./historical-runner-role-v2";
import type { TechnicalPreparationProgressV2 } from "./technical-preparation-observer-v2";

export type PreparationAttemptScopeV2 = Readonly<{
  organizationId: string; runId: string; releaseSha: string;
  requestId: string; requestContentDigestHex: string;
}>;
export type PreparationPublicErrorV2 = "CANCELLED" | "CONNECTION_LOST" |
  "SCIENTIFIC_PREPARATION_REFUSED" | "PREPARATION_FAILED";

/** Never publishes raw message, stack, arbitrary thrown object or connection data. */
export function classifyPreparationFailureV2(error: unknown): PreparationPublicErrorV2 {
  let message: unknown; let code: unknown;
  try {
    if (!(error instanceof Error)) return "PREPARATION_FAILED";
    message = Object.getOwnPropertyDescriptor(error, "message")?.value;
    code = Object.getOwnPropertyDescriptor(error, "code")?.value;
  } catch { return "PREPARATION_FAILED"; }
  if (message === "TECHNICAL_PREPARATION_CANCELLED") return "CANCELLED";
  if (code === "CONNECTION_CLOSED" || code === "CONNECTION_ENDED") return "CONNECTION_LOST";
  if (typeof message === "string" && /^HISTORICAL_.*_REFUSED:[A-Z_]+$/.test(message)) {
    return "SCIENTIFIC_PREPARATION_REFUSED";
  }
  return "PREPARATION_FAILED";
}

type EventInput = Readonly<{
  phase: "STARTED" | "PROGRESS" | "FAILED" | "PROPOSAL_AVAILABLE";
  progressPhase?: Exclude<TechnicalPreparationProgressV2["phase"], "FINALIZATION_REPLAY">;
  completed?: number; total?: number; errorCode?: PreparationPublicErrorV2; proposalId?: string;
  surfaceKey?: string; trialIdentityDigestHex?: string;
}>;

export const PREPARATION_JOURNAL_WRITE_DEADLINE_MS = 15_000;

/** Journal I/O only; never changes the scientific computation's time budget. */
async function boundedJournalWrite<T>(pool: postgres.Sql, operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("PREPARATION_JOURNAL_WRITE_TIMEOUT"));
      // Invalidate this dedicated pool, not the compute session. Its uncertain
      // INSERT is not retried or declared absent/successful.
      void pool.end({ timeout: 0 }).catch(() => undefined);
    }, PREPARATION_JOURNAL_WRITE_DEADLINE_MS);
  });
  try { return await Promise.race([operation(), deadline]); }
  finally { if (timer) clearTimeout(timer); }
}

/** Separate pool: never enqueue journal writes behind the reserved compute session. */
export async function createPreparationAttemptJournalV2(
  pool: postgres.Sql, requestedScope: PreparationAttemptScopeV2,
) {
  const scope = Object.freeze({ ...requestedScope });
  const attemptId = randomUUID();
  let nextSequence = 0;
  let terminal = false;
  const write = (event: EventInput) => boundedJournalWrite(pool, async () => {
    if (terminal) throw new Error("PREPARATION_EVENT_ALREADY_TERMINAL");
    const reserved = await pool.reserve();
    const sql = bindPostgresReservedSession(pool, reserved);
    let assumed = false;
    await withHistoricalLaunchCleanupV2(async () => {
      await requireHistoricalSimulationRunnerLoginV2(sql);
      await assumeHistoricalSimulationRunnerRoleV2(sql); assumed = true;
      // One autocommit statement; its trigger serializes only diagnostic events.
      await sql`INSERT INTO trader_historical_preparation_event_v2
        (organization_id,run_id,release_sha,request_id,request_content_digest_hex,
         attempt_id,event_sequence,phase,progress_phase,completed,total,error_code,proposal_id,
         surface_key,trial_identity_digest_hex)
        VALUES (${scope.organizationId}::uuid,${scope.runId},${scope.releaseSha},
          ${scope.requestId}::uuid,${scope.requestContentDigestHex},${attemptId}::uuid,
          ${nextSequence},${event.phase},${event.progressPhase ?? null},
          ${event.completed ?? null},${event.total ?? null},${event.errorCode ?? null},
          ${event.proposalId ?? null}::uuid,${event.surfaceKey ?? null},${event.trialIdentityDigestHex ?? null})`;
      nextSequence += 1;
      terminal = event.phase === "FAILED" || event.phase === "PROPOSAL_AVAILABLE";
    }, [async () => { if (assumed) await resetHistoricalSimulationRunnerRoleV2(sql); },
      () => reserved.release()]);
  });
  await write({ phase: "STARTED" });
  let pending: EventInput | undefined;
  let writing: Promise<void> | undefined;
  let writeFailure: unknown;
  let failed = false;
  const drain = async () => {
    while (pending) {
      const event = pending; pending = undefined;
      await write(event);
    }
  };
  const flush = async () => {
    while (writing || pending) {
      if (!writing) startDrain();
      await writing;
    }
    if (failed) throw writeFailure;
  };
  const startDrain = () => {
    writing = drain().catch(error => { failed = true; writeFailure = error; pending = undefined; })
      .finally(() => { writing = undefined; });
  };
  return Object.freeze({
    attemptId,
    progress(event: TechnicalPreparationProgressV2): void {
      if (failed) throw writeFailure;
      if (terminal || event.organizationId !== scope.organizationId || event.runId !== scope.runId ||
          event.releaseSha !== scope.releaseSha || event.authorityGranted !== false ||
          event.phase === "FINALIZATION_REPLAY") throw new Error("PREPARATION_EVENT_SCOPE");
      if ((event.surfaceKey !== undefined && !/^(BTCUSDT|ETHUSDT):(30|60)$/.test(event.surfaceKey)) ||
          (event.trialIdentityDigestHex !== undefined && !/^[0-9a-f]{64}$/.test(event.trialIdentityDigestHex))) {
        throw new Error("PREPARATION_EVENT_IDENTITY");
      }
      const hasCounters = event.completed !== undefined || event.total !== undefined;
      if (hasCounters && (!Number.isSafeInteger(event.completed) || !Number.isSafeInteger(event.total) ||
          event.completed! < 0 || event.total! <= 0 || event.completed! > event.total!)) {
        throw new Error("PREPARATION_EVENT_COUNTERS");
      }
      // At most one in-flight write and one latest pending snapshot. These are
      // observed counters, not a lossless resample log or estimated percentage.
      pending = { phase: "PROGRESS", progressPhase: event.phase,
        completed: event.completed, total: event.total, surfaceKey: event.surfaceKey,
        trialIdentityDigestHex: event.trialIdentityDigestHex };
      if (!writing) startDrain();
    },
    async complete(proposalId: string) { await flush(); await write({ phase: "PROPOSAL_AVAILABLE", proposalId }); },
    async fail(error: unknown) {
      if (terminal) return;
      let progressError: unknown; let progressFailed = false;
      try { await flush(); } catch (cause) { progressFailed = true; progressError = cause; }
      // A broken progress transaction must not suppress an independently
      // writable terminal error. Ambiguous sequence/connection failure still
      // refuses; never claim that the failed-state write succeeded.
      try { await write({ phase: "FAILED", errorCode: classifyPreparationFailureV2(error) }); }
      catch (cause) {
        if (progressFailed) throw new AggregateError([progressError, cause], "PREPARATION_JOURNAL_FAILURE");
        throw cause;
      }
      if (progressFailed) throw progressError;
    },
  });
}

export async function readPreparationAttemptV2(sql: postgres.Sql, scope: PreparationAttemptScopeV2) {
  const rows = await sql<Array<{ attempt_id: string; phase: EventInput["phase"];
    progress_phase: string | null; completed: string | number | null; total: string | number | null;
    error_code: PreparationPublicErrorV2 | null; observed_at: string;
    surface_key: string | null; trial_identity_digest_hex: string | null }>>`
    SELECT attempt_id::text,phase,progress_phase,completed::text,total::text,error_code,
      surface_key,trial_identity_digest_hex,
      to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
    FROM trader_historical_preparation_event_v2
    WHERE organization_id=${scope.organizationId}::uuid AND run_id=${scope.runId}
      AND release_sha=${scope.releaseSha} AND request_id=${scope.requestId}::uuid
      AND request_content_digest_hex=${scope.requestContentDigestHex}
      AND attempt_id=(SELECT attempt_id FROM trader_historical_preparation_event_v2
        WHERE organization_id=${scope.organizationId}::uuid AND run_id=${scope.runId}
          AND release_sha=${scope.releaseSha} AND request_id=${scope.requestId}::uuid
          AND request_content_digest_hex=${scope.requestContentDigestHex} AND phase='STARTED'
        ORDER BY id DESC LIMIT 1)
    ORDER BY event_sequence DESC LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  return Object.freeze({ attemptId: row.attempt_id, phase: row.phase,
    progressPhase: row.progress_phase, completed: row.completed, total: row.total,
    surfaceKey: row.surface_key, trialIdentityDigestHex: row.trial_identity_digest_hex,
    errorCode: row.error_code, observedAt: row.observed_at, authorityGranted: false as const });
}
