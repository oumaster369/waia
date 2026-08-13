import {
  FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE,
  FORECAST_V2_PROPORTIONAL_ROWS_PER_BUNDLE,
} from "./storage-scale-projection";
import type { A3PostgresMeasurementEnvironmentV1 } from "./a3-postgres-measurement-environment-v1";

/** Run finished without claiming storage acceptance. */
export const A3_RUN_COMPLETED = "A3_RUN_COMPLETED" as const;
/** Measurement structurally valid; not final storage PASS. */
export const A3_MEASUREMENT_VALID = "A3_MEASUREMENT_VALID" as const;
/** Final canonical storage acceptance (requires PHASE-02 package_fixed). */
export const A3_STORAGE_ACCEPTANCE_PASS = "A3_STORAGE_ACCEPTANCE_PASS" as const;
export const A3_STORAGE_ACCEPTANCE_FAIL = "A3_STORAGE_ACCEPTANCE_FAIL" as const;

export type A3StorageVerdictV1 =
  | typeof A3_RUN_COMPLETED
  | typeof A3_MEASUREMENT_VALID
  | typeof A3_STORAGE_ACCEPTANCE_PASS
  | typeof A3_STORAGE_ACCEPTANCE_FAIL;

export const A3_PHASE01_MEASUREMENT_COMPLETE = "PHASE01_MEASUREMENT_COMPLETE" as const;
export const A3_AWAITING_PHASE02_FIXED_CONTRIBUTION =
  "AWAITING_PHASE02_FIXED_CONTRIBUTION" as const;

/** Integer-exact: variable_bytes <= 4096 * N (no float authority). */
export function assertVariableBytesWithinBundleCeiling(input: {
  variableBytes: bigint | number | string;
  nBundles: bigint | number | string;
  maxBytesPerBundle?: number;
}): { ok: boolean; failureReasons: string[] } {
  const variableBytes = BigInt(input.variableBytes);
  const nBundles = BigInt(input.nBundles);
  const max = BigInt(input.maxBytesPerBundle ?? FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE);
  const failureReasons: string[] = [];
  if (nBundles <= 0n) {
    failureReasons.push("nBundles must be > 0");
  }
  if (variableBytes < 0n) {
    failureReasons.push("variableBytes must be >= 0");
  }
  if (failureReasons.length === 0 && variableBytes > max * nBundles) {
    failureReasons.push(
      `variable_bytes ${variableBytes.toString()} exceeds ${max.toString()}*N=${(max * nBundles).toString()}`,
    );
  }
  return { ok: failureReasons.length === 0, failureReasons };
}

export function evaluatePhase01MeasurementValidity(input: {
  nBundles: number;
  rowCounts: Record<string, number>;
  observedPackageContractConforms: boolean;
  phase01PackageFixedBytes: number;
  perSampleTableExists: boolean;
  environment: A3PostgresMeasurementEnvironmentV1;
}): {
  runCompleted: true;
  measurementValid: boolean;
  storageAcceptance:
    | typeof A3_AWAITING_PHASE02_FIXED_CONTRIBUTION
    | typeof A3_STORAGE_ACCEPTANCE_FAIL;
  phase01Status: typeof A3_PHASE01_MEASUREMENT_COMPLETE | typeof A3_STORAGE_ACCEPTANCE_FAIL;
  /** Legacy boolean — MUST NOT mean final STORAGE_ACCEPTANCE_PASS. */
  measurementStructurallyValid: boolean;
  finalStorageAcceptancePass: false;
  failureReasons: string[];
} {
  const failureReasons: string[] = [];
  const expected = {
    trader_forecast_bundle_v2: input.nBundles,
    trader_forecast_v2: input.nBundles * 2,
    trader_forecast_outcome_v2: input.nBundles * 2,
    trader_forecast_calibration_observation_v2: input.nBundles * 2,
    trader_forecast_scenario_v2: input.nBundles * 7,
  };
  for (const [table, count] of Object.entries(expected)) {
    if (input.rowCounts[table] !== count) {
      failureReasons.push(
        `cardinality ${table}=${input.rowCounts[table] ?? "missing"} expected ${count}`,
      );
    }
  }
  const scenariosPerBundle =
    input.nBundles > 0
      ? (input.rowCounts.trader_forecast_scenario_v2 ?? 0) / input.nBundles
      : Number.NaN;
  if (scenariosPerBundle !== 7) {
    failureReasons.push(`scenario rows/bundle=${scenariosPerBundle} expected 7`);
  }
  const proportionalRows =
    input.nBundles > 0
      ? ((input.rowCounts.trader_forecast_bundle_v2 ?? 0) +
          (input.rowCounts.trader_forecast_v2 ?? 0) +
          (input.rowCounts.trader_forecast_outcome_v2 ?? 0) +
          (input.rowCounts.trader_forecast_calibration_observation_v2 ?? 0) +
          (input.rowCounts.trader_forecast_scenario_v2 ?? 0)) /
        input.nBundles
      : Number.NaN;
  if (proportionalRows !== FORECAST_V2_PROPORTIONAL_ROWS_PER_BUNDLE) {
    failureReasons.push(
      `proportional rows/bundle=${proportionalRows} expected ${FORECAST_V2_PROPORTIONAL_ROWS_PER_BUNDLE}`,
    );
  }
  if (!input.observedPackageContractConforms) {
    failureReasons.push("observed package contract non-conformance");
  }
  if (input.phase01PackageFixedBytes <= 0) {
    failureReasons.push("phase01 package fixed bytes missing");
  }
  if (input.perSampleTableExists) {
    failureReasons.push("per-sample relational table exists");
  }
  failureReasons.push(...assertRequiredPostgresEnvironment(input.environment).failureReasons);

  const measurementValid = failureReasons.length === 0;
  return {
    runCompleted: true,
    measurementValid,
    storageAcceptance: A3_AWAITING_PHASE02_FIXED_CONTRIBUTION,
    phase01Status: measurementValid ? A3_PHASE01_MEASUREMENT_COMPLETE : A3_STORAGE_ACCEPTANCE_FAIL,
    measurementStructurallyValid: measurementValid,
    finalStorageAcceptancePass: false,
    failureReasons,
  };
}

