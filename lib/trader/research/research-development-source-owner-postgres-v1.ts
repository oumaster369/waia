import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import postgres from "postgres";
import { isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
import { withPostgresSerializableTransactionRetry, withPostgresSessionTransaction } from "@/db/postgres-session-transaction";
import { createCanonicalDecisionVerificationReceiptServiceV2 } from "@/lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { assertPathDoesNotAccessBlindHoldoutPayload } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import { resolveCurrentResearchExecutableIdentityV1 } from "./research-executable-runtime-identity-v1";
import { computeStableJsonDigest } from "./digest";
import {
  captureResearchDevelopmentSourceRequestV1, researchDevelopmentSourceRunIdV1,
  sealResearchDevelopmentSourceIssuanceV1, RESEARCH_DEVELOPMENT_SOURCE_SCHEMA_V1,
  RESEARCH_DEVELOPMENT_SOURCE_ROLE_V1, RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1 as LIMITS,
  RESEARCH_DEVELOPMENT_SOURCE_LOGIN_V1,
  type ResearchDevelopmentSourceIssuanceV1,
} from "./research-development-source-contract-v1";
import { requireResearchDevelopmentSourceLoginV1 } from "./research-development-source-role-v1";
import { readResearchDevelopmentSourceIssuanceV1, readResearchDevelopmentSourceRowsV1 } from "./research-development-source-read-v1";

function hostPath(name: string): string {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) throw new Error("RESEARCH_DEVELOPMENT_SOURCE_HOST_PATH_REQUIRED");
  assertPathDoesNotAccessBlindHoldoutPayload(value);
  const resolved = realpathSync(value);
  assertPathDoesNotAccessBlindHoldoutPayload(resolved);
  return resolved;
}

function captureHost() {
  const url = process.env.WAIA_RESEARCH_SOURCE_DATABASE_URL;
  if (!url) throw new Error("RESEARCH_DEVELOPMENT_SOURCE_DATABASE_REQUIRED");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("RESEARCH_DEVELOPMENT_SOURCE_DATABASE_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      decodeURIComponent(parsed.username) !== RESEARCH_DEVELOPMENT_SOURCE_LOGIN_V1) {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_DEDICATED_LOGIN_REQUIRED");
  }
  return Object.freeze({ url,
    releaseSha: resolveCurrentResearchExecutableIdentityV1().releaseSha,
    datasetRoot: hostPath("WAIA_RESEARCH_SOURCE_DATASET_ROOT"),
    qualificationReceiptPath: hostPath("WAIA_RESEARCH_SOURCE_QUALIFICATION_PATH"),
    runtimeRequalificationReceiptPath: hostPath("WAIA_RESEARCH_SOURCE_REQUALIFICATION_PATH"),
    htxVolumeQualificationReceiptPath: hostPath("WAIA_RESEARCH_SOURCE_VOLUME_PATH"),
  });
}

async function reserved<T>(url: string, work: (sql: postgres.ReservedSql) => Promise<T>): Promise<T> {
  // Fresh, owned pool. Never accepts a generic application pool or supplied SQL
  // callback as authority, and never returns a role-bearing session to one.
  const pool = postgres(url, { max: 1, prepare: false, connect_timeout: 10,
    connection: { statement_timeout: LIMITS.deadlineMs, idle_in_transaction_session_timeout: LIMITS.deadlineMs } });
  let connection: postgres.ReservedSql | undefined;
  try {
    connection = await pool.reserve();
    await requireResearchDevelopmentSourceLoginV1(connection);
    return await work(connection);
  } finally {
    connection?.release();
    await pool.end({ timeout: 1 });
  }
}

async function assumeLocalRole(tx: postgres.Sql) {
  await tx.unsafe(`SET LOCAL ROLE ${RESEARCH_DEVELOPMENT_SOURCE_ROLE_V1}`);
  const [row] = await tx<{ current_user: string }[]>`SELECT current_user::text AS current_user`;
  if (row?.current_user !== RESEARCH_DEVELOPMENT_SOURCE_ROLE_V1) {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_WRITER_ROLE_REFUSED");
  }
}

/** Actual default-off CLI source preparation owner. It accepts selection only;
 * the host owns its release, source paths and restricted DB connection. No
 * scorer, caller-built receipt, arbitrary source ID or injected issuer exists. */
