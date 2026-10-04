import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import type postgres from "postgres";
import { isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
import { withPostgresSerializableTransactionRetry, withPostgresSessionTransaction } from "@/db/postgres-session-transaction";
import { historicalDatasetRegistrationIdentityV2 } from "@/lib/trader/historical-simulation-v2/dataset-registration-identity-v2";
import { assertPathDoesNotAccessBlindHoldoutPayload } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import { withResearchOwnedPostgresPoolV1 } from "./research-owned-postgres-pool-v1";
import { resolveCurrentResearchExecutableIdentityV1 } from "./research-executable-runtime-identity-v1";
import { computeStableJsonDigest } from "./digest";
import { RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1 as LIMITS } from "./research-development-source-contract-v1";
import { readResearchDevelopmentSourceIssuanceV1, readResearchDevelopmentSourceRowsV1 } from "./research-development-source-read-v1";
import { captureResearchDevelopmentEvaluationSourceRequestV1, researchDevelopmentEvaluationSourceIdV1 } from "./research-development-evaluation-source-contract-v1";
import { loadResearchDevelopmentEvaluationSourceSnapshotV1 } from "./research-development-evaluation-source-snapshot-v1";
import { RESEARCH_EVALUATION_SOURCE_LOGIN_V1, RESEARCH_EVALUATION_SOURCE_ROLE_V1,
  sealResearchEvaluationSourceIssuanceV1, type ResearchEvaluationSourceIssuanceV1 } from "./research-development-evaluation-source-issuance-v1";
import { requireResearchEvaluationSourceLoginV1 } from "./research-development-evaluation-source-role-v1";
import { readResearchEvaluationSourceIssuanceV1, readResearchEvaluationSourceRowsV1 } from "./research-development-evaluation-source-read-v1";

function hostPath(name: string): string {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) throw new Error("RESEARCH_EVALUATION_SOURCE_HOST_PATH_REQUIRED");
  assertPathDoesNotAccessBlindHoldoutPayload(value);
  const resolved = realpathSync(value);
  assertPathDoesNotAccessBlindHoldoutPayload(resolved);
  return resolved;
}
function captureHost() {
  const url = process.env.WAIA_RESEARCH_EVALUATION_SOURCE_DATABASE_URL;
  if (!url) throw new Error("RESEARCH_EVALUATION_SOURCE_DATABASE_REQUIRED");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("RESEARCH_EVALUATION_SOURCE_DATABASE_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      decodeURIComponent(parsed.username) !== RESEARCH_EVALUATION_SOURCE_LOGIN_V1) {
    throw new Error("RESEARCH_EVALUATION_SOURCE_DEDICATED_LOGIN_REQUIRED");
  }
  return Object.freeze({ url, releaseSha: resolveCurrentResearchExecutableIdentityV1().releaseSha,
    datasetRoot: hostPath("WAIA_RESEARCH_SOURCE_DATASET_ROOT"),
    qualificationReceiptPath: hostPath("WAIA_RESEARCH_SOURCE_QUALIFICATION_PATH"),
    runtimeRequalificationReceiptPath: process.env.WAIA_RESEARCH_SOURCE_REQUALIFICATION_PATH
      ? hostPath("WAIA_RESEARCH_SOURCE_REQUALIFICATION_PATH") : "",
    htxVolumeQualificationReceiptPath: hostPath("WAIA_RESEARCH_SOURCE_VOLUME_PATH"),
  });
}
async function assumeRole(tx: postgres.Sql) {
  await requireResearchEvaluationSourceLoginV1(tx as unknown as postgres.TransactionSql);
  await tx.unsafe(`SET LOCAL ROLE ${RESEARCH_EVALUATION_SOURCE_ROLE_V1}`);
  const [row] = await tx<{ current_user: string }[]>`SELECT current_user::text AS current_user`;
  if (row?.current_user !== RESEARCH_EVALUATION_SOURCE_ROLE_V1) throw new Error("RESEARCH_EVALUATION_SOURCE_WRITER_ROLE_REFUSED");
}