export function assertRequiredPostgresEnvironment(
  environment: A3PostgresMeasurementEnvironmentV1,
): { ok: boolean; failureReasons: string[] } {
  const failureReasons: string[] = [];
  const required: Array<keyof A3PostgresMeasurementEnvironmentV1> = [
    "serverVersion",
    "serverVersionNum",
    "blockSize",
    "dataChecksums",
    "serverEncoding",
    "defaultTableAccessMethod",
    "validationComposeDigestHex",
    "dockerImageReference",
    "dockerImageId",
  ];
  for (const key of required) {
    const value = environment[key];
    if (typeof value !== "string" || value.length === 0 || value === "unknown") {
      failureReasons.push(`required postgres environment field unavailable: ${key}`);
    }
  }
  return { ok: failureReasons.length === 0, failureReasons };
}

/**
 * Final storage acceptance — requires authoritative PHASE-02 package_fixed_contribution.
 * PHASE-01 same-phase absolute package size MUST NOT be used here.
 */
export function evaluateFinalStorageAcceptance(input: {
  b0Bytes: number | bigint;
  b1Bytes: number | bigint;
  phase02PackageFixedContributionBytes: number | bigint;
  nBundles: number | bigint;
  phase01MeasurementValid: boolean;
  perSampleTableExists: boolean;
  environment: A3PostgresMeasurementEnvironmentV1;
}): {
  verdict: typeof A3_STORAGE_ACCEPTANCE_PASS | typeof A3_STORAGE_ACCEPTANCE_FAIL;
  finalStorageAcceptancePass: boolean;
  variableBytes: string;
  failureReasons: string[];
} {
  const failureReasons: string[] = [];
  if (!input.phase01MeasurementValid) {
    failureReasons.push("phase-01 measurement not structurally valid");
  }
  if (input.perSampleTableExists) {
    failureReasons.push("per-sample relational table exists");
  }
  failureReasons.push(...assertRequiredPostgresEnvironment(input.environment).failureReasons);

  const variableBytes =
    BigInt(input.b1Bytes) -
    BigInt(input.b0Bytes) -
    BigInt(input.phase02PackageFixedContributionBytes);
  const threshold = assertVariableBytesWithinBundleCeiling({
    variableBytes,
    nBundles: input.nBundles,
  });
  failureReasons.push(...threshold.failureReasons);

  const pass = failureReasons.length === 0;
  return {
    verdict: pass ? A3_STORAGE_ACCEPTANCE_PASS : A3_STORAGE_ACCEPTANCE_FAIL,
    finalStorageAcceptancePass: pass,
    variableBytes: variableBytes.toString(),
    failureReasons,
  };
}
