import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import postgres from "postgres";
import { z } from "zod";
import { withPostgresSessionTransaction } from "@/db/postgres-session-transaction";
import { deterministicUuidV8 } from "@/lib/trader/execution/deterministic-execution-id";
import { researchExperimentIdentityV1 } from "./research-experiment-contract-v1";
import { resolveCurrentResearchExecutableIdentityV1 } from "./research-executable-runtime-identity-v1";
import { canonicalJsonString, computeStableJsonDigest } from "./digest";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "./research-development-source-contract-v1";
import { readResearchDevelopmentSourceIssuanceV1, readResearchDevelopmentSourceRowsV1 } from "./research-development-source-read-v1";

const SCHEMA = "waia.research.issued-attempt.v2" as const;
const org = z.string().uuid().transform(value => value.toLowerCase())
  .refine(value => value === RESEARCH_DEVELOPMENT_SOURCE_ORG_V1);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const registerSchema = z.object({ organizationId: org, specSha256: sha,
  sourceRunId: z.string().regex(/^research-source-v1:[a-f0-9]{64}$/),
  commandId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}(?![\s\S])/),
}).strict();
const readSchema = z.object({ organizationId: org, attemptId: z.string().uuid() }).strict();
type Attempt = { id: string; organization_id: string; schema_version: string;
  spec_sha256: string; source_run_id: string; source_issuance_digest: string; command_id: string };

async function ownedConnection<T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  // The established server service connection can register attempts, but it
  // cannot replace the closed source owner API with a caller-created receipt.
  const url = process.env.DATABASE_URL_POSTGRES;
  if (!url) throw new Error("RESEARCH_ISSUED_ATTEMPT_DATABASE_REQUIRED");
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10,
    connection: { statement_timeout: 30_000, idle_in_transaction_session_timeout: 30_000 } });
  try { return await work(sql); } finally { await sql.end({ timeout: 1 }); }
}

/** Internal metadata-only reader; caller owns the snapshot. It grants no execution. */
export async function readResearchIssuedSourceAndExperimentV2(tx: postgres.Sql, organizationId: string,
  specSha256: string, sourceRunId: string,
  runtime: ReturnType<typeof resolveCurrentResearchExecutableIdentityV1>) {
  const issuance = await readResearchDevelopmentSourceIssuanceV1(tx, organizationId, sourceRunId);
  if (!issuance) throw new Error("RESEARCH_ISSUED_SOURCE_REQUIRED");
  const rows = await tx<{ spec_canonical_json: string; family_size: number; admission_family_size: number }[]>`
    SELECT e.spec_canonical_json,e.family_size,f.family_size AS admission_family_size
    FROM public.trader_research_experiments_v1 e
    JOIN public.trader_strategy_admission_family f ON f.spec_sha256=e.spec_sha256
    WHERE e.organization_id=${organizationId}::uuid AND e.spec_sha256=${specSha256}
      AND octet_length(e.spec_canonical_json)<=262144`;
  const row = rows[0];
  if (rows.length !== 1 || !row) throw new Error("RESEARCH_ISSUED_EXPERIMENT_REQUIRED");
  const identity = researchExperimentIdentityV1(JSON.parse(row.spec_canonical_json));
  const spec = identity.spec;
  if (identity.specSha256 !== specSha256 || spec.organizationId !== organizationId ||
      canonicalJsonString(spec) !== row.spec_canonical_json ||
      identity.declaredFamilySize !== row.family_size || identity.declaredFamilySize !== row.admission_family_size) {
    throw new Error("RESEARCH_ISSUED_EXPERIMENT_IDENTITY_MISMATCH");
  }
  const training = { contentSha256: issuance.training.contentSha256,
    firstOpenMs: issuance.training.firstOpenMs, lastCloseMs: issuance.training.lastCloseMs,
    barCount: issuance.training.barCount };
  if (issuance.releaseSha !== runtime.releaseSha || spec.executable.sourceSha256 !== runtime.sourceSha256 ||
      spec.executable.id !== runtime.executableId || spec.executable.featureSemantics !== runtime.featureSemantics ||
      spec.executable.replaySemantics !== runtime.replaySemantics ||
      spec.universe.symbol !== issuance.request.symbol || spec.universe.interval !== "1m" ||
      spec.universe.datasetSourceSha256 !== issuance.qualificationReceiptDigest ||
      spec.replay.volumeQualificationSha256 !== issuance.volumeQualificationDigest ||
      spec.hypothesis.observationCutoffMs !== issuance.observation.lastCloseMs ||
      !spec.hypothesis.observationEvidenceSha256.includes(issuance.observation.contentSha256) ||
      canonicalJsonString(spec.partitions.train) !== canonicalJsonString(training)) {
    throw new Error("RESEARCH_ISSUED_EXPERIMENT_SOURCE_BINDING_MISMATCH");
  }
  return { issuance, experiment: identity };
}

