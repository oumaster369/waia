import type postgres from "postgres";

import { withPostgresSessionTransaction } from "@/db/postgres-session-transaction";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type {
  HistoricalSimulationH5ContinuationAuthorityV2,
  HistoricalSimulationLaunchIdentityV2,
  HistoricalSimulationRunLifecyclePortV2,
} from "./launch-orchestrator-v2";
import {
  assertHistoricalSimulationRunLifecycleEventV2,
  buildHistoricalSimulationRunLifecycleEventV2,
  type HistoricalSimulationRunLifecycleEventV2,
} from "./run-lifecycle-v2";

type EventRow = Readonly<{ event_json: HistoricalSimulationRunLifecycleEventV2 }>;
type H5AuthorizationRow = Readonly<{ authorization_event_json: HistoricalSimulationRunLifecycleEventV2;
  paused_event_json: HistoricalSimulationRunLifecycleEventV2 }>;
type Sql = postgres.Sql;
const H5_PAUSE_ACTION = "PAUSE_AT_CHECKPOINT" as const;
const H5_RESUME_ACTION = "RESUME_FROM_CHECKPOINT" as const;

function lockKey(organizationId: string, runId: string): string {
  return `waia:historical-simulation-v2:lifecycle:${organizationId}:${runId}`;
}

function consumerLeaseKey(organizationId: string, runId: string): string {
  return `waia:historical-simulation-v2:consumer:${organizationId}:${runId}`;
}