/** Closed, default-off source preparation owner. Selection is the only input;
 * host config, connection, loaded bytes and persistence never come from callers.
 * No evaluator or CLI is wired here; issuance does not authorize payload use. */
export async function prepareResearchDevelopmentEvaluationSourcePostgresV1(supplied: unknown) {
  const request = captureResearchDevelopmentEvaluationSourceRequestV1(supplied);
  const host = captureHost();
  const evaluationSourceId = researchDevelopmentEvaluationSourceIdV1(request);
  const signal = AbortSignal.timeout(LIMITS.deadlineMs);
  let candidate: ResearchEvaluationSourceIssuanceV1 | undefined;
  async function requireTraining(tx: postgres.Sql) {
    const training = await readResearchDevelopmentSourceIssuanceV1(tx, request.organizationId, request.trainingSourceRunId);
    if (!training || training.contentDigest !== request.trainingSourceIssuanceDigest ||
        training.releaseSha !== host.releaseSha || training.request.symbol !== request.symbol) {
      throw new Error("RESEARCH_EVALUATION_SOURCE_TRAINING_BINDING_MISMATCH");
    }
    await readResearchDevelopmentSourceRowsV1(tx, training);
    return training;
  }
  try {
    return await withResearchOwnedPostgresPoolV1(host.url, signal, LIMITS.deadlineMs, sql =>
      withPostgresSerializableTransactionRetry(sql, async tx => {
        candidate = undefined;
        signal.throwIfAborted();
        await assumeRole(tx);
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`research-evaluation-source-v1:${request.organizationId}:${request.commandId}`},0))`;
        const existing = await readResearchEvaluationSourceIssuanceV1(tx, request.organizationId, evaluationSourceId);
        if (existing && (existing.metadata.releaseSha !== host.releaseSha ||
            computeStableJsonDigest(existing.metadata.request) !== computeStableJsonDigest(request))) {
          throw new Error("RESEARCH_EVALUATION_SOURCE_COMMAND_CONFLICT");
        }
        const training = await requireTraining(tx);
        // Load once. The exact private snapshot used to compute metadata is the
        // one persisted below; never reopen files between validation and insert.
        const { metadata, snapshot } = await loadResearchDevelopmentEvaluationSourceSnapshotV1({ request, trainingIssuance: training, host, signal });
        const [scope] = await tx<{ count: number }[]>`SELECT count(*)::integer AS count
          FROM public.trader_historical_dataset_authority_v2
          WHERE organization_id=${request.organizationId}::uuid AND run_id=${evaluationSourceId}`;
        if (!scope || scope.count !== (existing ? snapshot.sources.length : 0)) {
          throw new Error("RESEARCH_EVALUATION_SOURCE_EXISTING_ROW_SCOPE_CONFLICT");
        }
        const expectedRows = [];
        for (const { membership, cycle } of snapshot.sources) {
          signal.throwIfAborted();
          const authorityDigest = computeStableJsonDigest({ organizationId: request.organizationId,
            runId: evaluationSourceId, membership, sealedCycle: cycle });
          const id = historicalDatasetRegistrationIdentityV2({ organizationId: request.organizationId,
            runId: evaluationSourceId, cycleId: cycle.cycleId, authorityContentDigestHex: authorityDigest });
          expectedRows.push({ id, cycleId: cycle.cycleId, authorityDigest });
          // A SERIALIZABLE snapshot can precede the advisory-lock wait. ON
          // CONFLICT forces PostgreSQL's serialization failure for a winner
          // invisible in that snapshot, so the owned root retry rereads it.
          if (!existing) await tx`INSERT INTO public.trader_historical_dataset_authority_v2
            (id,organization_id,run_id,cycle_id,dataset_authority_class,dataset_authority_digest_hex,
             membership_content_digest_hex,sealed_cycle_content_digest_hex,membership_json,sealed_cycle_json,
             authority_content_digest_hex,schema_version)
            VALUES (${id}::uuid,${request.organizationId}::uuid,${evaluationSourceId},${cycle.cycleId},
              ${membership.datasetAuthorityClass},${membership.datasetAuthorityDigestHex},
              ${membership.contentDigestHex},${cycle.contentDigestHex},${JSON.stringify(membership)}::text::jsonb,
              ${JSON.stringify(cycle)}::text::jsonb,${authorityDigest},'waia.trader.historical_dataset_authority.v2')
            ON CONFLICT (organization_id,run_id,cycle_id) DO NOTHING`;
        }
        const [clock] = await tx<{ at: string }[]>`
          SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`;
        if (!clock) throw new Error("RESEARCH_EVALUATION_SOURCE_CLOCK_REQUIRED");
        const issuance = sealResearchEvaluationSourceIssuanceV1({
          schemaVersion: "waia.research.development-evaluation-source-issuance.v1",
          authority: "RESTRICTED_EVALUATION_SOURCE_WRITER_V1", metadata,
          rowSetSha256: computeStableJsonDigest(expectedRows), issuerRole: RESEARCH_EVALUATION_SOURCE_ROLE_V1,
          issuedAt: existing?.issuedAt ?? clock.at,
        });
        if (existing && existing.contentDigest !== issuance.contentDigest) throw new Error("RESEARCH_EVALUATION_SOURCE_RETRY_SOURCE_CONFLICT");
        const encoded = JSON.stringify(issuance);
        if (Buffer.byteLength(encoded) > LIMITS.maxReceiptBytes) throw new Error("RESEARCH_EVALUATION_SOURCE_RECEIPT_BYTE_LIMIT");
        if (!existing) await tx`INSERT INTO public.trader_research_evaluation_source_runs_v1
          (organization_id,evaluation_source_id,command_id,training_source_run_id,training_source_issuance_digest,
           content_digest,issuance_json,issued_at)
          VALUES (${request.organizationId}::uuid,${evaluationSourceId},${request.commandId},${request.trainingSourceRunId},
            ${request.trainingSourceIssuanceDigest},${issuance.contentDigest},${encoded}::text::jsonb,${issuance.issuedAt}::timestamptz)`;
        const persisted = await readResearchEvaluationSourceIssuanceV1(tx, request.organizationId, evaluationSourceId);
        if (!persisted || persisted.contentDigest !== issuance.contentDigest) throw new Error("RESEARCH_EVALUATION_SOURCE_PERSISTENCE_MISMATCH");
        await readResearchEvaluationSourceRowsV1(tx, persisted);
        signal.throwIfAborted();
        candidate = persisted;
        return Object.freeze({ status: existing ? "REPLAYED" as const : "COMMITTED" as const, issuance: persisted });
      }));
  } catch (error) {
    if (!candidate) throw error;
    const exactCandidate: ResearchEvaluationSourceIssuanceV1 = candidate;
    try {
      const recovered = await withResearchOwnedPostgresPoolV1(host.url, signal, LIMITS.deadlineMs, pool =>
        withPostgresSessionTransaction(pool, "REPEATABLE READ", async tx => {
          await tx`SET TRANSACTION READ ONLY`;
          await assumeRole(tx);
          await requireTraining(tx);
          const persisted = await readResearchEvaluationSourceIssuanceV1(tx, request.organizationId, evaluationSourceId);
          if (!persisted || persisted.contentDigest !== exactCandidate.contentDigest) return null;
          return readResearchEvaluationSourceRowsV1(tx, persisted);
        }));
      if (recovered) return Object.freeze({ status: "CONFIRMED_AFTER_UNCERTAINTY" as const, issuance: recovered });
    } catch { /* No fresh proof: do not claim success or automatically execute again. */ }
    return Object.freeze({ status: "COMMIT_UNCERTAIN" as const, issuance: null });
  }
}
