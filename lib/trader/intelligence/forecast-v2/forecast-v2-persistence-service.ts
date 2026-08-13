import { createHash, randomUUID } from "node:crypto";

import type postgres from "postgres";

import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";

import {
  QUANTIZER_VERSION,
  SAMPLER_CONTRACT_VERSION,
  TARGET_ROLE_EXECUTION,
  TARGET_ROLE_TERMINAL,
} from "./constants";
import { digestByteaToHex, digestHexToBytea } from "./digest-storage-codec-v1";
import { digestHex } from "./identity-digests";
import {
  TERMINAL_BUCKET_COUNT,
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
  issueForecastV1,
  serializeReplicaArtifactPayloadV1,
  verifyForecastDistributionReplayV1,
} from "./rv-state-conditional-empirical-joint-v1";
import { quantizeScale8HalfUp } from "./quantize-scale8-half-up-v1";

export const FORECAST_BUNDLE_SCHEMA_VERSION = "forecast-bundle/v2" as const;
export const FORECAST_CALIBRATION_SCHEMA_VERSION = "forecast-calibration/v2" as const;
export const FORECAST_OUTCOME_SCHEMA_VERSION = "forecast-outcome/v2" as const;
export const FORECAST_SCENARIO_SCHEMA_VERSION = "forecast-scenario/v2" as const;
export const FORECAST_V2_SCHEMA_VERSION = "forecast/v2" as const;
export const PREDICTIVE_PACKAGE_SCHEMA_VERSION = "predictive-package/v2" as const;
export const TARGET_DEFINITION_SCHEMA_VERSION = "target-definition/v2" as const;
export const TARGET_BUCKET_SCHEMA_VERSION = "target-bucket/v2" as const;

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

export async function persistPredictivePackageV2(
  sql: postgres.Sql,
  pkg: PredictivePackageV1,
  input: PersistPredictivePackageV2Input,
): Promise<PersistPredictivePackageV2Result> {
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
    predictivePackageContentDigestHex: digestHex(pkg.predictivePackageContentDigest),
    predictivePackageGenerationIdentityDigestHex: digestHex(
      pkg.predictivePackageGenerationIdentityDigest,
    ),
    terminalTargetDefinitionId: terminalTargets.targetDefinitionId,
    terminalTargetBucketIds: terminalTargets.bucketIds,
  };
}

export type PersistForecastBundleV2Input = {
  organizationId: string;
  packageId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  anchorClosedBarEpochMs: number;
  issuance: ForecastIssuanceV1;
  /** @deprecated Natural identity (run/cycle/symbol/anchor) is the idempotency authority. */
  idempotencyKey?: string;
};

export type PersistForecastBundleV2Result = {
  bundleId: string;
  terminalForecastId: string;
  executionForecastId: string;
  retriedExisting: boolean;
};

async function loadExistingBundleByNaturalIdentity(
  sql: postgres.Sql,
  input: PersistForecastBundleV2Input,
): Promise<PersistForecastBundleV2Result | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id::text AS id
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
  if (input.organizationId !== input.issuance.organizationId) {
    throw new Error("[forecast-v2/persistence] organizationId mismatch vs issuance (fail closed)");
  }
  if (input.organizationId !== input.issuance.package.family.organizationId) {
    throw new Error(
      "[forecast-v2/persistence] organizationId mismatch vs predictive package family (fail closed)",
    );
  }

  const packageRows = await sql<{ id: string }[]>`
    SELECT id::text AS id
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

  const existing = await loadExistingBundleByNaturalIdentity(sql, input);
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
      // Issuance seal = append-only bundle + dual Forecast members + 7 Terminal scenarios.
      // Outcomes/calibration are later append-only truth — not required for issuance seal.
      // completeness_state='INCOMPLETE' is the only insert-legal DDL value when outcomes are
      // absent (COMPLETE trigger requires 2/2/2/7 including outcomes). This is NOT a production
      // lifecycle awaiting promotion; A3 "COMPLETE BUNDLE" is measurement cardinality only.
      await tx`
        INSERT INTO trader_forecast_bundle_v2 (
          id, organization_id, predictive_package_id, run_id, cycle_id, symbol,
          anchor_closed_bar_epoch_ms, completeness_state, bundle_content_digest, schema_version
        ) VALUES (
          ${bundleId}::uuid, ${input.organizationId}::uuid, ${input.packageId}::uuid,
          ${input.runId}, ${input.cycleId}, ${input.symbol}, ${input.anchorClosedBarEpochMs},
          'INCOMPLETE', ${terminalContent}, ${bundleSchema}
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
      const raced = await loadExistingBundleByNaturalIdentity(sql, input);
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

  await sql`
    INSERT INTO trader_forecast_outcome_v2 (
      organization_id, bundle_id, forecast_id, target_role_id, resolved_at,
      outcome_class, observed_outcome_digest, content_digest, schema_version
    ) VALUES (
      ${input.organizationId}::uuid, ${input.bundleId}::uuid, ${input.forecastId}::uuid,
      ${input.targetRoleId}, ${input.resolvedAtIso}::timestamptz,
      'RESOLVED', ${outcomeDigest}, ${contentDigest}, ${outcomeSchema}
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
  },
): Promise<void> {
  const outcomeRows = await sql<{ outcome_class: string }[]>`
    SELECT outcome_class
    FROM trader_forecast_outcome_v2
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND forecast_id = ${input.forecastId}::uuid
      AND bundle_id = ${input.bundleId}::uuid
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
  await sql`
    INSERT INTO trader_forecast_calibration_observation_v2 (
      organization_id, bundle_id, forecast_id, target_role_id, scoring_eligible,
      content_digest, schema_version
    ) VALUES (
      ${input.organizationId}::uuid, ${input.bundleId}::uuid, ${input.forecastId}::uuid,
      ${input.targetRoleId}, ${input.scoringEligible}, ${contentDigest}, ${calibrationSchema}
    )
  `;
}

/** A3 measurement-only COMPLETE+RESOLVED inserts live in storage-scale-postgres-v1 — not here. */
export const A3_SYNTHETIC_OUTCOME_FIXTURE_ISOLATION =
  "A3_MEASUREMENT_HARNESS_ONLY_NOT_PRODUCTION" as const;

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
