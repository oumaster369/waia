import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type postgres from "postgres";

import { historicalInstrumentsMatch } from
  "@/lib/trader/symbols/historical-instrument";
import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";

import {
  QUANTIZER_VERSION,
  SAMPLER_CONTRACT_VERSION,
  TARGET_ROLE_EXECUTION,
  TARGET_ROLE_TERMINAL,
} from "./constants";
import { digestByteaToHex, digestHexToBytea } from "./digest-storage-codec-v1";
import {
  computePredictivePackageContentDigest,
  computePredictivePackageGenerationIdentityDigest,
  computeReplicaArtifactDigestK,
  computeReplicaRootFamilyIdentityDigest,
  digestHex,
} from "./identity-digests";
import {
  TERMINAL_BUCKET_COUNT,
  computeTerminalTargetGridFromDevelopmentReturns,
  terminalTargetBucketDefinitionsFromGrid,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { scale8TextToInt8 } from "./scale8-storage-codec-v1";
import { schemaVersionTextToInt2 } from "./schema-version-storage-v1";
import { REPLICA_ARTIFACT_VERSION } from "./source-anchor-v1";
import type {
  ForecastIssuanceV1,
  PredictivePackageV1,
  TerminalBucketTailSemanticsV1,
} from "./rv-state-conditional-empirical-joint-v1";
import {
  computeTerminalTargetGridIdentityDigestHex,
  fitReplicaArtifactV1,
  issueForecastV1,
  serializeReplicaArtifactPayloadV1,
  verifyForecastDistributionReplayV1,
  verifyReplicaPoolReplayV1,
} from "./rv-state-conditional-empirical-joint-v1";
import { terminalRhFromOutcome13dV1 } from "./exec-opp-outcome-materializer-v1";
import { quantizeScale8HalfUp } from "./quantize-scale8-half-up-v1";
import {
  scoreForecastV2MulticlassObservation,
  requireForecastV2CalibrationObservation,
  type ForecastV2CalibrationObservation,
} from "@/lib/trader/intelligence/calibration/calibration-scorer";
import type { ForecastRuntimeAuthorizedOutcomeV2 } from "./forecast-runtime-authority-v2";
import {
  issueForecastRuntimeV2,
  type ForecastRuntimeInputV2,
} from "./forecast-runtime-authority-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertHistoricalForecastKnowledgeBootstrapDurableRowV2,
  buildHistoricalForecastKnowledgeBootstrapV2,
  type HistoricalForecastKnowledgeBootstrapV2,
} from
  "@/lib/trader/historical-simulation-v2/forecast-knowledge-bootstrap-v2";
import { HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";

export const FORECAST_BUNDLE_SCHEMA_VERSION = "forecast-bundle/v2" as const;
export const FORECAST_CALIBRATION_SCHEMA_VERSION = "forecast-calibration/v2" as const;
export const FORECAST_OUTCOME_SCHEMA_VERSION = "forecast-outcome/v2" as const;
export const FORECAST_SCENARIO_SCHEMA_VERSION = "forecast-scenario/v2" as const;
export const FORECAST_V2_SCHEMA_VERSION = "forecast/v2" as const;
export const PREDICTIVE_PACKAGE_SCHEMA_VERSION = "predictive-package/v2" as const;
export const TARGET_DEFINITION_SCHEMA_VERSION = "target-definition/v2" as const;
export const TARGET_BUCKET_SCHEMA_VERSION = "target-bucket/v2" as const;
export const FORECAST_V2_PIT_RETENTION_MIN_DAYS = 30 as const;

export type PersistPredictivePackageV2Input = {
  organizationId: string;
  kmGlobalAnchorSetDigestHex: string;
  idempotencyKey?: string;
};

export type PersistPredictivePackageV2Result = {
  packageId: string;
  predictivePackageContentDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  terminalTargetDefinitionId: string;
  terminalTargetBucketIds: readonly string[];
};

async function persistPredictivePackageV2InTransaction(
  sql: postgres.Sql,
  pkg: PredictivePackageV1,
  input: PersistPredictivePackageV2Input,
): Promise<PersistPredictivePackageV2Result> {
  const expectedRoot = computeReplicaRootFamilyIdentityDigest(pkg.family);
  const expectedGeneration = computePredictivePackageGenerationIdentityDigest({
    replicaRootFamilyIdentityDigestHex: digestHex(expectedRoot),
    kConfigDec: pkg.kConfigDec,
    mConfigDec: pkg.mConfigDec,
    alphaEpiConfigScale8: pkg.alphaEpiConfigScale8,
  });
  const expectedContent = computePredictivePackageContentDigest(
    expectedGeneration,
    pkg.replicaArtifacts.map((artifact) => artifact.replicaArtifactDigest),
  );
  if (
    !expectedRoot.equals(pkg.replicaRootFamilyIdentityDigest) ||
    !expectedGeneration.equals(pkg.predictivePackageGenerationIdentityDigest) ||
    !expectedContent.equals(pkg.predictivePackageContentDigest)
  ) {
    throw new Error("[forecast-v2/persistence] predictive package identity mismatch (fail closed)");
  }
  const expectedGrid = computeTerminalTargetGridFromDevelopmentReturns(
    pkg.canonicalSourceCorpus.map((source) => terminalRhFromOutcome13dV1(source.outcome13d)),
  );
  if (
    !isDeepStrictEqual(expectedGrid, pkg.terminalTargetGrid) ||
    computeTerminalTargetGridIdentityDigestHex(expectedGrid) !==
      pkg.terminalTargetGridIdentityDigestHex ||
    pkg.replicaArtifacts.length !== pkg.kConfigDec
  ) {
    throw new Error("[forecast-v2/persistence] predictive package grid/replay mismatch");
  }
  for (const [ordinal, artifact] of pkg.replicaArtifacts.entries()) {
    if (artifact.replicaOrdinal !== ordinal) {
      throw new Error("[forecast-v2/persistence] replica ordinal mismatch");
    }
    verifyReplicaPoolReplayV1({
      family: pkg.family,
      canonicalSourceCorpus: pkg.canonicalSourceCorpus,
      artifact,
    });
    const refit = fitReplicaArtifactV1({
      family: pkg.family,
      canonicalSourceCorpus: pkg.canonicalSourceCorpus,
      replicaRootFamilyIdentityDigest: expectedRoot,
      replicaOrdinal: ordinal,
    });
    const serializedDigest = computeReplicaArtifactDigestK(
      serializeReplicaArtifactPayloadV1({
        artifact,
        symbol: pkg.family.symbol,
        primaryHorizonMinutes: pkg.family.primaryHorizonMinutes,
      }),
    );
    if (
      !isDeepStrictEqual(refit, artifact) ||
      !serializedDigest.equals(artifact.replicaArtifactDigest)
    ) {
      throw new Error("[forecast-v2/persistence] replica artifact full replay mismatch");
    }
  }
  const packageDigest = digestHex(pkg.predictivePackageContentDigest);
  await sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${input.organizationId}|${packageDigest}`}, 0)
    )
  `;
  const expectedPersistedTargetDigest = createHash("sha256")
    .update([
      TARGET_DEFINITION_SCHEMA_VERSION,
      input.organizationId,
      pkg.family.symbol,
      String(pkg.family.primaryHorizonMinutes),
      TARGET_ROLE_TERMINAL,
      "DISCRETE_SCENARIO",
      pkg.terminalTargetGridIdentityDigestHex,
    ].join("\n"), "utf8")
    .digest("hex");
  const existing = await sql<{
    package_id: string;
    target_definition_id: string;
    bucket_ids: string[];
    root_digest: Buffer;
    generation_digest: Buffer;
    km_digest: string;
    runtime_digest: Buffer;
    target_digest: string;
    bucket_ordinals: number[];
    bucket_lower_bounds: Array<string | null>;
    bucket_upper_bounds: Array<string | null>;
    bucket_tail_semantics: TerminalBucketTailSemanticsV1[];
  }[]>`
    SELECT p.id::text AS package_id,
           pt.target_definition_id::text AS target_definition_id,
           array_agg(tb.id::text ORDER BY tb.bucket_ordinal) AS bucket_ids,
           p.replica_root_family_identity_digest AS root_digest,
           p.predictive_package_generation_identity_digest AS generation_digest,
           p.km_global_anchor_set_digest AS km_digest,
           p.runtime_contract_digest AS runtime_digest,
           td.target_definition_digest AS target_digest
           ,array_agg(tb.bucket_ordinal ORDER BY tb.bucket_ordinal) AS bucket_ordinals
           ,jsonb_agg(tb.lower_bound_scale8 ORDER BY tb.bucket_ordinal) AS bucket_lower_bounds
           ,jsonb_agg(tb.upper_bound_scale8 ORDER BY tb.bucket_ordinal) AS bucket_upper_bounds
           ,array_agg(tb.tail_semantics ORDER BY tb.bucket_ordinal) AS bucket_tail_semantics
    FROM trader_forecast_predictive_package_v2 p
    JOIN trader_forecast_predictive_package_target_v2 pt
      ON pt.organization_id = p.organization_id AND pt.predictive_package_id = p.id
      AND pt.target_role_id = ${TARGET_ROLE_TERMINAL}
    JOIN trader_forecast_target_bucket_v2 tb
      ON tb.organization_id = p.organization_id AND tb.target_definition_id = pt.target_definition_id
    JOIN trader_forecast_target_definition_v2 td
      ON td.organization_id = p.organization_id AND td.id = pt.target_definition_id
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId, { column: "p.organization_id" })}
      AND p.predictive_package_content_digest = ${packageDigest}
    GROUP BY p.id, pt.target_definition_id, td.target_definition_digest
    LIMIT 1
  `;
  if (existing[0]) {
    const row = existing[0];
    const expectedBuckets = terminalTargetBucketDefinitionsFromGrid(pkg.terminalTargetGrid);
    const completeBucketBinding = expectedBuckets.every((bucket, index) =>
      row.bucket_ordinals[index] === bucket.bucketOrdinal &&
      row.bucket_tail_semantics[index] === bucket.tailSemantics &&
      row.bucket_lower_bounds[index] ===
        (bucket.lowerBound === null ? null : quantizeScale8HalfUp(bucket.lowerBound)) &&
      row.bucket_upper_bounds[index] ===
        (bucket.upperBound === null ? null : quantizeScale8HalfUp(bucket.upperBound)),
    );
    if (
      row.bucket_ids.length !== TERMINAL_BUCKET_COUNT ||
      row.bucket_ordinals.length !== TERMINAL_BUCKET_COUNT ||
      !completeBucketBinding ||
      digestByteaToHex(row.root_digest) !== digestHex(expectedRoot) ||
      digestByteaToHex(row.generation_digest) !== digestHex(expectedGeneration) ||
      row.km_digest !== input.kmGlobalAnchorSetDigestHex ||
      digestByteaToHex(row.runtime_digest) !== digestHex(pkg.runtimeContractDigest) ||
      row.target_digest !== expectedPersistedTargetDigest
    ) {
      throw new Error("[forecast-v2/persistence] existing predictive package binding mismatch");
    }
    return {
      packageId: row.package_id,
      predictivePackageContentDigestHex: packageDigest,
      predictivePackageGenerationIdentityDigestHex: digestHex(
        pkg.predictivePackageGenerationIdentityDigest,
      ),
      terminalTargetDefinitionId: row.target_definition_id,
      terminalTargetBucketIds: row.bucket_ids,
    };
  }
  const packageId = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  await sql`
    INSERT INTO trader_forecast_predictive_package_v2 (
      id,
      organization_id,
      venue,
      market,
      symbol,
      primary_horizon_minutes,
      execution_horizon_minutes,
      model_transform_version,
      replica_root_family_identity_digest,
      predictive_package_generation_identity_digest,
      predictive_package_content_digest,
      k_config_dec,
      m_config_dec,
      alpha_epi_config_scale8,
      km_global_anchor_set_digest,
      development_dataset_digest,
      feature_version,
      sampler_contract_version,
      quantizer_version,
      normalization_version_digest,
      runtime_contract_digest,
      package_subject_version,
      schema_version,
      idempotency_key
    ) VALUES (
      ${packageId}::uuid,
      ${input.organizationId}::uuid,
      ${pkg.family.venue},
      ${pkg.family.market},
      ${pkg.family.symbol},
      ${pkg.family.primaryHorizonMinutes},
      ${pkg.family.executionHorizonMinutes},
      ${pkg.family.modelTransformVersion},
      ${digestHex(pkg.replicaRootFamilyIdentityDigest)},
      ${digestHex(pkg.predictivePackageGenerationIdentityDigest)},
      ${digestHex(pkg.predictivePackageContentDigest)},
      ${pkg.kConfigDec},
      ${pkg.mConfigDec},
      ${pkg.alphaEpiConfigScale8},
      ${input.kmGlobalAnchorSetDigestHex},
      ${pkg.family.developmentDatasetDigestHex},
      ${pkg.family.featureVersion},
      ${SAMPLER_CONTRACT_VERSION},
      ${QUANTIZER_VERSION},
      ${pkg.family.normalizationVersionDigestHex},
      ${digestHex(pkg.runtimeContractDigest)},
      ${pkg.family.packageSubjectVersion},
      ${PREDICTIVE_PACKAGE_SCHEMA_VERSION},
      ${idempotencyKey}
    )
  `;

  for (const artifact of pkg.replicaArtifacts) {
    const payload = serializeReplicaArtifactPayloadV1({
      artifact,
      symbol: pkg.family.symbol,
      primaryHorizonMinutes: pkg.family.primaryHorizonMinutes,
    });
    await sql`
      INSERT INTO trader_forecast_replica_artifact_v2 (
        id,
        organization_id,
        predictive_package_id,
        replica_ordinal,
        bootstrap_root,
        replica_artifact_digest,
        l_block_dec,
        artifact_payload,
        schema_version,
        idempotency_key
      ) VALUES (
        ${randomUUID()}::uuid,
        ${input.organizationId}::uuid,
        ${packageId}::uuid,
        ${artifact.replicaOrdinal},
        ${artifact.bootstrapRootK},
        ${digestHex(artifact.replicaArtifactDigest)},
        ${artifact.blockLength},
        ${payload},
        ${REPLICA_ARTIFACT_VERSION},
        ${randomUUID()}
      )
    `;
  }

  const terminalTargets = await persistTerminalTargetBucketsV2(sql, {
    organizationId: input.organizationId,
    venue: pkg.family.venue,
    market: pkg.family.market,
    symbol: pkg.family.symbol,
    primaryHorizonMinutes: pkg.family.primaryHorizonMinutes,
    grid: pkg.terminalTargetGrid,
    gridIdentityDigestHex: pkg.terminalTargetGridIdentityDigestHex,
  });

  await sql`
    INSERT INTO trader_forecast_predictive_package_target_v2 (
      id, organization_id, predictive_package_id, target_definition_id, target_role_id,
      binding_digest, schema_version, idempotency_key
    ) VALUES (
      ${randomUUID()}::uuid, ${input.organizationId}::uuid, ${packageId}::uuid,
      ${terminalTargets.targetDefinitionId}::uuid, ${TARGET_ROLE_TERMINAL},
      ${createHash("sha256")
        .update(
          `${packageId}:${terminalTargets.targetDefinitionId}:${TARGET_ROLE_TERMINAL}`,
          "utf8",
        )
        .digest("hex")},
      'package-target/v2', ${randomUUID()}
    )
  `;

  return {
    packageId,
    predictivePackageContentDigestHex: packageDigest,
    predictivePackageGenerationIdentityDigestHex: digestHex(
      pkg.predictivePackageGenerationIdentityDigest,
    ),
    terminalTargetDefinitionId: terminalTargets.targetDefinitionId,
    terminalTargetBucketIds: terminalTargets.bucketIds,
  };
}

/** One atomic issuance transaction. A concurrent identical natural retry is
 * reloaded only after the losing transaction has rolled back completely. */
export async function persistPredictivePackageV2(
  sql: postgres.Sql,
  pkg: PredictivePackageV1,
  input: PersistPredictivePackageV2Input,
): Promise<PersistPredictivePackageV2Result> {
  try {
    return await sql.begin((tx) =>
      persistPredictivePackageV2InTransaction(tx as unknown as postgres.Sql, pkg, input),
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") {
      throw error;
    }
    const recovered = await sql.begin((tx) =>
      persistPredictivePackageV2InTransaction(tx as unknown as postgres.Sql, pkg, input),
    );
    if (recovered.predictivePackageContentDigestHex !== digestHex(pkg.predictivePackageContentDigest)) {
      throw error;
    }
    return recovered;
  }
}

export type PersistForecastBundleV2Input = {
  organizationId: string;
  packageId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  anchorClosedBarEpochMs: number;
  issuance: ForecastIssuanceV1;
  authorizedOutcome?: ForecastRuntimeAuthorizedOutcomeV2;
  /** Exact producer-owned input persisted atomically with an authorized Forecast. */
  runtimeInput?: ForecastRuntimeInputV2;
  runtimeAuthorityClass?: "GENERAL_FORECAST_V2" | "HISTORICAL_SIMULATION_V2";
  /** Historical-only durable knowledge proof, verified inside the issuance transaction. */
  historicalKnowledgeBootstrap?: HistoricalForecastKnowledgeBootstrapV2;
  issuanceSequence?: number;
  /** @deprecated Natural identity (run/cycle/symbol/anchor) is the idempotency authority. */
  idempotencyKey?: string;
};

const FORECAST_RUNTIME_INPUT_SOURCE_V2 = "waia.trader.forecast_runtime_input_source.v2" as const;
const FORECAST_RUNTIME_INPUT_SOURCE_VERIFIER_V2 = "waia.forecast-runtime-input-source.verifier.v2" as const;

type ForecastRuntimeAuthorityClassV2 =
  "GENERAL_FORECAST_V2" | "HISTORICAL_SIMULATION_V2";

/** Authority is package provenance, never a caller-selected privilege discriminator. */
function deriveRuntimeAuthorityClass(
  input: PersistForecastBundleV2Input,
): ForecastRuntimeAuthorityClassV2 {
  const packageSubjectVersion = input.issuance.package.family.packageSubjectVersion;
  const runtimePackageSubjectVersion =
    input.runtimeInput?.predictivePackage?.family.packageSubjectVersion;
  if (
    runtimePackageSubjectVersion !== undefined &&
    runtimePackageSubjectVersion !== packageSubjectVersion
  ) {
    throw new Error(
      "[forecast-v2/persistence] runtime package provenance mismatch (fail closed)",
    );
  }
  const derived: ForecastRuntimeAuthorityClassV2 =
    packageSubjectVersion === HISTORICAL_FORECAST_FAMILY_BOOTSTRAP_V2
      ? "HISTORICAL_SIMULATION_V2"
      : "GENERAL_FORECAST_V2";
  if (input.runtimeAuthorityClass && input.runtimeAuthorityClass !== derived) {
    throw new Error(
      "[forecast-v2/persistence] runtime authority class contradicts package provenance (fail closed)",
    );
  }
  if (
    derived === "HISTORICAL_SIMULATION_V2" &&
    (!input.runtimeInput || !input.authorizedOutcome)
  ) {
    throw new Error(
      "[forecast-v2/persistence] historical package requires exact runtime authority source (fail closed)",
    );
  }
  return derived;
}

function forecastRuntimeInputVerifierBuildDigest(): string {
  const release = process.env.WAIA_RELEASE_SHA;
  const vercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (release && vercel && release !== vercel) {
    throw new Error("[forecast-v2/persistence] disagreeing immutable build authorities (fail closed)");
  }
  const sha = release ?? vercel;
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error("[forecast-v2/persistence] immutable build SHA unavailable (fail closed)");
  }
  return computeSemanticSha256Hex({ verifierVersion: FORECAST_RUNTIME_INPUT_SOURCE_VERIFIER_V2, sourceSha: sha.toLowerCase() });
}