async function lock(tx: Sql, organizationId: string, runId: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(organizationId, runId)},0))`;
}

async function latest(tx: Sql, organizationId: string, runId: string):
Promise<HistoricalSimulationRunLifecycleEventV2 | null> {
  const rows = await tx<EventRow[]>`
    SELECT event_json
    FROM trader_historical_simulation_run_lifecycle_event_v2
    WHERE organization_id=${organizationId}::uuid AND run_id=${runId}
    ORDER BY event_sequence DESC LIMIT 1
  `;
  return rows[0] ? assertHistoricalSimulationRunLifecycleEventV2(rows[0].event_json) : null;
}

async function insert(tx: Sql, event: HistoricalSimulationRunLifecycleEventV2): Promise<void> {
  assertHistoricalSimulationRunLifecycleEventV2(event);
  const rows = await tx<{ content_digest_hex: string }[]>`
    INSERT INTO trader_historical_simulation_run_lifecycle_event_v2 (
      organization_id,run_id,event_sequence,account_id,partition,symbol,phase,
      initial_record_index,terminal_record_index_exclusive,qualified_total_cycles,
      committed_cycles,next_cycle_sequence,latest_committed_cycle_id,
      requested_by_operator_id,observed_at,error_code,previous_content_digest_hex,
      content_digest_hex,event_json,schema_version
    ) VALUES (
      ${event.organizationId}::uuid,${event.runId},${event.eventSequence},${event.accountId},
      ${event.partition},${event.symbol},${event.phase},${event.initialRecordIndex},
      ${event.terminalRecordIndexExclusive},${event.qualifiedTotalCycles},${event.committedCycles},
      ${event.nextCycleSequence},${event.latestCommittedCycleId},${event.requestedByOperatorId},
      ${event.observedAt}::timestamptz,${event.errorCode},${event.previousContentDigestHex},
      ${event.contentDigestHex},${JSON.stringify(event)}::text::jsonb,${event.schemaVersion}
    ) RETURNING content_digest_hex
  `;
  if (rows.length !== 1 || rows[0]!.content_digest_hex !== event.contentDigestHex) {
    throw new Error("HISTORICAL_SIMULATION_RUN_LIFECYCLE_REFUSED:PERSISTENCE");
  }
}

function isH5Paused(event: HistoricalSimulationRunLifecycleEventV2): boolean {
  return event.phase === "STOPPED" && event.committedCycles === 1 &&
    event.qualifiedTotalCycles > 1 && event.errorCode === H5_PAUSE_ACTION;
}

async function requireReleaseAuthority(tx: Sql, organizationId: string, runId: string,
  releaseSha: string): Promise<void> {
  const rows = await tx<Array<Readonly<{ release_sha: string }>>>`
    SELECT release_sha FROM trader_historical_four_surface_ratified_admission_v2
    WHERE organization_id=${organizationId}::uuid AND run_id=${runId}`;
  if (rows.length !== 1 || rows[0]?.release_sha !== releaseSha) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:RELEASE_AUTHORITY");
  }
}

async function loadH5ContinuationAuthorization(tx: Sql, organizationId: string, runId: string,
  pausedLifecycleDigestHex?: string): Promise<Readonly<{
    authorization: HistoricalSimulationRunLifecycleEventV2;
    paused: HistoricalSimulationRunLifecycleEventV2 }> | null> {
  const rows = await tx<H5AuthorizationRow[]>`
    SELECT authorized.event_json AS authorization_event_json,
      paused.event_json AS paused_event_json
    FROM trader_historical_simulation_run_lifecycle_event_v2 AS authorized
    JOIN trader_historical_simulation_run_lifecycle_event_v2 AS paused
      ON paused.organization_id=authorized.organization_id AND paused.run_id=authorized.run_id
      AND paused.event_sequence+1=authorized.event_sequence
      AND paused.content_digest_hex=authorized.previous_content_digest_hex
    WHERE authorized.organization_id=${organizationId}::uuid AND authorized.run_id=${runId}
      AND authorized.phase='QUEUED' AND authorized.committed_cycles=1
      AND authorized.error_code=${H5_RESUME_ACTION}
      AND paused.phase='STOPPED' AND paused.committed_cycles=1
      AND paused.error_code=${H5_PAUSE_ACTION}
      AND (${pausedLifecycleDigestHex ?? null}::text IS NULL
        OR paused.content_digest_hex=${pausedLifecycleDigestHex ?? null})`;
  if (rows.length > 1) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_CONTINUATION_AMBIGUOUS");
  }
  const row = rows[0]; if (!row) return null;
  const authorization = assertHistoricalSimulationRunLifecycleEventV2(
    row.authorization_event_json);
  const paused = assertHistoricalSimulationRunLifecycleEventV2(row.paused_event_json);
  if (!isH5Paused(paused) || authorization.previousContentDigestHex !== paused.contentDigestHex) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_CONTINUATION_AUTHORITY");
  }
  return Object.freeze({ authorization, paused });
}

function validContinuationAuthority(value: HistoricalSimulationH5ContinuationAuthorityV2 |
  undefined): value is HistoricalSimulationH5ContinuationAuthorityV2 {
  return value?.action === H5_RESUME_ACTION && /^[0-9a-f]{40}$/.test(value.releaseSha) &&
    /^[0-9a-f]{64}$/.test(value.pausedLifecycleDigestHex);
}

async function withContinuationUniqueRetry<T>(enabled: boolean,
  operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (!enabled || code !== "23505" || attempt === 2) throw error;
    }
  }
  throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_CONTINUATION_RETRY");
}

function sameIdentity(event: HistoricalSimulationRunLifecycleEventV2,
  input: HistoricalSimulationLaunchIdentityV2): boolean {
  return event.organizationId === input.organizationId && event.accountId === input.accountId &&
    event.runId === input.runId && event.partition === input.partition && event.symbol === input.symbol;
}

async function acquireConsumerLease(tx: Sql, organizationId: string, runId: string): Promise<void> {
  const rows = await tx<Array<Readonly<{ acquired: boolean }>>>`
    SELECT pg_try_advisory_lock(hashtextextended(${consumerLeaseKey(organizationId, runId)},0)) AS acquired
  `;
  if (rows.length !== 1 || rows[0]?.acquired !== true) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:CONSUMER_LEASE_BUSY");
  }
}

async function qualifiedLaunch(tx: Sql, input: HistoricalSimulationLaunchIdentityV2):
Promise<Readonly<{ initialRecordIndex: number; terminalRecordIndexExclusive: number;
  qualifiedTotalCycles: number; committedCycles: number; latestCommittedCycleId: string | null }>> {
  const starts = await tx<Array<Readonly<{ account_id: string; dataset_authority_digest_hex: string }>>>`
    SELECT account_id,dataset_authority_digest_hex
    FROM trader_historical_simulation_run_start_v2
    WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
  `;
  const start = starts[0];
  if (starts.length !== 1 || !start || start.account_id !== input.accountId) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:RUN_AUTHORITY");
  }
  const pits = await tx<Array<Readonly<{ first_record_index: number | string }>>>`
    SELECT min(record_index)::text AS first_record_index
    FROM trader_historical_forecast_input_pit_v2
    WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
      AND partition=${input.partition} AND symbol=${input.symbol}
  `;
  const firstRecordIndex = pits[0]?.first_record_index;
  const initialRecordIndex = firstRecordIndex == null ? NaN : Number(firstRecordIndex);
  if (!Number.isSafeInteger(initialRecordIndex) || initialRecordIndex < 0) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:INITIAL_PIT");
  }
  const qualified = await tx<Array<Readonly<{ qualified_count: string;
    minimum_record_index: string; maximum_record_index: string }>>>`
    SELECT count(*)::text AS qualified_count,
      min((membership_json->>'recordIndex')::integer)::text AS minimum_record_index,
      max((membership_json->>'recordIndex')::integer)::text AS maximum_record_index
    FROM trader_historical_dataset_authority_v2
    WHERE organization_id=${input.organizationId}::uuid AND run_id=${input.runId}
      AND dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
      AND dataset_authority_digest_hex=${start.dataset_authority_digest_hex}
      AND membership_json->>'partition'=${input.partition}
      AND membership_json->>'symbol'=${input.symbol}
      AND (membership_json->>'recordIndex')::integer >= ${initialRecordIndex}
  `;
  const qualifiedTotalCycles = Number(qualified[0]?.qualified_count);
  const minimum = Number(qualified[0]?.minimum_record_index);
  const maximum = Number(qualified[0]?.maximum_record_index);
  if (!Number.isSafeInteger(qualifiedTotalCycles) || qualifiedTotalCycles <= 0 ||
      minimum !== initialRecordIndex || !Number.isSafeInteger(maximum) || maximum < minimum ||
      qualifiedTotalCycles !== maximum - minimum + 1) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:QUALIFIED_RANGE");
  }
  const checkpoints = await tx<Array<Readonly<{ next_cycle_sequence: number;
    next_record_index: number; committed_cycle_id: string }>>>`
    SELECT next_cycle_sequence,next_record_index,committed_cycle_id
    FROM trader_historical_simulation_resume_checkpoint_v2
    WHERE organization_id=${input.organizationId}::uuid AND account_id=${input.accountId}
      AND run_id=${input.runId}
    ORDER BY committed_cycle_sequence DESC LIMIT 1
  `;
  const committedCycles = Number(checkpoints[0]?.next_cycle_sequence ?? 0);
  const nextRecordIndex = Number(checkpoints[0]?.next_record_index ?? initialRecordIndex);
  if (!Number.isSafeInteger(committedCycles) || committedCycles < 0 ||
      committedCycles > qualifiedTotalCycles || nextRecordIndex !== initialRecordIndex + committedCycles) {
    throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:RESUME_RANGE");
  }
  return Object.freeze({
    initialRecordIndex,
    terminalRecordIndexExclusive: maximum + 1,
    qualifiedTotalCycles,
    committedCycles,
    latestCommittedCycleId: checkpoints[0]?.committed_cycle_id ?? null,
  });
}

function nextEvent(previous: HistoricalSimulationRunLifecycleEventV2,
  input: Readonly<{ phase: HistoricalSimulationRunLifecycleEventV2["phase"];
    committedCycles: number; latestCommittedCycleId: string | null;
    errorCode: string | null; requestedByOperatorId?: string }>): HistoricalSimulationRunLifecycleEventV2 {
  const { contentDigestHex: previousContentDigestHex, ...previousBody } = previous;
  return buildHistoricalSimulationRunLifecycleEventV2({
    ...previousBody,
    eventSequence: previous.eventSequence + 1,
    phase: input.phase,
    committedCycles: input.committedCycles,
    nextCycleSequence: input.committedCycles,
    latestCommittedCycleId: input.latestCommittedCycleId,
    requestedByOperatorId: input.requestedByOperatorId ?? previous.requestedByOperatorId,
    observedAt: new Date().toISOString(),
    errorCode: input.errorCode,
    previousContentDigestHex,
  });
}

export function createHistoricalSimulationRunLifecyclePostgresV2(
  sql: Sql,
): HistoricalSimulationRunLifecyclePortV2 {
  return Object.freeze({
    async queue(input) {
      return withContinuationUniqueRetry(Boolean(input.continuationAuthority), () =>
        withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
        await lock(tx, input.organizationId, input.runId);
        const authority = await qualifiedLaunch(tx, input);
        const existing = await latest(tx, input.organizationId, input.runId);
        if (input.continuationAuthority) {
          if (!validContinuationAuthority(input.continuationAuthority)) {
            throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_CONTINUATION_IDENTITY");
          }
          await requireReleaseAuthority(tx, input.organizationId, input.runId,
            input.continuationAuthority.releaseSha);
          const duplicate = await loadH5ContinuationAuthorization(tx, input.organizationId,
            input.runId, input.continuationAuthority.pausedLifecycleDigestHex);
          if (duplicate) {
            if (!sameIdentity(duplicate.authorization, input) ||
                duplicate.authorization.requestedByOperatorId !== input.requestedByOperatorId) {
              throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_CONTINUATION_CONFLICT");
            }
            if (!existing || existing.phase !== "QUEUED" ||
                existing.contentDigestHex !== duplicate.authorization.contentDigestHex) {
              throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_CONTINUATION_STALE");
            }
            return duplicate.authorization;
          }
          if (!existing || !isH5Paused(existing) ||
              existing.contentDigestHex !== input.continuationAuthority.pausedLifecycleDigestHex ||
              authority.committedCycles !== 1 ||
              authority.latestCommittedCycleId !== existing.latestCommittedCycleId) {
            throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_CONTINUATION_STALE");
          }
        } else if ((!existing && authority.committedCycles > 0) ||
            (existing && isH5Paused(existing))) {
          throw new Error(
            "HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_HUMAN_CONTINUATION_REQUIRED");
        }
        if (existing) {
          // A crash can leave the atomic checkpoint one cycle ahead of the
          // lifecycle event. Only the lease-owning claim may reconcile it;
          // queue must allow that bounded recovery to reach claim.
          const progressMatches = existing.committedCycles === authority.committedCycles &&
            existing.latestCommittedCycleId === authority.latestCommittedCycleId;
          const recoverableCommit = existing.phase === "RUNNING" &&
            authority.committedCycles === existing.committedCycles + 1 &&
            authority.latestCommittedCycleId !== null;
          if (!sameIdentity(existing, input) ||
              existing.initialRecordIndex !== authority.initialRecordIndex ||
              existing.terminalRecordIndexExclusive !== authority.terminalRecordIndexExclusive ||
              existing.qualifiedTotalCycles !== authority.qualifiedTotalCycles ||
              (!progressMatches && !recoverableCommit)) {
            throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:LIFECYCLE_DIVERGENCE");
          }
          if (["QUEUED", "RUNNING", "COMPLETED"].includes(existing.phase)) {
            if (input.continuationAuthority) {
              throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_CONTINUATION_STALE");
            }
            return existing;
          }
          if (input.continuationAuthority && !isH5Paused(existing)) {
            throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_CONTINUATION_STALE");
          }
          const requeued = nextEvent(existing, { phase: "QUEUED",
            committedCycles: authority.committedCycles,
            latestCommittedCycleId: authority.latestCommittedCycleId,
            errorCode: input.continuationAuthority ? H5_RESUME_ACTION : null,
            requestedByOperatorId: input.requestedByOperatorId });
          await insert(tx, requeued);
          return requeued;
        }
        const queued = buildHistoricalSimulationRunLifecycleEventV2({
          ...input,
          ...authority,
          eventSequence: 0,
          phase: "QUEUED",
          nextCycleSequence: authority.committedCycles,
          observedAt: new Date().toISOString(),
          errorCode: null,
          previousContentDigestHex: null,
        });
        await insert(tx, queued);
        return queued;
      }));
    },
    async claim(input) {
      return withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
        await acquireConsumerLease(tx, input.organizationId, input.runId);
        await lock(tx, input.organizationId, input.runId);
        await requireReleaseAuthority(tx, input.organizationId, input.runId, input.releaseSha);
        const previous = await latest(tx, input.organizationId, input.runId);
        if (!previous || !["QUEUED", "RUNNING"].includes(previous.phase)) {
          throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:NOT_QUEUED");
        }
        if (previous.partition !== "WALK_FORWARD") {
          throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:PARTITION");
        }
        const continuation = previous.committedCycles >= 1
          ? await loadH5ContinuationAuthorization(tx, input.organizationId, input.runId)
          : null;
        if (previous.committedCycles > 1 && !continuation) {
          throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_PROGRESS_WITHOUT_CONTINUATION");
        }
        if (previous.phase === "QUEUED" && previous.committedCycles >= 1 && !continuation) {
          throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:H5_CONTINUATION_AUTHORITY");
        }
        if (previous.phase === "RUNNING") {
          const authority = await qualifiedLaunch(tx, {
            organizationId: previous.organizationId,
            accountId: previous.accountId,
            runId: previous.runId,
            partition: previous.partition,
            symbol: previous.symbol,
          });
          const progressDelta = authority.committedCycles - previous.committedCycles;
          if (authority.initialRecordIndex !== previous.initialRecordIndex ||
              authority.terminalRecordIndexExclusive !== previous.terminalRecordIndexExclusive ||
              authority.qualifiedTotalCycles !== previous.qualifiedTotalCycles ||
              progressDelta < 0 || progressDelta > 1 ||
              (progressDelta === 0 &&
                authority.latestCommittedCycleId !== previous.latestCommittedCycleId)) {
            throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:RECOVERY_DIVERGENCE");
          }
          const recovered = nextEvent(previous, {
            phase: authority.committedCycles === authority.qualifiedTotalCycles
              ? "COMPLETED"
              : authority.committedCycles === 1 && !continuation ? "STOPPED" : "RUNNING",
            committedCycles: authority.committedCycles,
            latestCommittedCycleId: authority.latestCommittedCycleId,
            errorCode: authority.committedCycles === 1 && !continuation
              ? H5_PAUSE_ACTION
              : authority.committedCycles === 1 && continuation
                ? H5_RESUME_ACTION
                : progressDelta === 0
                  ? "CRASH_RECOVERED_BEFORE_COMMIT" : "CRASH_RECOVERED_AFTER_COMMIT",
          });
          await insert(tx, recovered);
          return recovered;
        }
        const claimed = nextEvent(previous, { phase: "RUNNING",
          committedCycles: previous.committedCycles,
          latestCommittedCycleId: previous.latestCommittedCycleId,
          errorCode: previous.committedCycles === 1 && continuation ? H5_RESUME_ACTION : null });
        await insert(tx, claimed);
        return claimed;
      });
    },
    async append(input) {
      return withPostgresSessionTransaction(sql, "SERIALIZABLE", async (tx) => {
        const previous = assertHistoricalSimulationRunLifecycleEventV2(input.previous);
        await lock(tx, previous.organizationId, previous.runId);
        const persisted = await latest(tx, previous.organizationId, previous.runId);
        if (!persisted || persisted.contentDigestHex !== previous.contentDigestHex ||
            persisted.phase !== "RUNNING" || input.committedCycles < previous.committedCycles ||
            input.committedCycles > previous.committedCycles + 1 ||
            (input.phase === "COMPLETED" && input.committedCycles !== previous.qualifiedTotalCycles) ||
            (input.phase === "RUNNING" && input.committedCycles === previous.qualifiedTotalCycles)) {
          throw new Error("HISTORICAL_SIMULATION_RUN_LIFECYCLE_REFUSED:TRANSITION");
        }
        const event = nextEvent(previous, input);
        await insert(tx, event);
        return event;
      });
    },
  });
}

/** Release the session-scoped consumer lease. Closing the same session also releases it. */
export async function releaseHistoricalSimulationConsumerLeasePostgresV2(
  sql: Sql,
  input: Readonly<{ organizationId: string; runId: string }>,
): Promise<boolean> {
  const rows = await sql<Array<Readonly<{ released: boolean }>>>`
    SELECT pg_advisory_unlock(hashtextextended(${consumerLeaseKey(
      input.organizationId,
      input.runId,
    )},0)) AS released
  `;
  return rows.length === 1 && rows[0]?.released === true;
}

export async function loadHistoricalSimulationRunLifecyclePostgresV2(
  sql: Sql,
  input: Readonly<{ organizationId: string; runId: string }>,
): Promise<HistoricalSimulationRunLifecycleEventV2 | null> {
  const event = await latest(sql, input.organizationId, input.runId);
  if (event) {
    const { contentDigestHex, ...body } = event;
    if (contentDigestHex !== computeSemanticSha256Hex(body)) {
      throw new Error("HISTORICAL_SIMULATION_RUN_LIFECYCLE_REFUSED:DIGEST");
    }
  }
  return event;
}
