import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { writeFhvConfigurationFreezeArtifactAtomic } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import {
  disableFhvCheckoutIdentityTestBypass,
  enableFhvCheckoutIdentityTestBypass,
} from "@/lib/trader/observability/fhv-checkout-identity-test-hook";
import { writeFhvControlReplayReceiptAtomic } from "@/lib/trader/observability/fhv-control-replay-receipt";
import {
  FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME,
  FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT,
  writeFhvDatasetQualificationReceiptAtomic,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import {
  FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_FILENAME,
  writeFhvFullHistoricalAuthorizationReceiptAtomic,
} from "@/lib/trader/observability/fhv-full-historical-auth";
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
}): FhvBoundedLaunchArtifacts {
  enableFhvCheckoutIdentityTestBypass();
  const prepDir = join(input.artifactRoot, "prep", input.prepSuffix ?? input.runId);
  mkdirSync(prepDir, { recursive: true });

  const qualificationReceipt = writeFhvDatasetQualificationReceiptAtomic({
    receiptDir: prepDir,
    datasetRoot: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    manifestPath: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    boundedFixture: true,
  });
  const qualificationReceiptPath = join(prepDir, FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME);

  const freezeDir = join(prepDir, "freeze");
  const { artifactPath: configurationFreezePath, artifact: freezeArtifact } =
    writeFhvConfigurationFreezeArtifactAtomic({
      artifactDir: freezeDir,
      releaseSha: input.releaseSha ?? FHV_TEST_RELEASE_SHA,
      runId: input.runId,
      organizationId: input.organizationId ?? FHV_TEST_ORG_ID,
      operatorId: input.operatorId ?? FHV_TEST_OPERATOR_ID,
      datasetDigest: qualificationReceipt.datasetContentDigest,
      manifestDigest: qualificationReceipt.manifestSemanticDigest,
      strategyVersions: [FHV_TEST_STRATEGY_VERSION],
      strategyDigests: [FHV_TEST_STRATEGY_DIGEST],
      checkpointDigest: "fhv-test-checkpoint",
      datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
    });

  const authDir = join(prepDir, "auth");
  const { receiptPath: authorizationReceiptPath, receipt: authReceipt } =
    writeFhvFullHistoricalAuthorizationReceiptAtomic({
      receiptDir: authDir,
      releaseSha: input.releaseSha ?? FHV_TEST_RELEASE_SHA,
      releaseTag: FHV_TEST_RELEASE_TAG,
      datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
      datasetDigest: freezeArtifact.configurationFreeze.datasetDigest,
      manifestDigest: freezeArtifact.configurationFreeze.manifestDigest,
      configurationFreezeDigest: freezeArtifact.configurationFreeze.configurationFreezeDigest,
      organizationId: input.organizationId ?? FHV_TEST_ORG_ID,
      operatorId: input.operatorId ?? FHV_TEST_OPERATOR_ID,
      runId: input.runId,
    });

  const checkoutIdentityProofPath = writeFhvTestCheckoutIdentityProof({
    proofDir: join(prepDir, "checkout"),
    releaseSha: input.releaseSha ?? FHV_TEST_RELEASE_SHA,
    runId: input.runId,
    organizationId: input.organizationId ?? FHV_TEST_ORG_ID,
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

  const qualificationReceipt = writeFhvDatasetQualificationReceiptAtomic({
    receiptDir: prepDir,
    datasetRoot: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    manifestPath: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    boundedFixture: true,
  });
  const qualificationReceiptPath = join(prepDir, FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME);
  const organizationId = input.organizationId ?? FHV_TEST_ORG_ID;
  const operatorId = input.operatorId ?? FHV_TEST_OPERATOR_ID;

  const freezeOne = writeFhvConfigurationFreezeArtifactAtomic({
    artifactDir: join(prepDir, "freeze-one"),
    releaseSha: input.releaseSha,
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

  const qualificationReceipt = writeFhvDatasetQualificationReceiptAtomic({
    receiptDir: prepDir,
    datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
    manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
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
  const controlReplayReceipt = writeFhvControlReplayReceiptAtomic({
    receiptPath: controlReplayReceiptPath,
    releaseSha,
    organizationId,
    operatorId,
    runOneId: `fhv-control-replay-1-${releaseSha.slice(0, 8)}`,
    runTwoId: `fhv-control-replay-2-${releaseSha.slice(0, 8)}`,
    runOneDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    runTwoDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