function validateRuntimeInputSource(
  input: PersistForecastBundleV2Input,
  runtimeAuthorityClass: ForecastRuntimeAuthorityClassV2,
): Readonly<{
  runtimeInput: ForecastRuntimeInputV2; outcomeDigestHex: string; inputDigestHex: string; buildDigestHex: string;
}> | null {
  if (input.authorizedOutcome && !input.runtimeInput) {
    throw new Error("[forecast-v2/persistence] authorized outcome requires exact runtime input source (fail closed)");
  }
  if (!input.runtimeInput) return null;
  if (runtimeAuthorityClass === "HISTORICAL_SIMULATION_V2" &&
      !input.historicalKnowledgeBootstrap) {
    throw new Error("[forecast-v2/persistence] historical knowledge proof required (fail closed)");
  }
  if (runtimeAuthorityClass === "GENERAL_FORECAST_V2" &&
      input.historicalKnowledgeBootstrap) {
    throw new Error("[forecast-v2/persistence] historical proof on general runtime refused");
  }
  if (!input.authorizedOutcome) throw new Error("[forecast-v2/persistence] runtime input requires authorized outcome");
  const replay = issueForecastRuntimeV2(input.runtimeInput);
  if (replay.status !== "FORECAST_AUTHORIZED" || !isDeepStrictEqual(replay, input.authorizedOutcome) ||
      replay.authority.organizationId !== input.organizationId ||
      replay.authority.anchorClosedBarAt !== new Date(input.anchorClosedBarEpochMs).toISOString()) {
    throw new Error("[forecast-v2/persistence] runtime input does not reproduce authorized outcome (fail closed)");
  }
  return {
    runtimeInput: input.runtimeInput,
    outcomeDigestHex: computeSemanticSha256Hex(replay),
    // Bind the digest to the exact JSON representation that is durable in PostgreSQL, rather
    // than to Node Buffer prototypes that jsonb cannot preserve.
    inputDigestHex: computeSemanticSha256Hex(JSON.parse(JSON.stringify(input.runtimeInput))),
    buildDigestHex: forecastRuntimeInputVerifierBuildDigest(),
  };
}

async function verifyHistoricalKnowledgeProofV2(
  sql: postgres.Sql,
  input: PersistForecastBundleV2Input,
  runtime: ForecastRuntimeInputV2,
): Promise<void> {
  const supplied = input.historicalKnowledgeBootstrap;
  if (!supplied) {
    throw new Error("[forecast-v2/persistence] historical knowledge proof required (fail closed)");
  }
  const binding = runtime.forecastContractBinding;
  if (!binding) {
    throw new Error("[forecast-v2/persistence] historical contract binding required (fail closed)");
  }
  const expected = buildHistoricalForecastKnowledgeBootstrapV2({
    organizationId: input.organizationId,
    symbol: input.symbol,
    horizonMinutes: runtime.executionHorizonMinutes,
    predictivePackageContentDigestHex:
      binding.selectedPredictivePackageContentDigestHex,
  });
  if (
    computeSemanticSha256Hex(supplied) !== computeSemanticSha256Hex(expected) ||
    runtime.knowledgeEdgeId !== expected.knowledgeEdgeId ||
    runtime.knowledgeContentDigestHex !== expected.contentDigestHex
  ) {
    throw new Error("[forecast-v2/persistence] runtime knowledge lineage mismatch (fail closed)");
  }
  const rows = await sql<{
    from_ref: string; to_ref: string; relation_kind: string; confidence: string;
    strength: string; regime_scope: string; failure_cases_json: string; verified: boolean;
  }[]>`
    SELECT from_ref, to_ref, relation_kind, confidence, strength,
           regime_scope, failure_cases_json, verified
    FROM trader_knowledge_edges
    WHERE organization_id=${input.organizationId}::uuid
      AND id=${expected.knowledgeEdgeId}::uuid
    FOR SHARE
  `;
  assertHistoricalForecastKnowledgeBootstrapDurableRowV2(expected, rows[0]);
}

export type PersistForecastBundleV2Result = {
  bundleId: string;
  terminalForecastId: string;
  executionForecastId: string;
  retriedExisting: boolean;
};