export async function prepareResearchDevelopmentSourcePostgresV1(supplied: unknown) {
  const request = captureResearchDevelopmentSourceRequestV1(supplied);
  const host = captureHost();
  const sourceRunId = researchDevelopmentSourceRunIdV1(request);
  const signal = AbortSignal.timeout(LIMITS.deadlineMs);
  let candidate: ResearchDevelopmentSourceIssuanceV1 | undefined;
  try {
    return await reserved(host.url, async connection => {
      const sql = connection as unknown as postgres.Sql;
      return withPostgresSerializableTransactionRetry(sql, async tx => {
        candidate = undefined;
        signal.throwIfAborted();
        await assumeLocalRole(tx);
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`research-source-v1:${request.organizationId}:${request.commandId}`},0))`;
        const existing = await readResearchDevelopmentSourceIssuanceV1(tx, request.organizationId, sourceRunId);
        if (existing && (existing.releaseSha !== host.releaseSha ||
            computeStableJsonDigest(existing.request) !== computeStableJsonDigest(request))) {
          throw new Error("RESEARCH_DEVELOPMENT_SOURCE_COMMAND_CONFLICT");
        }
        const registered = await createCanonicalDecisionVerificationReceiptServiceV2(tx)
          .registerPreHoldoutDatasetAuthorityFromSource({ ...host, ...request,
            runId: sourceRunId, partition: "DEVELOPMENT",
            cycleCount: request.observationBarCount + request.gapBarCount + request.trainingBarCount,
            signal, maxSourceBytes: LIMITS.maxSourceBytes, maxReceiptBytes: LIMITS.maxReceiptBytes });
        signal.throwIfAborted();
        const snapshot = registered.sourceSnapshot;
        const sources = snapshot.sources;
        const bars = sources.map(source => source.cycle.closedBar);
        const observation = bars.slice(0, request.observationBarCount);
        const training = bars.slice(request.observationBarCount + request.gapBarCount);
        const partition = (selected: typeof bars, firstRecordIndex: number) => ({
          firstRecordIndex, barCount: selected.length,
          firstOpenMs: Date.parse(selected[0]!.barOpenTime),
          lastCloseMs: Date.parse(selected.at(-1)!.barCloseTime),
          contentSha256: computeBarSetDigest(selected),
        });
        const [clock] = await tx<{ at: string }[]>`
          SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`;
        if (!clock) throw new Error("RESEARCH_DEVELOPMENT_SOURCE_CLOCK_REQUIRED");
        const issuance = sealResearchDevelopmentSourceIssuanceV1({
          schemaVersion: RESEARCH_DEVELOPMENT_SOURCE_SCHEMA_V1,
          authority: "RESTRICTED_DEVELOPMENT_SOURCE_WRITER_V1", request, sourceRunId,
          releaseSha: host.releaseSha, sourceReleaseSha: snapshot.verifiedSource.sourceReleaseSha,
          qualificationReceiptDigest: snapshot.qualificationReceiptDigestHex,
          runtimeRequalificationDigest: snapshot.verifiedSource.runtimeRequalificationDigestHex,
          partitionRawSha256: snapshot.partitionRawSha256Hex,
          partitionSemanticDigest: snapshot.partitionSemanticDigestHex,
          volumeQualificationDigest: snapshot.verifiedSource.volumeQualificationDigestHex,
          rowSetSha256: computeStableJsonDigest(sources.map(source => ({
            id: registered.authorityIds.get(source.cycle.cycleId), cycleId: source.cycle.cycleId,
            authorityDigest: computeStableJsonDigest({ organizationId: request.organizationId,
              runId: sourceRunId, membership: source.membership, sealedCycle: source.cycle }),
          }))),
          observation: partition(observation, request.initialRecordIndex),
          training: partition(training, request.initialRecordIndex + request.observationBarCount + request.gapBarCount),
          pitRule: "CLOSED_BAR_AND_ABSOLUTE_RECORD_INDEX_ONLY",
          sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED",
          scientificallyQualified: false, capitalEligible: false,
          issuerRole: RESEARCH_DEVELOPMENT_SOURCE_ROLE_V1, issuedAt: existing?.issuedAt ?? clock.at,
        });
        if (existing && existing.contentDigest !== issuance.contentDigest) {
          throw new Error("RESEARCH_DEVELOPMENT_SOURCE_RETRY_SOURCE_CONFLICT");
        }
        const encoded = JSON.stringify(issuance);
        if (Buffer.byteLength(encoded) > LIMITS.maxReceiptBytes) throw new Error("RESEARCH_DEVELOPMENT_SOURCE_RECEIPT_BYTE_LIMIT");
        if (!existing) {
          await tx`INSERT INTO public.trader_research_development_source_runs_v1
            (organization_id,source_run_id,command_id,content_digest,issuance_json,issued_at)
            VALUES (${request.organizationId}::uuid,${sourceRunId},${request.commandId},
              ${issuance.contentDigest},${encoded}::jsonb,${issuance.issuedAt}::timestamptz)`;
        }
        const persisted = await readResearchDevelopmentSourceIssuanceV1(tx, request.organizationId, sourceRunId);
        if (!persisted || persisted.contentDigest !== issuance.contentDigest) {
          throw new Error("RESEARCH_DEVELOPMENT_SOURCE_PERSISTENCE_MISMATCH");
        }
        const checked = await readResearchDevelopmentSourceRowsV1(tx, persisted);
        signal.throwIfAborted();
        // Only after every row/receipt and validation has succeeded can a lost
        // COMMIT acknowledgment be reconciled. This is not a success callback.
        candidate = persisted;
        return Object.freeze({ status: existing ? "REPLAYED" as const : "COMMITTED" as const,
          issuance: checked.issuance, observation: checked.observation });
      });
    });
  } catch (error) {
    if (!candidate) throw error;
    const exactCandidate: ResearchDevelopmentSourceIssuanceV1 = candidate;
    try {
      const recovered = await reserved(host.url, connection =>
        withPostgresSessionTransaction(connection as unknown as postgres.Sql, "REPEATABLE READ", async tx => {
          await tx`SET TRANSACTION READ ONLY`;
          await assumeLocalRole(tx);
          const persisted = await readResearchDevelopmentSourceIssuanceV1(tx, request.organizationId, sourceRunId);
          if (!persisted || persisted.contentDigest !== exactCandidate.contentDigest) return null;
          return readResearchDevelopmentSourceRowsV1(tx, persisted);
        }));
      if (recovered) return Object.freeze({ status: "CONFIRMED_AFTER_UNCERTAINTY" as const,
        issuance: recovered.issuance, observation: recovered.observation });
    } catch { /* Fresh evidence unavailable: no success or automatic re-execution. */ }
    return Object.freeze({ status: "COMMIT_UNCERTAIN" as const, issuance: null, observation: null });
  }
}
