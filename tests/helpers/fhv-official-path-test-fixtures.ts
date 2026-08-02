import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { execFileSync } from "node:child_process";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import {
  FHV_OFFICIAL_PARTITION_NAMES,
  FHV_OFFICIAL_SYMBOLS,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import { assertFhvDatasetSealed } from "@/lib/trader/market-data/fhv-dataset-seal";
import { resolveFhvDatasetManifestV2Path } from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import { FHV_GAP_POLICY_V1 } from "@/lib/trader/market-data/dataset/fhv-gap-policy";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { writeFhvConfigurationFreezeArtifactAtomic } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import {
  disableFhvCheckoutIdentityTestBypass,
  enableFhvCheckoutIdentityTestBypass,
} from "@/lib/trader/observability/fhv-checkout-identity-test-hook";
import { writeFhvControlReplayReceiptAtomic } from "@/lib/trader/observability/fhv-control-replay-receipt";
import {
  buildFhvDatasetQualificationReceipt,
  FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME,
  FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT,
  writeFhvDatasetQualificationReceiptAtomic,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import {
  FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_FILENAME,
  writeFhvFullHistoricalAuthorizationReceiptAtomic,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
  FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
} from "@/lib/trader/observability/fhv-execution-purpose";
import { FHV_T4_CHECKOUT_IDENTITY_FILENAME } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

export const FHV_TEST_RELEASE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const FHV_TEST_RELEASE_TAG = "fhv-test-release";
export const FHV_TEST_ORG_ID = "00000000-0000-4000-8000-000000000436";
export const FHV_TEST_OPERATOR_ID = "fhv-test-operator";
export const FHV_TEST_STRATEGY_VERSION = `${MEAN_REVERSION_V0}@0.1.0`;
export const FHV_TEST_STRATEGY_DIGEST = computeSemanticSha256Hex({
  strategyVersion: FHV_TEST_STRATEGY_VERSION,
});

export type FhvBoundedLaunchArtifacts = Readonly<{
  artifactRoot: string;
  qualificationReceiptPath: string;
  configurationFreezePath: string;
  authorizationReceiptPath: string;
  authorizationReceiptDigest: string;
  checkoutIdentityProofPath: string;
}>;

export function writeFhvTestCheckoutIdentityProof(input: {
  proofDir: string;
  releaseSha?: string;
  releaseTag?: string;
  runId: string;
  organizationId?: string;
}): string {
  mkdirSync(input.proofDir, { recursive: true });
  const proofPath = join(input.proofDir, FHV_T4_CHECKOUT_IDENTITY_FILENAME);
  const withoutDigest = {
    schemaVersion: "fhv-t4-checkout-identity/v1" as const,
    repoPath: process.cwd(),
    releaseSha: (input.releaseSha ?? FHV_TEST_RELEASE_SHA).toLowerCase(),
    releaseTag: input.releaseTag ?? FHV_TEST_RELEASE_TAG,
    headSha: (input.releaseSha ?? FHV_TEST_RELEASE_SHA).toLowerCase(),
    tagPeelSha: (input.releaseSha ?? FHV_TEST_RELEASE_SHA).toLowerCase(),
    trackedTreeClean: true as const,
    stagedChanges: false as const,
    mergeInProgress: false as const,
    runId: input.runId,
    organizationId: input.organizationId ?? FHV_TEST_ORG_ID,
    capturedAtUtc: "2026-01-01T00:00:00.000Z",
  };
  const proof = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  return proofPath;
}

export function setupFhvBoundedLaunchArtifacts(input: {
  artifactRoot: string;
  runId: string;
  releaseSha?: string;
  organizationId?: string;
  operatorId?: string;
  prepSuffix?: string;
  executionPurpose?:
    | typeof FHV_EXECUTION_PURPOSE_CONTROL_REPLAY
    | typeof FHV_EXECUTION_PURPOSE_FULL_HISTORICAL;
}): FhvBoundedLaunchArtifacts {
  enableFhvCheckoutIdentityTestBypass();
  const prepDir = join(input.artifactRoot, "prep", input.prepSuffix ?? input.runId);
  mkdirSync(prepDir, { recursive: true });

  const releaseSha = input.releaseSha ?? FHV_TEST_RELEASE_SHA;
  const organizationId = input.organizationId ?? FHV_TEST_ORG_ID;
  const operatorId = input.operatorId ?? FHV_TEST_OPERATOR_ID;

  const qualificationReceipt = writeFhvDatasetQualificationReceiptAtomic({
    receiptDir: prepDir,
    datasetRoot: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    manifestPath: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    boundedFixture: true,
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId,
    operatorId,
  });
  const qualificationReceiptPath = join(prepDir, FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME);

  const freezeDir = join(prepDir, "freeze");
  const { artifactPath: configurationFreezePath, artifact: freezeArtifact } =
    writeFhvConfigurationFreezeArtifactAtomic({
      artifactDir: freezeDir,
      releaseSha,
      releaseTag: FHV_TEST_RELEASE_TAG,
      runId: input.runId,
      organizationId,
      operatorId,
      datasetDigest: qualificationReceipt.datasetContentDigest,
      manifestDigest: qualificationReceipt.manifestSemanticDigest,
      strategyVersions: [FHV_TEST_STRATEGY_VERSION],
      strategyDigests: [FHV_TEST_STRATEGY_DIGEST],
      checkpointDigest: "fhv-test-checkpoint",
      datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
    });

  const authDir = join(prepDir, "auth");
  const executionPurpose = input.executionPurpose ?? FHV_EXECUTION_PURPOSE_FULL_HISTORICAL;
  const { receiptPath: authorizationReceiptPath, receipt: authReceipt } =
    writeFhvFullHistoricalAuthorizationReceiptAtomic({
      receiptDir: authDir,
      releaseSha,
      releaseTag: FHV_TEST_RELEASE_TAG,
      datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
      datasetDigest: freezeArtifact.configurationFreeze.datasetDigest,
      manifestDigest: freezeArtifact.configurationFreeze.manifestDigest,
      configurationFreezeDigest: freezeArtifact.configurationFreeze.configurationFreezeDigest,
      organizationId,
      operatorId,
      runId: input.runId,
      executionPurpose,
      ...(executionPurpose === FHV_EXECUTION_PURPOSE_FULL_HISTORICAL
        ? {
            controlReplayReceiptDigest:
              "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          }
        : {}),
    });

  const checkoutIdentityProofPath = writeFhvTestCheckoutIdentityProof({
    proofDir: join(prepDir, "checkout"),
    releaseSha,
    runId: input.runId,
    organizationId,
  });

  return {
    artifactRoot: input.artifactRoot,
    qualificationReceiptPath,
    configurationFreezePath,
    authorizationReceiptPath,
    authorizationReceiptDigest: authReceipt.authorizationReceiptDigest,
    checkoutIdentityProofPath,
  };
}

export function setupFhvControlReplayArtifacts(input: {
  artifactRoot: string;
  releaseSha: string;
  organizationId?: string;
  operatorId?: string;
}): {
  qualificationReceiptPath: string;
  configurationFreezePathRunOne: string;
  configurationFreezePathRunTwo: string;
  authorizationReceiptPathRunOne: string;
  authorizationReceiptPathRunTwo: string;
  checkoutIdentityProofPathRunOne: string;
  checkoutIdentityProofPathRunTwo: string;
} {
  enableFhvCheckoutIdentityTestBypass();
  const runOneId = `fhv-control-replay-1-${input.releaseSha.slice(0, 8)}`;
  const runTwoId = `fhv-control-replay-2-${input.releaseSha.slice(0, 8)}`;
  const prepDir = join(input.artifactRoot, "prep");
  mkdirSync(prepDir, { recursive: true });

  const organizationId = input.organizationId ?? FHV_TEST_ORG_ID;
  const operatorId = input.operatorId ?? FHV_TEST_OPERATOR_ID;

  const qualificationReceipt = writeFhvDatasetQualificationReceiptAtomic({
    receiptDir: prepDir,
    datasetRoot: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    manifestPath: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    boundedFixture: true,
    releaseSha: input.releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId,
    operatorId,
  });
  const qualificationReceiptPath = join(prepDir, FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME);

  const freezeOne = writeFhvConfigurationFreezeArtifactAtomic({
    artifactDir: join(prepDir, "freeze-one"),
    releaseSha: input.releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    runId: runOneId,
    organizationId,
    operatorId,
    datasetDigest: qualificationReceipt.datasetContentDigest,
    manifestDigest: qualificationReceipt.manifestSemanticDigest,
    strategyVersions: [FHV_TEST_STRATEGY_VERSION],
    strategyDigests: [FHV_TEST_STRATEGY_DIGEST],
    checkpointDigest: "fhv-control-replay-checkpoint",
    datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
  });
  const freezeTwo = writeFhvConfigurationFreezeArtifactAtomic({
    artifactDir: join(prepDir, "freeze-two"),
    releaseSha: input.releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    runId: runTwoId,
    organizationId,
    operatorId,
    datasetDigest: qualificationReceipt.datasetContentDigest,
    manifestDigest: qualificationReceipt.manifestSemanticDigest,
    strategyVersions: [FHV_TEST_STRATEGY_VERSION],
    strategyDigests: [FHV_TEST_STRATEGY_DIGEST],
    checkpointDigest: "fhv-control-replay-checkpoint",
    datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
  });
  const authOne = writeFhvFullHistoricalAuthorizationReceiptAtomic({
    receiptDir: join(prepDir, "auth-one"),
    releaseSha: input.releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
    datasetDigest: qualificationReceipt.datasetContentDigest,
    manifestDigest: qualificationReceipt.manifestSemanticDigest,
    configurationFreezeDigest: freezeOne.artifact.configurationFreeze.configurationFreezeDigest,
    organizationId,
    operatorId,
    runId: runOneId,
    executionPurpose: FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
  });
  const authTwo = writeFhvFullHistoricalAuthorizationReceiptAtomic({
    receiptDir: join(prepDir, "auth-two"),
    releaseSha: input.releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
    datasetDigest: qualificationReceipt.datasetContentDigest,
    manifestDigest: qualificationReceipt.manifestSemanticDigest,
    configurationFreezeDigest: freezeTwo.artifact.configurationFreeze.configurationFreezeDigest,
    organizationId,
    operatorId,
    runId: runTwoId,
    executionPurpose: FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
  });

  const checkoutIdentityProofPathRunOne = writeFhvTestCheckoutIdentityProof({
    proofDir: join(prepDir, "checkout-one"),
    releaseSha: input.releaseSha,
    runId: runOneId,
    organizationId,
  });
  const checkoutIdentityProofPathRunTwo = writeFhvTestCheckoutIdentityProof({
    proofDir: join(prepDir, "checkout-two"),
    releaseSha: input.releaseSha,
    runId: runTwoId,
    organizationId,
  });

  return {
    qualificationReceiptPath,
    configurationFreezePathRunOne: freezeOne.artifactPath,
    configurationFreezePathRunTwo: freezeTwo.artifactPath,
    authorizationReceiptPathRunOne: authOne.receiptPath,
    authorizationReceiptPathRunTwo: authTwo.receiptPath,
    checkoutIdentityProofPathRunOne,
    checkoutIdentityProofPathRunTwo,
  };
}

export const FHV_OFFICIAL_REAL_SCHEMA_ROOT = FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT;
export const FHV_OFFICIAL_REAL_SCHEMA_MANIFEST = join(
  FHV_OFFICIAL_REAL_SCHEMA_ROOT,
  "fhv-dataset-manifest.json",
);

export function setupFhvOfficialSchemaLaunchArtifacts(input: {
  artifactRoot: string;
  runId: string;
  releaseSha?: string;
  organizationId?: string;
  operatorId?: string;
  datasetRoot?: string;
  manifestPath?: string;
}): {
  qualificationReceiptPath: string;
  configurationFreezePath: string;
  authorizationReceiptPath: string;
  authorizationReceiptDigest: string;
  checkoutIdentityProofPath: string;
  controlReplayReceiptPath: string;
  controlReplayReceiptDigest: string;
} {
  enableFhvCheckoutIdentityTestBypass();
  const prepDir = join(input.artifactRoot, "prep", input.runId);
  const releaseSha = input.releaseSha ?? FHV_TEST_RELEASE_SHA;
  const organizationId = input.organizationId ?? FHV_TEST_ORG_ID;
  const operatorId = input.operatorId ?? FHV_TEST_OPERATOR_ID;
  const datasetRoot = input.datasetRoot ?? FHV_OFFICIAL_REAL_SCHEMA_ROOT;
  const manifestPath = input.manifestPath ?? FHV_OFFICIAL_REAL_SCHEMA_MANIFEST;

  const qualificationReceipt = writeFhvDatasetQualificationReceiptAtomic({
    receiptDir: prepDir,
    datasetRoot,
    manifestPath,
    qualificationMode: "SCHEMA_INTEGRATION_FIXTURE",
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId,
    operatorId,
  });
  const qualificationReceiptPath = join(prepDir, FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME);

  const freeze = writeFhvConfigurationFreezeArtifactAtomic({
    artifactDir: join(prepDir, "freeze"),
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    runId: input.runId,
    organizationId,
    operatorId,
    datasetDigest: qualificationReceipt.datasetContentDigest,
    manifestDigest: qualificationReceipt.manifestSemanticDigest,
    strategyVersions: [FHV_TEST_STRATEGY_VERSION],
    strategyDigests: [FHV_TEST_STRATEGY_DIGEST],
    checkpointDigest: "fhv-official-test-checkpoint",
    datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
  });

  const controlReplayReceiptPath = join(prepDir, "fhv-control-replay-receipt.v1.json");
  const runOneId = `fhv-control-replay-1-${releaseSha.slice(0, 8)}`;
  const runTwoId = `fhv-control-replay-2-${releaseSha.slice(0, 8)}`;
  const controlReplayReceipt = writeFhvControlReplayReceiptAtomic({
    receiptPath: controlReplayReceiptPath,
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId,
    operatorId,
    runOneId,
    runTwoId,
    runOneDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    runTwoDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
    datasetContentDigest: qualificationReceipt.datasetContentDigest,
    manifestSemanticDigest: qualificationReceipt.manifestSemanticDigest,
    runOneConfigurationFreezeDigest: freeze.artifact.configurationFreeze.configurationFreezeDigest,
    runTwoConfigurationFreezeDigest: freeze.artifact.configurationFreeze.configurationFreezeDigest,
    runOneAuthorizationReceiptDigest:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    runTwoAuthorizationReceiptDigest:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    runOneCheckoutIdentityProofDigest:
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    runTwoCheckoutIdentityProofDigest:
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    runOneCycleCount: 10,
    runTwoCycleCount: 10,
    capturedAtUtc: "2026-01-01T00:00:00.000Z",
  });

  const auth = writeFhvFullHistoricalAuthorizationReceiptAtomic({
    receiptDir: join(prepDir, "auth"),
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
    datasetDigest: qualificationReceipt.datasetContentDigest,
    manifestDigest: qualificationReceipt.manifestSemanticDigest,
    configurationFreezeDigest: freeze.artifact.configurationFreeze.configurationFreezeDigest,
    controlReplayReceiptDigest: controlReplayReceipt.controlReplayReceiptDigest,
    organizationId,
    operatorId,
    runId: input.runId,
    executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
  });

  const checkoutIdentityProofPath = writeFhvTestCheckoutIdentityProof({
    proofDir: join(prepDir, "checkout"),
    releaseSha,
    runId: input.runId,
    organizationId,
  });

  return {
    qualificationReceiptPath,
    configurationFreezePath: freeze.artifactPath,
    authorizationReceiptPath: auth.receiptPath,
    authorizationReceiptDigest: auth.receipt.authorizationReceiptDigest,
    checkoutIdentityProofPath,
    controlReplayReceiptPath,
    controlReplayReceiptDigest: controlReplayReceipt.controlReplayReceiptDigest,
  };
}

export const FHV_OFFICIAL_V2_SCALE_RELEASE_SHA = "528a5a5529f42eb9998f783a5827e23ea3a7f557";
export const FHV_OFFICIAL_V2_SCALE_ACQUISITION_RUN_ID = "fhv-test-scale-acq-001";
export const FHV_OFFICIAL_V2_SCALE_SEAL_RUN_ID = "fhv-test-scale-seal-001";

export function buildFhvOfficialV2ScaleDataset(datasetRoot: string): {
  datasetRoot: string;
  manifestPath: string;
} {
  for (const partition of FHV_OFFICIAL_PARTITION_NAMES) {
    for (const symbol of FHV_OFFICIAL_SYMBOLS) {
      execFileSync(
        "pnpm",
        [
          "trader:fhv:acquire-htx-v2",
          "--",
          "--partition",
          partition,
          "--symbol",
          symbol,
          "--dataset-root",
          datasetRoot,
          "--scale-corpus",
          "--release-sha",
          FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
          "--organization-id",
          FHV_TEST_ORG_ID,
          "--operator-id",
          FHV_TEST_OPERATOR_ID,
          "--acquisition-run-id",
          FHV_OFFICIAL_V2_SCALE_ACQUISITION_RUN_ID,
        ],
        { stdio: "pipe", cwd: process.cwd() },
      );
    }
  }
  execFileSync(
    "pnpm",
    [
      "trader:fhv:seal-v2-dataset",
      "--",
      "--dataset-root",
      datasetRoot,
      "--acquisition-receipt-dir",
      join(datasetRoot, "control", "acquisition"),
      "--seal-run-id",
      FHV_OFFICIAL_V2_SCALE_SEAL_RUN_ID,
      "--release-sha",
      FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
      "--organization-id",
      FHV_TEST_ORG_ID,
      "--operator-id",
      FHV_TEST_OPERATOR_ID,
    ],
    { stdio: "pipe", cwd: process.cwd() },
  );
  return {
    datasetRoot,
    manifestPath: resolveFhvDatasetManifestV2Path(datasetRoot),
  };
}

export function writeFhvOfficialV2MultiYearQualificationReceipt(input: {
  receiptDir: string;
  datasetRoot: string;
  releaseSha?: string;
  releaseTag?: string;
  organizationId?: string;
  operatorId?: string;
}): {
  qualificationReceiptPath: string;
  qualificationReceiptDigest: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
} {
  mkdirSync(input.receiptDir, { recursive: true });
  const sealed = assertFhvDatasetSealed(input.datasetRoot);
  const manifestPath = resolveFhvDatasetManifestV2Path(input.datasetRoot);
  const body = {
    schemaVersion: "fhv-dataset-qualification-receipt/v1" as const,
    classification: "DATASET_QUALIFICATION=PASS" as const,
    qualificationMode: "OFFICIAL_MULTI_YEAR" as const,
    datasetRoot: input.datasetRoot,
    manifestPath,
    datasetContentDigest: sealed.manifest.datasetContentDigest,
    manifestSemanticDigest: sealed.manifest.manifestSemanticDigest,
    partitionsDigest: computeStableJsonDigest(FHV_DATASET_PARTITIONS_V1),
    gapPolicyId: FHV_GAP_POLICY_V1.policyId,
    holdoutSealDigest: sealed.manifest.holdoutSealDigest,
    symbolDigests: sealed.manifest.symbolDigests,
    partitionEvidence: sealed.manifest.partitions.map((entry) => ({
      partition: entry.partition,
      symbol: entry.symbol,
      filePath: join(input.datasetRoot, entry.filePath),
      fileContentDigest: entry.rawSha256,
      barCount: entry.actualBarCount,
      firstBarOpenTime: entry.firstBarOpen,
      lastBarOpenTime: entry.lastBarClose,
    })),
    ...(input.releaseSha ? { releaseSha: input.releaseSha.trim().toLowerCase() } : {}),
    ...(input.releaseTag ? { releaseTag: input.releaseTag.trim() } : {}),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    ...(input.operatorId ? { operatorId: input.operatorId.trim() } : {}),
    qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
  };
  const receipt = buildFhvDatasetQualificationReceipt(body);
  const qualificationReceiptPath = join(
    input.receiptDir,
    FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME,
  );
  writeFileSync(qualificationReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return {
    qualificationReceiptPath,
    qualificationReceiptDigest: receipt.qualificationReceiptDigest,
    datasetContentDigest: receipt.datasetContentDigest,
    manifestSemanticDigest: receipt.manifestSemanticDigest,
  };
}

export function setupFhvOfficialV2MultiYearLaunchArtifacts(input: {
  artifactRoot: string;
  runId: string;
  datasetRoot: string;
  manifestPath: string;
  releaseSha?: string;
  organizationId?: string;
  operatorId?: string;
  checkpointEveryCycles?: number;
}): {
  qualificationReceiptPath: string;
  configurationFreezePath: string;
  authorizationReceiptPath: string;
  authorizationReceiptDigest: string;
  checkoutIdentityProofPath: string;
  controlReplayReceiptPath: string;
  controlReplayReceiptDigest: string;
} {
  enableFhvCheckoutIdentityTestBypass();
  const prepDir = join(input.artifactRoot, "prep", input.runId);
  const releaseSha = input.releaseSha ?? FHV_OFFICIAL_V2_SCALE_RELEASE_SHA;
  const organizationId = input.organizationId ?? FHV_TEST_ORG_ID;
  const operatorId = input.operatorId ?? FHV_TEST_OPERATOR_ID;

  const qualification = writeFhvOfficialV2MultiYearQualificationReceipt({
    receiptDir: prepDir,
    datasetRoot: input.datasetRoot,
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId,
    operatorId,
  });

  const freeze = writeFhvConfigurationFreezeArtifactAtomic({
    artifactDir: join(prepDir, "freeze"),
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    runId: input.runId,
    organizationId,
    operatorId,
    datasetDigest: qualification.datasetContentDigest,
    manifestDigest: qualification.manifestSemanticDigest,
    strategyVersions: [FHV_TEST_STRATEGY_VERSION],
    strategyDigests: [FHV_TEST_STRATEGY_DIGEST],
    checkpointDigest: "fhv-official-v2-test-checkpoint",
    datasetQualificationReceiptDigest: qualification.qualificationReceiptDigest,
    ...(input.checkpointEveryCycles != null
      ? { checkpointEveryCycles: input.checkpointEveryCycles }
      : {}),
  });

  const controlReplayReceiptPath = join(prepDir, "fhv-control-replay-receipt.v1.json");
  const controlReplayReceipt = writeFhvControlReplayReceiptAtomic({
    receiptPath: controlReplayReceiptPath,
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId,
    operatorId,
    runOneId: `fhv-control-replay-1-${releaseSha.slice(0, 8)}`,
    runTwoId: `fhv-control-replay-2-${releaseSha.slice(0, 8)}`,
    runOneDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    runTwoDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    datasetQualificationReceiptDigest: qualification.qualificationReceiptDigest,
    datasetContentDigest: qualification.datasetContentDigest,
    manifestSemanticDigest: qualification.manifestSemanticDigest,
    runOneConfigurationFreezeDigest: freeze.artifact.configurationFreeze.configurationFreezeDigest,
    runTwoConfigurationFreezeDigest: freeze.artifact.configurationFreeze.configurationFreezeDigest,
    runOneAuthorizationReceiptDigest:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    runTwoAuthorizationReceiptDigest:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    runOneCheckoutIdentityProofDigest:
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    runTwoCheckoutIdentityProofDigest:
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    runOneCycleCount: 10,
    runTwoCycleCount: 10,
    capturedAtUtc: "2026-01-01T00:00:00.000Z",
  });

  const auth = writeFhvFullHistoricalAuthorizationReceiptAtomic({
    receiptDir: join(prepDir, "auth"),
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    datasetQualificationReceiptDigest: qualification.qualificationReceiptDigest,
    datasetDigest: qualification.datasetContentDigest,
    manifestDigest: qualification.manifestSemanticDigest,
    configurationFreezeDigest: freeze.artifact.configurationFreeze.configurationFreezeDigest,
    controlReplayReceiptDigest: controlReplayReceipt.controlReplayReceiptDigest,
    organizationId,
    operatorId,
    runId: input.runId,
    executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
  });

  const checkoutIdentityProofPath = writeFhvTestCheckoutIdentityProof({
    proofDir: join(prepDir, "checkout"),
    releaseSha,
    runId: input.runId,
    organizationId,
  });

  return {
    qualificationReceiptPath: qualification.qualificationReceiptPath,
    configurationFreezePath: freeze.artifactPath,
    authorizationReceiptPath: auth.receiptPath,
    authorizationReceiptDigest: auth.receipt.authorizationReceiptDigest,
    checkoutIdentityProofPath,
    controlReplayReceiptPath,
    controlReplayReceiptDigest: controlReplayReceipt.controlReplayReceiptDigest,
  };
}

export function setupFhvOfficialV2ControlReplayArtifacts(input: {
  artifactRoot: string;
  datasetRoot: string;
  releaseSha?: string;
  organizationId?: string;
  operatorId?: string;
}): {
  qualificationReceiptPath: string;
  configurationFreezePathRunOne: string;
  authorizationReceiptPathRunOne: string;
  checkoutIdentityProofPathRunOne: string;
  qualificationReceiptDigest: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
} {
  enableFhvCheckoutIdentityTestBypass();
  const releaseSha = input.releaseSha ?? FHV_OFFICIAL_V2_SCALE_RELEASE_SHA;
  const organizationId = input.organizationId ?? FHV_TEST_ORG_ID;
  const operatorId = input.operatorId ?? FHV_TEST_OPERATOR_ID;
  const runOneId = `fhv-v2-control-replay-1-${releaseSha.slice(0, 8)}`;
  const prepDir = join(input.artifactRoot, "prep");

  const qualification = writeFhvOfficialV2MultiYearQualificationReceipt({
    receiptDir: prepDir,
    datasetRoot: input.datasetRoot,
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId,
    operatorId,
  });

  const freezeOne = writeFhvConfigurationFreezeArtifactAtomic({
    artifactDir: join(prepDir, "freeze-one"),
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    runId: runOneId,
    organizationId,
    operatorId,
    datasetDigest: qualification.datasetContentDigest,
    manifestDigest: qualification.manifestSemanticDigest,
    strategyVersions: [FHV_TEST_STRATEGY_VERSION],
    strategyDigests: [FHV_TEST_STRATEGY_DIGEST],
    checkpointDigest: "fhv-v2-control-replay-checkpoint",
    datasetQualificationReceiptDigest: qualification.qualificationReceiptDigest,
  });

  const authOne = writeFhvFullHistoricalAuthorizationReceiptAtomic({
    receiptDir: join(prepDir, "auth-one"),
    releaseSha,
    releaseTag: FHV_TEST_RELEASE_TAG,
    datasetQualificationReceiptDigest: qualification.qualificationReceiptDigest,
    datasetDigest: qualification.datasetContentDigest,
    manifestDigest: qualification.manifestSemanticDigest,
    configurationFreezeDigest: freezeOne.artifact.configurationFreeze.configurationFreezeDigest,
    organizationId,
    operatorId,
    runId: runOneId,
    executionPurpose: FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
  });

  const checkoutIdentityProofPathRunOne = writeFhvTestCheckoutIdentityProof({
    proofDir: join(prepDir, "checkout-one"),
    releaseSha,
    runId: runOneId,
    organizationId,
  });

  return {
    qualificationReceiptPath: qualification.qualificationReceiptPath,
    configurationFreezePathRunOne: freezeOne.artifactPath,
    authorizationReceiptPathRunOne: authOne.receiptPath,
    checkoutIdentityProofPathRunOne,
    qualificationReceiptDigest: qualification.qualificationReceiptDigest,
    datasetContentDigest: qualification.datasetContentDigest,
    manifestSemanticDigest: qualification.manifestSemanticDigest,
  };
}