async function loadExistingBundleByNaturalIdentity(
  sql: postgres.Sql,
  input: PersistForecastBundleV2Input,
  runtimeAuthorityClass: ForecastRuntimeAuthorityClassV2,
): Promise<PersistForecastBundleV2Result | null> {
  const rows = await sql<{
    id: string;
    predictive_package_id: string;
    authorized_outcome: unknown;
    issuance_sequence: number | null;
  }[]>`
    SELECT id::text AS id, predictive_package_id::text AS predictive_package_id,
           forecast_runtime_authorized_outcome_json AS authorized_outcome,
           forecast_runtime_issuance_sequence AS issuance_sequence
    FROM trader_forecast_bundle_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND run_id = ${input.runId}
      AND cycle_id = ${input.cycleId}
      AND symbol = ${input.symbol}
      AND anchor_closed_bar_epoch_ms = ${input.anchorClosedBarEpochMs}
    LIMIT 1
  `;
  const existingId = rows[0]?.id;
  if (!existingId) {
    return null;
  }
  const existingBundle = rows[0]!;
  const expectedPayload = input.authorizedOutcome
    ? JSON.parse(JSON.stringify(input.authorizedOutcome))
    : null;
  if (
    existingBundle.predictive_package_id !== input.packageId ||
    !isDeepStrictEqual(existingBundle.authorized_outcome, expectedPayload) ||
    existingBundle.issuance_sequence !== (input.issuanceSequence ?? null)
  ) {
    throw new Error(
      "[forecast-v2/persistence] natural-idempotent conflict: package/runtime issuance mismatch",
    );
  }
  const forecastRows = await sql<{ id: string; target_role_id: string }[]>`
    SELECT id::text AS id, target_role_id
    FROM trader_forecast_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND bundle_id = ${existingId}::uuid
  `;
  const terminal = forecastRows.find((row) => row.target_role_id === TARGET_ROLE_TERMINAL);
  const execution = forecastRows.find((row) => row.target_role_id === TARGET_ROLE_EXECUTION);
  if (!terminal || !execution) {
    throw new Error(
      "[forecast-v2/persistence] natural-idempotent bundle missing role forecasts (fail closed)",
    );
  }
  const expectedDigest = digestHex(input.issuance.forecastContentDigestTerminal);
  const digestRows = await sql<{ digest: Buffer }[]>`
    SELECT bundle_content_digest AS digest
    FROM trader_forecast_bundle_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND id = ${existingId}::uuid
  `;
  const existingDigest = digestByteaToHex(digestRows[0]!.digest);
  if (existingDigest !== expectedDigest) {
    throw new Error(
      "[forecast-v2/persistence] natural-idempotent conflict: same identity, different content",
    );
  }
  if (input.runtimeInput) {
    const expectedSource = validateRuntimeInputSource(input, runtimeAuthorityClass)!;
    const sourceRows = await sql<{ runtime_input_content_digest_hex: string; authorized_outcome_content_digest_hex: string;
      verifier_build_digest_hex: string }[]>`
      SELECT runtime_input_content_digest_hex, authorized_outcome_content_digest_hex, verifier_build_digest_hex
      FROM trader_forecast_runtime_input_source_v2
      WHERE organization_id=${input.organizationId}::uuid AND bundle_id=${existingId}::uuid
    `;
    if (sourceRows.length !== 1 || sourceRows[0]?.runtime_input_content_digest_hex !== expectedSource.inputDigestHex ||
        sourceRows[0]?.authorized_outcome_content_digest_hex !== expectedSource.outcomeDigestHex ||
        sourceRows[0]?.verifier_build_digest_hex !== expectedSource.buildDigestHex) {
      throw new Error("[forecast-v2/persistence] natural-idempotent runtime source conflict (fail closed)");
    }
  }
  return {
    bundleId: existingId,
    terminalForecastId: terminal.id,
    executionForecastId: execution.id,
    retriedExisting: true,
  };
}

