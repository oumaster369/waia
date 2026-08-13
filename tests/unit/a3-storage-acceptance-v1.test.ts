import { describe, expect, it } from "vitest";

import {
  A3_AWAITING_PHASE02_FIXED_CONTRIBUTION,
  A3_STORAGE_ACCEPTANCE_FAIL,
  A3_STORAGE_ACCEPTANCE_PASS,
  assertVariableBytesWithinBundleCeiling,
  evaluateFinalStorageAcceptance,
  evaluatePhase01MeasurementValidity,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-acceptance-v1";
import type { A3PostgresMeasurementEnvironmentV1 } from "@/lib/trader/intelligence/forecast-v2/a3-postgres-measurement-environment-v1";
import { FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE } from "@/lib/trader/intelligence/forecast-v2/storage-scale-projection";

const N = 200_000n;
const CEILING = BigInt(FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE) * N;

function validEnvironment(): A3PostgresMeasurementEnvironmentV1 {
  return {
    schemaVersion: "a3-postgres-measurement-environment/v1",
    serverVersion: "16.14",
    serverVersionNum: "160014",
    blockSize: "8192",
    dataChecksums: "on",
    serverEncoding: "UTF8",
    databaseCollate: "C",
    databaseCtype: "C",
    defaultTableAccessMethod: "heap",
    validationComposeDigestHex: "a".repeat(64),
    dockerImageReference: "postgres:16-alpine",
    dockerImageId: "sha256:deadbeef",
    relationStorageOptions: [],
    operationalSettings: { synchronousCommit: "on", workMem: "4MB" },
    postgresMeasurementEnvironmentDigest: "b".repeat(64),
  };
}

describe("A3 storage acceptance exact BigInt gates", () => {
  it("variable_bytes = 4096*N => threshold PASS", () => {
    expect(assertVariableBytesWithinBundleCeiling({ variableBytes: CEILING, nBundles: N }).ok).toBe(
      true,
    );
  });

  it("variable_bytes = 4096*N + 1 => FAIL", () => {
    expect(
      assertVariableBytesWithinBundleCeiling({ variableBytes: CEILING + 1n, nBundles: N }).ok,
    ).toBe(false);
  });

  it("variable_bytes = 4096*N - 1 => PASS", () => {
    expect(
      assertVariableBytesWithinBundleCeiling({ variableBytes: CEILING - 1n, nBundles: N }).ok,
    ).toBe(true);
  });

  it("wrong cardinality => FAIL", () => {
    const result = evaluatePhase01MeasurementValidity({
      nBundles: 10,
      rowCounts: {
        trader_forecast_bundle_v2: 10,
        trader_forecast_v2: 20,
        trader_forecast_outcome_v2: 19,
        trader_forecast_calibration_observation_v2: 20,
        trader_forecast_scenario_v2: 70,
      },
      observedPackageContractConforms: true,
      phase01PackageFixedBytes: 1,
      perSampleTableExists: false,
      environment: validEnvironment(),
    });
    expect(result.measurementValid).toBe(false);
    expect(result.finalStorageAcceptancePass).toBe(false);
    expect(result.storageAcceptance).toBe(A3_AWAITING_PHASE02_FIXED_CONTRIBUTION);
  });

  it("scenario count != 7/bundle => FAIL", () => {
    const result = evaluatePhase01MeasurementValidity({
      nBundles: 10,
      rowCounts: {
        trader_forecast_bundle_v2: 10,
        trader_forecast_v2: 20,
        trader_forecast_outcome_v2: 20,
        trader_forecast_calibration_observation_v2: 20,
        trader_forecast_scenario_v2: 60,
      },
      observedPackageContractConforms: true,
      phase01PackageFixedBytes: 1,
      perSampleTableExists: false,
      environment: validEnvironment(),
    });
    expect(result.measurementValid).toBe(false);
    expect(result.failureReasons.some((r) => r.includes("scenario"))).toBe(true);
  });

  it("per-sample table exists => FAIL", () => {
    const result = evaluatePhase01MeasurementValidity({
      nBundles: 1,
      rowCounts: {
        trader_forecast_bundle_v2: 1,
        trader_forecast_v2: 2,
        trader_forecast_outcome_v2: 2,
        trader_forecast_calibration_observation_v2: 2,
        trader_forecast_scenario_v2: 7,
      },
      observedPackageContractConforms: true,
      phase01PackageFixedBytes: 1,
      perSampleTableExists: true,
      environment: validEnvironment(),
    });
    expect(result.measurementValid).toBe(false);
  });

  it("required environment identity missing => FAIL", () => {
    const env = validEnvironment();
    env.serverVersionNum = "unknown";
    const result = evaluatePhase01MeasurementValidity({
      nBundles: 1,
      rowCounts: {
        trader_forecast_bundle_v2: 1,
        trader_forecast_v2: 2,
        trader_forecast_outcome_v2: 2,
        trader_forecast_calibration_observation_v2: 2,
        trader_forecast_scenario_v2: 7,
      },
      observedPackageContractConforms: true,
      phase01PackageFixedBytes: 1,
      perSampleTableExists: false,
      environment: env,
    });
    expect(result.measurementValid).toBe(false);
    expect(result.failureReasons.some((r) => r.includes("serverVersionNum"))).toBe(true);
  });

  it("PHASE-01 alone cannot emit final STORAGE_ACCEPTANCE_PASS", () => {
    const result = evaluatePhase01MeasurementValidity({
      nBundles: 1,
      rowCounts: {
        trader_forecast_bundle_v2: 1,
        trader_forecast_v2: 2,
        trader_forecast_outcome_v2: 2,
        trader_forecast_calibration_observation_v2: 2,
        trader_forecast_scenario_v2: 7,
      },
      observedPackageContractConforms: true,
      phase01PackageFixedBytes: 1,
      perSampleTableExists: false,
      environment: validEnvironment(),
    });
    expect(result.measurementValid).toBe(true);
    expect(result.finalStorageAcceptancePass).toBe(false);
    expect(result.storageAcceptance).toBe(A3_AWAITING_PHASE02_FIXED_CONTRIBUTION);
  });

  it("final acceptance uses PHASE-02 package_fixed with exact BigInt", () => {
    const pass = evaluateFinalStorageAcceptance({
      b0Bytes: 0,
      b1Bytes: CEILING,
      phase02PackageFixedContributionBytes: 0,
      nBundles: N,
      phase01MeasurementValid: true,
      perSampleTableExists: false,
      environment: validEnvironment(),
    });
    expect(pass.verdict).toBe(A3_STORAGE_ACCEPTANCE_PASS);
    expect(pass.finalStorageAcceptancePass).toBe(true);

    const fail = evaluateFinalStorageAcceptance({
      b0Bytes: 0,
      b1Bytes: CEILING + 1n,
      phase02PackageFixedContributionBytes: 0,
      nBundles: N,
      phase01MeasurementValid: true,
      perSampleTableExists: false,
      environment: validEnvironment(),
    });
    expect(fail.verdict).toBe(A3_STORAGE_ACCEPTANCE_FAIL);
    expect(fail.finalStorageAcceptancePass).toBe(false);
  });
});