function publicAttempt(row: Attempt) {
  return Object.freeze({ schemaVersion: SCHEMA, authority: "ISSUED_SOURCE_BINDING_ONLY" as const,
    id: row.id, organizationId: row.organization_id, specSha256: row.spec_sha256,
    sourceRunId: row.source_run_id, sourceIssuanceDigest: row.source_issuance_digest,
    commandId: row.command_id, scientificallyQualified: false as const, capitalEligible: false as const });
}

/** Owns one root commit. Legacy V1 attempts have neither this table nor the
 * composite issued-source FK and are never silently upgraded. */
export async function registerResearchIssuedAttemptPostgresV2(supplied: unknown) {
  const request = registerSchema.parse(supplied);
  const runtime = resolveCurrentResearchExecutableIdentityV1();
  return ownedConnection(sql => withPostgresSessionTransaction(sql, "SERIALIZABLE", async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`research-attempt-v2:${request.organizationId}:${request.commandId}`},0))`;
    const { issuance } = await readResearchIssuedSourceAndExperimentV2(tx, request.organizationId,
      request.specSha256, request.sourceRunId, runtime);
    // Registration refuses a corrupt/incomplete source; it does not execute or
    // select any trial. Every subsequent consumer rechecks under its snapshot.
    await readResearchDevelopmentSourceRowsV1(tx, issuance);
    const id = deterministicUuidV8(computeStableJsonDigest({ schemaVersion: SCHEMA,
      organizationId: request.organizationId, commandId: request.commandId }));
    await tx`INSERT INTO public.trader_research_issued_attempts_v2
      (id,organization_id,spec_sha256,source_run_id,source_issuance_digest,command_id)
      VALUES (${id}::uuid,${request.organizationId}::uuid,${request.specSha256},
        ${request.sourceRunId},${issuance.contentDigest},${request.commandId})
      ON CONFLICT (organization_id,command_id) DO NOTHING`;
    const rows = await tx<Attempt[]>`SELECT id::text,organization_id::text,schema_version,
      spec_sha256,source_run_id,source_issuance_digest,command_id
      FROM public.trader_research_issued_attempts_v2
      WHERE organization_id=${request.organizationId}::uuid AND command_id=${request.commandId}`;
    const row = rows[0];
    if (rows.length !== 1 || !row || row.id !== id || row.schema_version !== SCHEMA ||
        row.spec_sha256 !== request.specSha256 || row.source_run_id !== request.sourceRunId ||
        row.source_issuance_digest !== issuance.contentDigest) {
      throw new Error("RESEARCH_ISSUED_ATTEMPT_COMMAND_CONFLICT");
    }
    return publicAttempt(row);
  }));
}

/** Exact issuance, registered experiment, V2 attempt and source rows are read in
 * a single read-only snapshot before returning any market payload. */
export async function loadResearchIssuedTrainingInputPostgresV2(supplied: unknown) {
  const request = readSchema.parse(supplied);
  const runtime = resolveCurrentResearchExecutableIdentityV1();
  return ownedConnection(sql => withPostgresSessionTransaction(sql, "REPEATABLE READ", async tx => {
    await tx`SET TRANSACTION READ ONLY`;
    const rows = await tx<Attempt[]>`SELECT id::text,organization_id::text,schema_version,
      spec_sha256,source_run_id,source_issuance_digest,command_id
      FROM public.trader_research_issued_attempts_v2
      WHERE organization_id=${request.organizationId}::uuid AND id=${request.attemptId}::uuid`;
    const row = rows[0];
    if (rows.length !== 1 || !row || row.schema_version !== SCHEMA ||
        row.id !== deterministicUuidV8(computeStableJsonDigest({ schemaVersion: SCHEMA,
          organizationId: request.organizationId, commandId: row.command_id }))) {
      throw new Error("RESEARCH_ISSUED_ATTEMPT_REQUIRED");
    }
    const bound = await readResearchIssuedSourceAndExperimentV2(tx, request.organizationId,
      row.spec_sha256, row.source_run_id, runtime);
    if (row.source_issuance_digest !== bound.issuance.contentDigest) {
      throw new Error("RESEARCH_ISSUED_ATTEMPT_SOURCE_CHANGED");
    }
    const checked = await readResearchDevelopmentSourceRowsV1(tx, bound.issuance);
    const start = checked.issuance.request.observationBarCount + checked.issuance.request.gapBarCount;
    return Object.freeze({ attempt: publicAttempt(row), experiment: bound.experiment,
      issuance: checked.issuance, bars: checked.training,
      cycles: Object.freeze(checked.cycles.slice(start)),
      sourceAvailability: checked.issuance.sourceAvailability });
  }));
}