export async function persistForecastBundleV2(
  sql: postgres.Sql,
  input: PersistForecastBundleV2Input,
): Promise<PersistForecastBundleV2Result> {
  if (
    !historicalInstrumentsMatch(input.symbol, input.issuance.package.family.symbol) ||
    input.symbol !== input.issuance.package.family.symbol
  ) {
    throw new Error(
      "[forecast-v2/persistence] symbol mismatch vs predictive package family (fail closed)",
    );
  }
  const runtimeAuthorityClass = deriveRuntimeAuthorityClass(input);
  const runtimeSource = validateRuntimeInputSource(input, runtimeAuthorityClass);
  if (input.organizationId !== input.issuance.organizationId) {
    throw new Error("[forecast-v2/persistence] organizationId mismatch vs issuance (fail closed)");
  }
  if (input.organizationId !== input.issuance.package.family.organizationId) {
    throw new Error(
      "[forecast-v2/persistence] organizationId mismatch vs predictive package family (fail closed)",
    );
  }

  const packageRows = await sql<{
    id: string;
    symbol: string;
    package_content_digest: string;
    package_subject_version: string;
  }[]>`
    SELECT id::text AS id, symbol, package_subject_version,
           predictive_package_content_digest AS package_content_digest
    FROM trader_forecast_predictive_package_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND id = ${input.packageId}::uuid
    LIMIT 1
  `;
  if (!packageRows[0]) {
    throw new Error(
      "[forecast-v2/persistence] predictive package not found for organization (fail closed)",
    );
  }
  if (
    packageRows[0].symbol !== input.symbol ||
    packageRows[0].package_subject_version !==
      input.issuance.package.family.packageSubjectVersion ||
    packageRows[0].package_content_digest !==
      digestHex(input.issuance.package.predictivePackageContentDigest)
  ) {
    throw new Error(
      "[forecast-v2/persistence] persisted predictive package symbol/content mismatch (fail closed)",
    );
  }

  if (runtimeAuthorityClass === "HISTORICAL_SIMULATION_V2") {
    await sql.begin((tx) => verifyHistoricalKnowledgeProofV2(
      tx as unknown as postgres.Sql,
      input,
      input.runtimeInput!,
    ));
  }

  const existing = await loadExistingBundleByNaturalIdentity(
    sql,
    input,
    runtimeAuthorityClass,
  );
  if (existing) {
    return existing;
  }

  const masses = input.issuance.terminalScenarioMasses;
  if (
    masses.probabilities.length !== TERMINAL_BUCKET_COUNT ||
    masses.lowerBoundsScale8.length !== TERMINAL_BUCKET_COUNT ||
    masses.upperBoundsScale8.length !== TERMINAL_BUCKET_COUNT ||
    masses.tailSemantics.length !== TERMINAL_BUCKET_COUNT
  ) {
    throw new Error(
      "[forecast-v2/persistence] Terminal scenario masses must be exactly 7 ordinals (fail closed)",
    );
  }

  assertCanonicalOpenTailSemantics(
    masses.tailSemantics,
    masses.lowerBoundsScale8,
    masses.upperBoundsScale8,
  );

  const scenarioRows = Array.from({ length: TERMINAL_BUCKET_COUNT }, (_, ordinal) => {
    const probability = masses.probabilities[ordinal];
    const lower = masses.lowerBoundsScale8[ordinal];
    const upper = masses.upperBoundsScale8[ordinal];
    const tail = masses.tailSemantics[ordinal];
    if (
      probability === undefined ||
      tail === undefined ||
      lower === undefined ||
      upper === undefined
    ) {
      throw new Error(`[forecast-v2/persistence] missing Terminal scenario ordinal=${ordinal}`);
    }
    return {
      ordinal,
      probability: scale8TextToInt8(quantizeScale8HalfUp(probability)),
      lower: lower === null ? null : scale8TextToInt8(lower),
      upper: upper === null ? null : scale8TextToInt8(upper),
      tail,
    };
  });

  const bundleId = randomUUID();
  const terminalForecastId = randomUUID();
  const executionForecastId = randomUUID();
  const sDec = input.issuance.package.kConfigDec * input.issuance.package.mConfigDec;

  const terminalContent = digestHexToBytea(digestHex(input.issuance.forecastContentDigestTerminal));
  const execContent = digestHexToBytea(digestHex(input.issuance.forecastContentDigestExec));
  const generation = digestHexToBytea(digestHex(input.issuance.forecastGenerationIdentityDigest));
  const terminalSemantic = digestHexToBytea(
    digestHex(input.issuance.distributionSemanticDigestTerminal),
  );
  const execSemantic = digestHexToBytea(digestHex(input.issuance.distributionSemanticDigestExec));
  const bundleSchema = schemaVersionTextToInt2(FORECAST_BUNDLE_SCHEMA_VERSION);
  const forecastSchema = schemaVersionTextToInt2(FORECAST_V2_SCHEMA_VERSION);
  const scenarioSchema = schemaVersionTextToInt2(FORECAST_SCENARIO_SCHEMA_VERSION);

  try {
    await sql.begin(async (tx) => {
      // Serialize new pending issuance against the tenant retention purge. The purge
      // re-checks unresolved references only after acquiring this same transaction lock.
      await tx`
        SELECT pg_advisory_xact_lock(hashtextextended(${input.organizationId}::text, 633))
      `;
      // Issuance seal = append-only bundle + dual Forecast members + 7 Terminal scenarios.
      // Outcomes/calibration are later append-only truth — not required for issuance seal.
      // completeness_state='INCOMPLETE' is the only insert-legal DDL value when outcomes are
      // absent (COMPLETE trigger requires 2/2/2/7 including outcomes). This is NOT a production
      // lifecycle awaiting promotion; A3 "COMPLETE BUNDLE" is measurement cardinality only.
      await tx`
        INSERT INTO trader_forecast_bundle_v2 (
          id, organization_id, predictive_package_id, run_id, cycle_id, symbol,
          anchor_closed_bar_epoch_ms, completeness_state, bundle_content_digest, schema_version,
          forecast_runtime_authorized_outcome_json, forecast_runtime_issuance_sequence
        ) VALUES (
          ${bundleId}::uuid, ${input.organizationId}::uuid, ${input.packageId}::uuid,
          ${input.runId}, ${input.cycleId}, ${input.symbol}, ${input.anchorClosedBarEpochMs},
          'INCOMPLETE', ${terminalContent}, ${bundleSchema},
          ${input.authorizedOutcome ? tx.json(input.authorizedOutcome) : null},
          ${input.issuanceSequence ?? null}
        )
      `;
      await tx`
        INSERT INTO trader_forecast_v2 (
          id, organization_id, bundle_id, target_role_id, forecast_generation_identity_digest,
          forecast_content_digest, distribution_semantic_digest, k_config_dec, m_config_dec, s_dec,
          schema_version
        ) VALUES (
          ${terminalForecastId}::uuid, ${input.organizationId}::uuid, ${bundleId}::uuid,
          ${TARGET_ROLE_TERMINAL}, ${generation}, ${terminalContent}, ${terminalSemantic},
          ${input.issuance.package.kConfigDec}, ${input.issuance.package.mConfigDec}, ${sDec},
          ${forecastSchema}
        )
      `;
      await tx`
        INSERT INTO trader_forecast_v2 (
          id, organization_id, bundle_id, target_role_id, forecast_generation_identity_digest,
          forecast_content_digest, distribution_semantic_digest, k_config_dec, m_config_dec, s_dec,
          schema_version
        ) VALUES (
          ${executionForecastId}::uuid, ${input.organizationId}::uuid, ${bundleId}::uuid,
          ${TARGET_ROLE_EXECUTION}, ${generation}, ${execContent}, ${execSemantic},
          ${input.issuance.package.kConfigDec}, ${input.issuance.package.mConfigDec}, ${sDec},
          ${forecastSchema}
        )
      `;
      if (runtimeSource) {
        const runtime = runtimeSource.runtimeInput;
        const binding = runtime.forecastContractBinding;
        const admission = runtime.predictiveAdmissionReceipt;
        const snapshot = runtime.marketStateSnapshot;
        const knowledgeContentDigestHex = runtime.knowledgeContentDigestHex;
        if (!binding || !admission || !snapshot || !runtime.predictivePackage || !knowledgeContentDigestHex) {
          throw new Error("[forecast-v2/persistence] authorized runtime source is incomplete");
        }
        if (runtimeAuthorityClass === "HISTORICAL_SIMULATION_V2") {
          await verifyHistoricalKnowledgeProofV2(
            tx as unknown as postgres.Sql,
            input,
            runtime,
          );
        }
        await tx`
          INSERT INTO trader_forecast_runtime_input_source_v2 (
            organization_id, bundle_id, execution_forecast_id,
            execution_forecast_target_role_id, execution_forecast_content_digest,
            run_id, cycle_id, symbol, pit_anchor,
            anchor_closed_bar_epoch_ms, predictive_package_id, predictive_package_content_digest_hex,
            scientific_admission_receipt_id, scientific_admission_content_digest_hex,
            contract_binding_content_digest_hex, knowledge_edge_id, knowledge_content_digest_hex,
            market_snapshot_content_digest_hex, predictive_admission_content_digest_hex,
            forecast_authority_content_digest_hex, authorized_outcome_content_digest_hex,
            runtime_input_content_digest_hex, runtime_input_json, authorized_outcome_json,
            verifier_version, verifier_build_digest_hex, schema_version
          ) VALUES (
            ${input.organizationId}::uuid, ${bundleId}::uuid, ${executionForecastId}::uuid,
            ${TARGET_ROLE_EXECUTION}, ${execContent},
            ${input.runId}, ${input.cycleId}, ${input.symbol}, ${new Date(input.anchorClosedBarEpochMs).toISOString()}::timestamptz,
            ${input.anchorClosedBarEpochMs}, ${input.packageId}::uuid, ${binding.selectedPredictivePackageContentDigestHex},
            ${binding.scientificAdmissionReceiptId}::uuid, ${binding.scientificAdmissionReceiptContentDigestHex},
            ${binding.contentDigestHex}, ${runtime.knowledgeEdgeId ?? null}::uuid, ${knowledgeContentDigestHex},
            ${snapshot.contentDigestHex}, ${admission.contentDigestHex},
            ${input.authorizedOutcome!.authority.contentDigestHex}, ${runtimeSource.outcomeDigestHex},
            ${runtimeSource.inputDigestHex}, ${tx.json(runtime as never)}, ${tx.json(input.authorizedOutcome as never)},
            ${FORECAST_RUNTIME_INPUT_SOURCE_VERIFIER_V2}, ${runtimeSource.buildDigestHex}, ${FORECAST_RUNTIME_INPUT_SOURCE_V2}
          )
        `;
      }
      for (const row of scenarioRows) {
        const lowerParam = row.lower === null ? null : row.lower.toString();
        const upperParam = row.upper === null ? null : row.upper.toString();
        await tx`
          INSERT INTO trader_forecast_scenario_v2 (
            organization_id, forecast_id, scenario_ordinal, probability_scale8,
            lower_bound_scale8, upper_bound_scale8, content_digest, schema_version
          ) VALUES (
            ${input.organizationId}::uuid, ${terminalForecastId}::uuid, ${row.ordinal},
            ${row.probability.toString()}::bigint,
            ${lowerParam},
            ${upperParam},
            ${terminalContent},
            ${scenarioSchema}
          )
        `;
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("tfbv2_org_natural_idempotency_uq")) {
      const raced = await loadExistingBundleByNaturalIdentity(
        sql,
        input,
        runtimeAuthorityClass,
      );
      if (raced) {
        return raced;
      }
    }
    throw error;
  }

  return {
    bundleId,
    terminalForecastId,
    executionForecastId,
    retriedExisting: false,
  };
}

/** Fail-closed open-tail consistency (production issuance + tests). */
export function assertCanonicalOpenTailSemantics(
  tails: readonly TerminalBucketTailSemanticsV1[],
  lowers: readonly (string | null)[],
  uppers: readonly (string | null)[],
): void {
  for (let i = 0; i < TERMINAL_BUCKET_COUNT; i += 1) {
    const tail = tails[i]!;
    const lower = lowers[i]!;
    const upper = uppers[i]!;
    if (tail === "LOWER_TAIL") {
      if (i !== 0 || lower !== null || upper === null) {
        throw new Error("[forecast-v2/persistence] malformed LOWER_TAIL definition (fail closed)");
      }
    } else if (tail === "UPPER_TAIL") {
      if (i !== TERMINAL_BUCKET_COUNT - 1 || upper !== null || lower === null) {
        throw new Error("[forecast-v2/persistence] malformed UPPER_TAIL definition (fail closed)");
      }
    } else if (tail === "INTERIOR") {
      if (lower === null || upper === null) {
        throw new Error("[forecast-v2/persistence] malformed INTERIOR definition (fail closed)");
      }
    } else {
      throw new Error("[forecast-v2/persistence] unknown tail_semantics (fail closed)");
    }
  }
}

/**
 * Persist Terminal DISCRETE_SCENARIO target definition + exactly 7 open-tail bucket rows.
 * Canonical: ordinal 0 LOWER_TAIL (lower NULL), ordinal 6 UPPER_TAIL (upper NULL).
 */
export async function persistTerminalTargetBucketsV2(
  sql: postgres.Sql,
  input: {
    organizationId: string;
    venue: string;
    market: string;
    symbol: string;
    primaryHorizonMinutes: number;
    grid: ForecastIssuanceV1["package"]["terminalTargetGrid"];
    gridIdentityDigestHex: string;
  },
): Promise<{ targetDefinitionId: string; bucketIds: string[] }> {
  const defs = terminalTargetBucketDefinitionsFromGrid(input.grid);
  if (defs.length !== TERMINAL_BUCKET_COUNT) {
    throw new Error("[forecast-v2/persistence] expected exactly 7 Terminal target buckets");
  }
  if (defs[0]!.tailSemantics !== "LOWER_TAIL" || defs[0]!.lowerBound !== null) {
    throw new Error("[forecast-v2/persistence] ordinal 0 must be LOWER_TAIL with NULL lower");
  }
  if (defs[6]!.tailSemantics !== "UPPER_TAIL" || defs[6]!.upperBound !== null) {
    throw new Error("[forecast-v2/persistence] ordinal 6 must be UPPER_TAIL with NULL upper");
  }

  const targetDefinitionId = randomUUID();
  const targetDefinitionDigest = createHash("sha256")
    .update(
      [
        TARGET_DEFINITION_SCHEMA_VERSION,
        input.organizationId,
        input.symbol,
        String(input.primaryHorizonMinutes),
        TARGET_ROLE_TERMINAL,
        "DISCRETE_SCENARIO",
        input.gridIdentityDigestHex,
      ].join("\n"),
      "utf8",
    )
    .digest("hex");

  await sql`
    INSERT INTO trader_forecast_target_definition_v2 (
      id, organization_id, venue, market, symbol, primary_horizon_minutes,
      target_role_id, representation_kind, component_layout_version,
      target_definition_digest, schema_version, idempotency_key
    ) VALUES (
      ${targetDefinitionId}::uuid, ${input.organizationId}::uuid,
      ${input.venue}, ${input.market}, ${input.symbol}, ${input.primaryHorizonMinutes},
      ${TARGET_ROLE_TERMINAL}, 'DISCRETE_SCENARIO', 'exec-opp-13d-v1',
      ${targetDefinitionDigest}, ${TARGET_DEFINITION_SCHEMA_VERSION}, ${randomUUID()}
    )
  `;

  const bucketIds: string[] = [];
  for (const def of defs) {
    const bucketId = randomUUID();
    bucketIds.push(bucketId);
    const lowerText = def.lowerBound === null ? null : quantizeScale8HalfUp(def.lowerBound);
    const upperText = def.upperBound === null ? null : quantizeScale8HalfUp(def.upperBound);
    const contentDigest = createHash("sha256")
      .update(
        [
          TARGET_BUCKET_SCHEMA_VERSION,
          targetDefinitionId,
          String(def.bucketOrdinal),
          def.tailSemantics,
          lowerText ?? "NULL",
          upperText ?? "NULL",
        ].join("\n"),
        "utf8",
      )
      .digest("hex");
    await sql`
      INSERT INTO trader_forecast_target_bucket_v2 (
        id, organization_id, target_definition_id, bucket_ordinal, bucket_label,
        lower_bound_scale8, upper_bound_scale8, tail_semantics, content_digest, schema_version, idempotency_key
      ) VALUES (
        ${bucketId}::uuid, ${input.organizationId}::uuid, ${targetDefinitionId}::uuid,
        ${def.bucketOrdinal}, ${`B${def.bucketOrdinal}`},
        ${lowerText}, ${upperText}, ${def.tailSemantics},
        ${contentDigest}, ${TARGET_BUCKET_SCHEMA_VERSION}, ${randomUUID()}
      )
    `;
  }
  return { targetDefinitionId, bucketIds };
}

/**
 * Objective PIT resolution for a sealed Forecast. Does NOT fabricate outcomes from forecast digests.
 * Issuance seal does not require outcomes; resolution is a separate later append-only truth record.
 * A3 "COMPLETE BUNDLE" measurement cardinality is unrelated to this production path.
 */
export async function persistObjectiveForecastOutcomeResolutionV2(
  sql: postgres.Sql,
  input: {
    organizationId: string;
    bundleId: string;
    forecastId: string;
    targetRoleId: typeof TARGET_ROLE_TERMINAL | typeof TARGET_ROLE_EXECUTION;
    /** Real resolution timestamp (must be after eligible horizon end). */
    resolvedAtIso: string;
    anchorClosedBarEpochMs: number;
    primaryHorizonMinutes: number;
    /**
     * Objective observed-outcome digest from PIT materializer / measurement identity.
     * Must NOT equal the forecast content digest.
     */
    observedOutcomeDigestHex: string;
    contentDigestHex: string;
    /** Independent PIT measurement identity (must not be the forecast digest). */
    pitMeasurementIdentityDigestHex: string;
    feedbackPayload?: Readonly<{
      authorizedOutcome: ForecastRuntimeAuthorizedOutcomeV2;
      objectiveEvidence: Parameters<typeof scoreForecastV2MulticlassObservation>[0]["objectiveEvidence"];
    }>;
  },
): Promise<void> {
  const eligibleFrom = input.anchorClosedBarEpochMs + (input.primaryHorizonMinutes + 3) * 60_000;
  const resolvedAtMs = Date.parse(input.resolvedAtIso);
  if (!Number.isFinite(resolvedAtMs) || resolvedAtMs < eligibleFrom) {
    throw new Error(
      "[forecast-v2/persistence] resolution before eligible horizon rejected (fail closed)",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(input.observedOutcomeDigestHex)) {
    throw new Error("[forecast-v2/persistence] invalid observedOutcomeDigestHex");
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentDigestHex)) {
    throw new Error("[forecast-v2/persistence] invalid contentDigestHex");
  }
  if (!/^[0-9a-f]{64}$/.test(input.pitMeasurementIdentityDigestHex)) {
    throw new Error("[forecast-v2/persistence] invalid pitMeasurementIdentityDigestHex");
  }

  const forecastRows = await sql<
    { forecast_content_digest: Buffer; bundle_id: string; target_role_id: string }[]
  >`
    SELECT forecast_content_digest, bundle_id::text AS bundle_id, target_role_id
    FROM trader_forecast_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND id = ${input.forecastId}::uuid
      AND bundle_id = ${input.bundleId}::uuid
    LIMIT 1
  `;
  const forecast = forecastRows[0];
  if (!forecast) {
    throw new Error("[forecast-v2/persistence] forecast not found for org/bundle (fail closed)");
  }
  if (forecast.target_role_id !== input.targetRoleId) {
    throw new Error("[forecast-v2/persistence] target role mismatch (fail closed)");
  }
  const forecastDigestHex = digestByteaToHex(forecast.forecast_content_digest);
  if (
    input.observedOutcomeDigestHex === forecastDigestHex ||
    input.contentDigestHex === forecastDigestHex ||
    input.pitMeasurementIdentityDigestHex === forecastDigestHex
  ) {
    throw new Error(
      "[forecast-v2/persistence] forecast digest cannot masquerade as resolution measurement (fail closed)",
    );
  }

  const outcomeDigest = digestHexToBytea(input.observedOutcomeDigestHex);
  const contentDigest = digestHexToBytea(input.contentDigestHex);
  const outcomeSchema = schemaVersionTextToInt2(FORECAST_OUTCOME_SCHEMA_VERSION);
  const feedback = input.feedbackPayload;
  const observation = feedback
    ? scoreForecastV2MulticlassObservation({
        authorizedOutcome: feedback.authorizedOutcome,
        objectiveEvidence: feedback.objectiveEvidence,
      })
    : null;
  if (feedback) {
    const evidence = feedback.objectiveEvidence;
    if (
      evidence.organizationId !== input.organizationId ||
      evidence.resolvedAt !== input.resolvedAtIso ||
      evidence.pitMeasurementIdentityDigestHex !== input.pitMeasurementIdentityDigestHex ||
      evidence.observedOutcomeDigestHex !== input.observedOutcomeDigestHex ||
      observation?.terminalForecastContentDigestHex !== forecastDigestHex
    ) {
      throw new Error("[forecast-v2/persistence] DEE-633 objective evidence mismatch");
    }
  }

  const existingOutcome = await sql<
    {
      content_digest_hex: string;
      observed_outcome_digest_hex: string;
      pit_measurement_identity_digest_hex: string | null;
    }[]
  >`
    SELECT encode(content_digest, 'hex') AS content_digest_hex,
           encode(observed_outcome_digest, 'hex') AS observed_outcome_digest_hex,
           encode(pit_measurement_identity_digest, 'hex') AS pit_measurement_identity_digest_hex
    FROM trader_forecast_outcome_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND forecast_id = ${input.forecastId}::uuid
    LIMIT 1
  `;
  if (existingOutcome[0]) {
    if (
      existingOutcome[0].content_digest_hex === input.contentDigestHex &&
      existingOutcome[0].observed_outcome_digest_hex === input.observedOutcomeDigestHex &&
      existingOutcome[0].pit_measurement_identity_digest_hex ===
        (feedback ? input.pitMeasurementIdentityDigestHex : null)
    ) {
      return;
    }
    throw new Error(
      "[forecast-v2/persistence] objective outcome natural-idempotent conflict (fail closed)",
    );
  }

  await sql`
    INSERT INTO trader_forecast_outcome_v2 (
      organization_id, bundle_id, forecast_id, target_role_id, resolved_at,
      outcome_class, observed_outcome_digest, content_digest, schema_version,
      pit_measurement_identity_digest, observed_terminal_return, observed_bucket_ordinal,
      objective_evidence_json, forecast_runtime_authority_content_digest,
      predictive_package_content_digest, terminal_target_definition_digest,
      terminal_distribution_semantic_digest, knowledge_edge_id, knowledge_content_digest
    ) VALUES (
      ${input.organizationId}::uuid, ${input.bundleId}::uuid, ${input.forecastId}::uuid,
      ${input.targetRoleId}, ${input.resolvedAtIso}::timestamptz,
      'RESOLVED', ${outcomeDigest}, ${contentDigest}, ${outcomeSchema},
      ${feedback ? digestHexToBytea(input.pitMeasurementIdentityDigestHex) : null},
      ${feedback?.objectiveEvidence.observedTerminalReturn ?? null},
      ${observation?.observedBucketOrdinal ?? null},
      ${feedback ? sql.json(feedback.objectiveEvidence as never) : null}::jsonb,
      ${observation ? digestHexToBytea(observation.forecastRuntimeAuthorityContentDigestHex) : null},
      ${observation?.predictivePackageContentDigestHex ?? null},
      ${observation?.terminalTargetDefinitionDigestHex ?? null},
      ${observation ? digestHexToBytea(observation.terminalDistributionSemanticDigestHex) : null},
      ${feedback?.objectiveEvidence.knowledgeEdgeId ?? null},
      ${feedback ? digestHexToBytea(feedback.objectiveEvidence.knowledgeContentDigestHex) : null}
    )
  `;
}

/**
 * Calibration observation may be written only after an objective RESOLVED outcome exists
 * for the same forecast. Never score from fabricated issuance outcomes.
 */
export async function persistForecastCalibrationObservationV2(
  sql: postgres.Sql,
  input: {
    organizationId: string;
    bundleId: string;
    forecastId: string;
    targetRoleId: typeof TARGET_ROLE_TERMINAL | typeof TARGET_ROLE_EXECUTION;
    contentDigestHex: string;
    scoringEligible: boolean;
    observation?: ForecastV2CalibrationObservation;
  },
): Promise<void> {
  const outcomeRows = await sql<
    {
      outcome_class: string;
      observed_outcome_digest_hex: string;
      pit_measurement_identity_digest_hex: string | null;
      forecast_runtime_authority_content_digest_hex: string | null;
      predictive_package_content_digest: string | null;
      terminal_target_definition_digest: string | null;
      terminal_distribution_semantic_digest_hex: string | null;
      knowledge_edge_id: string | null;
      knowledge_content_digest_hex: string | null;
      terminal_forecast_content_digest_hex: string;
    }[]
  >`
    SELECT o.outcome_class,
           encode(o.observed_outcome_digest, 'hex') AS observed_outcome_digest_hex,
           encode(o.pit_measurement_identity_digest, 'hex') AS pit_measurement_identity_digest_hex,
           encode(o.forecast_runtime_authority_content_digest, 'hex') AS forecast_runtime_authority_content_digest_hex,
           o.predictive_package_content_digest, o.terminal_target_definition_digest,
           encode(o.terminal_distribution_semantic_digest, 'hex') AS terminal_distribution_semantic_digest_hex,
           o.knowledge_edge_id,
           encode(o.knowledge_content_digest, 'hex') AS knowledge_content_digest_hex,
           encode(f.forecast_content_digest, 'hex') AS terminal_forecast_content_digest_hex
    FROM trader_forecast_outcome_v2 o
    JOIN trader_forecast_v2 f
      ON f.organization_id = o.organization_id AND f.id = o.forecast_id
    WHERE o.organization_id = ${input.organizationId}::uuid
      AND o.forecast_id = ${input.forecastId}::uuid
      AND o.bundle_id = ${input.bundleId}::uuid
    LIMIT 1
  `;
  if (!outcomeRows[0] || outcomeRows[0].outcome_class !== "RESOLVED") {
    throw new Error(
      "[forecast-v2/persistence] calibration requires objective RESOLVED outcome (fail closed)",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentDigestHex)) {
    throw new Error("[forecast-v2/persistence] invalid calibration contentDigestHex");
  }
  const contentDigest = digestHexToBytea(input.contentDigestHex);
  const calibrationSchema = schemaVersionTextToInt2(FORECAST_CALIBRATION_SCHEMA_VERSION);
  if (
    input.observation &&
    (requireForecastV2CalibrationObservation(input.observation).organizationId !==
      input.organizationId ||
      input.observation.contentDigest !== input.contentDigestHex ||
      input.observation.scoringEligible !== input.scoringEligible ||
      input.observation.observedOutcomeDigestHex !== outcomeRows[0]?.observed_outcome_digest_hex ||
      input.observation.pitMeasurementIdentityDigestHex !==
        outcomeRows[0]?.pit_measurement_identity_digest_hex ||
      input.observation.forecastRuntimeAuthorityContentDigestHex !==
        outcomeRows[0]?.forecast_runtime_authority_content_digest_hex ||
      input.observation.predictivePackageContentDigestHex !==
        outcomeRows[0]?.predictive_package_content_digest ||
      input.observation.terminalTargetDefinitionDigestHex !==
        outcomeRows[0]?.terminal_target_definition_digest ||
      input.observation.terminalDistributionSemanticDigestHex !==
        outcomeRows[0]?.terminal_distribution_semantic_digest_hex ||
      input.observation.terminalForecastContentDigestHex !==
        outcomeRows[0]?.terminal_forecast_content_digest_hex ||
      input.observation.knowledgeEdgeId !== outcomeRows[0]?.knowledge_edge_id ||
      input.observation.knowledgeContentDigestHex !==
        outcomeRows[0]?.knowledge_content_digest_hex)
  ) {
    throw new Error("[forecast-v2/persistence] DEE-633 calibration observation mismatch");
  }
  const existingObservation = await sql<
    { content_digest_hex: string; scoring_eligible: boolean; scoring_version: string | null }[]
  >`
    SELECT encode(content_digest, 'hex') AS content_digest_hex,
           scoring_eligible, scoring_version
    FROM trader_forecast_calibration_observation_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND forecast_id = ${input.forecastId}::uuid
    LIMIT 1
  `;
  if (existingObservation[0]) {
    if (
      existingObservation[0].content_digest_hex === input.contentDigestHex &&
      existingObservation[0].scoring_eligible === input.scoringEligible &&
      existingObservation[0].scoring_version === (input.observation?.schemaVersion ?? null)
    ) {
      return;
    }
    throw new Error(
      "[forecast-v2/persistence] calibration natural-idempotent conflict (fail closed)",
    );
  }
  await sql`
    INSERT INTO trader_forecast_calibration_observation_v2 (
      organization_id, bundle_id, forecast_id, target_role_id, scoring_eligible,
      content_digest, schema_version, scoring_version, observed_bucket_ordinal,
      probability_vector_json, normalized_brier_score, log_loss_score,
      calibration_payload_json
    ) VALUES (
      ${input.organizationId}::uuid, ${input.bundleId}::uuid, ${input.forecastId}::uuid,
      ${input.targetRoleId}, ${input.scoringEligible}, ${contentDigest}, ${calibrationSchema},
      ${input.observation?.schemaVersion ?? null},
      ${input.observation?.observedBucketOrdinal ?? null},
      ${input.observation ? sql.json([...input.observation.probabilities] as never) : null}::jsonb,
      ${input.observation ? Number(input.observation.normalizedBrierScore) : null},
      ${input.observation ? Number(input.observation.logLossScore) : null},
      ${input.observation ? sql.json(input.observation as never) : null}::jsonb
    )
  `;
}

/** A3 measurement-only COMPLETE+RESOLVED inserts live in storage-scale-postgres-v1 — not here. */
export const A3_SYNTHETIC_OUTCOME_FIXTURE_ISOLATION =
  "A3_MEASUREMENT_HARNESS_ONLY_NOT_PRODUCTION" as const;

export type ForecastV2PitRetentionPurgeResult = Readonly<{
  requestId: string;
  purgedRowCount: number;
}>;

/**
 * Invokes the narrowly privileged, audited PostgreSQL retention boundary.
 * The database remains authoritative for the 30-day minimum and unresolved-bundle exclusion.
 */
export async function purgeRetainedForecastV2PitBars(input: {
  sql: postgres.Sql;
  organizationId: string;
  cutoffAtIso: string;
  requestId?: string;
}): Promise<ForecastV2PitRetentionPurgeResult> {
  const requestId = input.requestId ?? randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    input.organizationId,
  )) {
    throw new Error("[forecast-v2/retention] invalid organizationId");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    requestId,
  )) {
    throw new Error("[forecast-v2/retention] invalid requestId");
  }
  if (!Number.isFinite(Date.parse(input.cutoffAtIso))) {
    throw new Error("[forecast-v2/retention] invalid cutoffAtIso");
  }
  return input.sql.begin(async (tx) => {
    const rows = await tx<{ request_id: string; purged_row_count: string }[]>`
      SELECT request_id::text, purged_row_count::text
      FROM public.waia_forecast_pit_bar_v2_purge_retained(
        ${input.organizationId}::uuid,
        ${requestId}::uuid,
        ${input.cutoffAtIso}::timestamptz
      )
    `;
    const row = rows[0];
    if (!row || !/^\d+$/.test(row.purged_row_count)) {
      throw new Error("[forecast-v2/retention] purge receipt missing or invalid");
    }
    return { requestId: row.request_id, purgedRowCount: Number(row.purged_row_count) };
  });
}

export type LoadedForecastV2Digests = {
  bundleContentDigestHex: string;
  terminalForecastContentDigestHex: string;
  executionForecastContentDigestHex: string;
  terminalDistributionSemanticDigestHex: string;
  executionDistributionSemanticDigestHex: string;
  terminalScenarioCount: number;
  calibrationObservationCount: number;
  replicaArtifactCount: number;
  predictivePackageContentDigestHex: string;
};

export async function loadPersistedForecastV2Digests(
  sql: postgres.Sql,
  input: { organizationId: string; bundleId: string; packageId: string },
): Promise<LoadedForecastV2Digests> {
  const bundleRows = await sql<{ bundle_content_digest: Buffer }[]>`
    SELECT bundle_content_digest
    FROM trader_forecast_bundle_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND id = ${input.bundleId}::uuid
  `;
  const packageRows = await sql<{ package_content_digest: string }[]>`
    SELECT predictive_package_content_digest AS package_content_digest
    FROM trader_forecast_predictive_package_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND id = ${input.packageId}::uuid
  `;
  const forecastRows = await sql<
    {
      target_role_id: string;
      forecast_content_digest: Buffer;
      distribution_semantic_digest: Buffer;
    }[]
  >`
    SELECT target_role_id, forecast_content_digest, distribution_semantic_digest
    FROM trader_forecast_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND bundle_id = ${input.bundleId}::uuid
  `;
  const scenarioRows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM trader_forecast_scenario_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND forecast_id IN (
        SELECT id
        FROM trader_forecast_v2
        WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
          AND bundle_id = ${input.bundleId}::uuid
      )
  `;
  const calibrationRows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM trader_forecast_calibration_observation_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND bundle_id = ${input.bundleId}::uuid
  `;
  const artifactRows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM trader_forecast_replica_artifact_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND predictive_package_id = ${input.packageId}::uuid
  `;

  const terminal = forecastRows.find((row) => row.target_role_id === TARGET_ROLE_TERMINAL);
  const execution = forecastRows.find((row) => row.target_role_id === TARGET_ROLE_EXECUTION);
  if (!bundleRows[0] || !packageRows[0] || !terminal || !execution) {
    throw new Error("[forecast-v2/persistence] loaded bundle or forecast rows missing");
  }

  return {
    bundleContentDigestHex: digestByteaToHex(bundleRows[0].bundle_content_digest),
    terminalForecastContentDigestHex: digestByteaToHex(terminal.forecast_content_digest),
    executionForecastContentDigestHex: digestByteaToHex(execution.forecast_content_digest),
    terminalDistributionSemanticDigestHex: digestByteaToHex(terminal.distribution_semantic_digest),
    executionDistributionSemanticDigestHex: digestByteaToHex(
      execution.distribution_semantic_digest,
    ),
    terminalScenarioCount: Number(scenarioRows[0]?.count ?? 0),
    calibrationObservationCount: Number(calibrationRows[0]?.count ?? 0),
    replicaArtifactCount: Number(artifactRows[0]?.count ?? 0),
    predictivePackageContentDigestHex: packageRows[0].package_content_digest,
  };
}

export async function verifyPersistedForecastV2RoundTrip(input: {
  sql: postgres.Sql;
  organizationId: string;
  bundleId: string;
  packageId: string;
  issuance: ForecastIssuanceV1;
}): Promise<{ replayDigestMatch: boolean; loadedDigests: LoadedForecastV2Digests }> {
  const loaded = await loadPersistedForecastV2Digests(input.sql, {
    organizationId: input.organizationId,
    bundleId: input.bundleId,
    packageId: input.packageId,
  });

  verifyForecastDistributionReplayV1({
    issuance: input.issuance,
    expectedDistributionSemanticDigestExec: input.issuance.distributionSemanticDigestExec,
  });

  const replay = issueForecastV1({
    pkg: input.issuance.package,
    anchorClosedBarEpochMs: input.issuance.anchorClosedBarEpochMs,
    anchorRealizedVol20m_1m: input.issuance.anchorRealizedVol20m_1m,
    executionHorizonMinutes: input.issuance.executionHorizonMinutes,
    normalizationVersionDigestHex: input.issuance.normalizationVersionDigestHex,
  });

  const comparisons = [
    [
      "distributionSemanticTerminal",
      digestHex(replay.distributionSemanticDigestTerminal),
      loaded.terminalDistributionSemanticDigestHex,
    ],
    [
      "distributionSemanticExec",
      digestHex(replay.distributionSemanticDigestExec),
      loaded.executionDistributionSemanticDigestHex,
    ],
    [
      "forecastContentTerminal",
      digestHex(replay.forecastContentDigestTerminal),
      loaded.terminalForecastContentDigestHex,
    ],
    [
      "forecastContentExec",
      digestHex(replay.forecastContentDigestExec),
      loaded.executionForecastContentDigestHex,
    ],
    [
      "predictivePackageContent",
      digestHex(replay.package.predictivePackageContentDigest),
      loaded.predictivePackageContentDigestHex,
    ],
  ] as const;
  const mismatches = comparisons.filter(([, left, right]) => left !== right);
  const replayDigestMatch = mismatches.length === 0;

  if (!replayDigestMatch) {
    throw new Error(
      `[forecast-v2/persistence] reload/replay digest equivalence failed: ${mismatches
        .map(([name, left, right]) => `${name} replay=${left} loaded=${right}`)
        .join("; ")}`,
    );
  }

  return { replayDigestMatch, loadedDigests: loaded };
}
