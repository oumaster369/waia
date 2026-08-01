import { readFhvConfigurationFreezeArtifact } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import {
  readFhvControlReplayReceipt,
  type FhvControlReplayReceiptV1,
} from "@/lib/trader/observability/fhv-control-replay-receipt";
import {
  readFhvDatasetQualificationReceipt,
  type FhvDatasetQualificationReceiptV1,
  type FhvQualificationMode,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import {
  readFhvFullHistoricalAuthorizationReceipt,
  type FhvFullHistoricalAuthorizationReceiptV1,
} from "@/lib/trader/observability/fhv-full-historical-auth";

export type FhvExecutionIdentity = Readonly<{
  releaseSha: string;
  releaseTag: string;
  organizationId: string;
  operatorId: string;
}>;

export class FhvArtifactAuthorityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvArtifactAuthorityError";
  }
}

function normalizeSha(sha: string): string {
  return sha.trim().toLowerCase();
}

function assertIdentityMatch(
  label: string,
  expected: FhvExecutionIdentity,
  actual: Partial<FhvExecutionIdentity>,
): void {
  if (actual.releaseSha && normalizeSha(actual.releaseSha) !== normalizeSha(expected.releaseSha)) {
    throw new FhvArtifactAuthorityError(
      `${label}_RELEASE_SHA_MISMATCH`,
      `${label} releaseSha mismatch.`,
    );
  }
  if (actual.releaseTag && actual.releaseTag.trim() !== expected.releaseTag.trim()) {
    throw new FhvArtifactAuthorityError(
      `${label}_RELEASE_TAG_MISMATCH`,
      `${label} releaseTag mismatch.`,
    );
  }
  if (actual.organizationId && actual.organizationId !== expected.organizationId) {
    throw new FhvArtifactAuthorityError(
      `${label}_ORGANIZATION_ID_MISMATCH`,
      `${label} organizationId mismatch.`,
    );
  }
  if (actual.operatorId && actual.operatorId.trim() !== expected.operatorId.trim()) {
    throw new FhvArtifactAuthorityError(
      `${label}_OPERATOR_ID_MISMATCH`,
      `${label} operatorId mismatch.`,
    );
  }
}

export function assertFhvDatasetQualificationReceiptForExecution(input: {
  receiptPath: string;
  identity: FhvExecutionIdentity;
  requiredMode?: FhvQualificationMode;
}): FhvDatasetQualificationReceiptV1 {
  const receipt = readFhvDatasetQualificationReceipt(input.receiptPath);
  if (receipt.classification !== "DATASET_QUALIFICATION=PASS") {
    throw new FhvArtifactAuthorityError(
      "QUALIFICATION_NOT_PASS",
      "Dataset qualification receipt must classify PASS.",
    );
  }
  assertIdentityMatch("QUALIFICATION", input.identity, receipt);
  if (input.requiredMode && receipt.qualificationMode !== input.requiredMode) {
    throw new FhvArtifactAuthorityError(
      "QUALIFICATION_MODE_MISMATCH",
      `Expected qualificationMode ${input.requiredMode}, got ${receipt.qualificationMode}.`,
    );
  }
  if (!receipt.qualificationReceiptDigest) {
    throw new FhvArtifactAuthorityError(
      "QUALIFICATION_RECEIPT_DIGEST_MISSING",
      "Qualification receipt digest missing.",
    );
  }
  return receipt;
}

export function assertFhvConfigurationFreezeForExecution(input: {
  freezePath: string;
  identity: FhvExecutionIdentity;
  runId: string;
  qualificationReceipt: FhvDatasetQualificationReceiptV1;
}): ReturnType<typeof readFhvConfigurationFreezeArtifact> {
  const artifact = readFhvConfigurationFreezeArtifact(input.freezePath);
  const freeze = artifact.configurationFreeze;
  assertIdentityMatch("FREEZE", input.identity, freeze);
  if (freeze.runId !== input.runId) {
    throw new FhvArtifactAuthorityError("FREEZE_RUN_ID_MISMATCH", "Freeze runId mismatch.");
  }
  if (
    artifact.datasetQualificationReceiptDigest !==
    input.qualificationReceipt.qualificationReceiptDigest
  ) {
    throw new FhvArtifactAuthorityError(
      "FREEZE_QUALIFICATION_RECEIPT_DIGEST_MISMATCH",
      "Freeze must bind qualification receipt digest.",
    );
  }
  if (freeze.datasetDigest !== input.qualificationReceipt.datasetContentDigest) {
    throw new FhvArtifactAuthorityError(
      "FREEZE_DATASET_DIGEST_MISMATCH",
      "Freeze dataset digest must match qualification receipt.",
    );
  }
  if (freeze.manifestDigest !== input.qualificationReceipt.manifestSemanticDigest) {
    throw new FhvArtifactAuthorityError(
      "FREEZE_MANIFEST_DIGEST_MISMATCH",
      "Freeze manifest digest must match qualification receipt.",
    );
  }
  return artifact;
}

export function assertFhvControlReplayReceiptForAuthorization(input: {
  receiptPath: string;
  identity: FhvExecutionIdentity;
  qualificationReceipt: FhvDatasetQualificationReceiptV1;
}): FhvControlReplayReceiptV1 {
  const receipt = readFhvControlReplayReceipt(input.receiptPath);
  assertIdentityMatch("CONTROL_REPLAY", input.identity, receipt);
  if (
    receipt.datasetQualificationReceiptDigest !==
    input.qualificationReceipt.qualificationReceiptDigest
  ) {
    throw new FhvArtifactAuthorityError(
      "CONTROL_REPLAY_QUALIFICATION_DIGEST_MISMATCH",
      "Control replay receipt qualification digest mismatch.",
    );
  }
  if (receipt.datasetContentDigest !== input.qualificationReceipt.datasetContentDigest) {
    throw new FhvArtifactAuthorityError(
      "CONTROL_REPLAY_DATASET_DIGEST_MISMATCH",
      "Control replay receipt dataset digest mismatch.",
    );
  }
  if (receipt.manifestSemanticDigest !== input.qualificationReceipt.manifestSemanticDigest) {
    throw new FhvArtifactAuthorityError(
      "CONTROL_REPLAY_MANIFEST_DIGEST_MISMATCH",
      "Control replay receipt manifest digest mismatch.",
    );
  }
  if (receipt.digestsMatch !== true) {
    throw new FhvArtifactAuthorityError(
      "CONTROL_REPLAY_DIGESTS_NOT_MATCH",
      "Control replay receipt digestsMatch must be true.",
    );
  }
  return receipt;
}

export function assertFhvControlReplayReceiptForFullLaunch(input: {
  receiptPath: string;
  identity: FhvExecutionIdentity;
  qualificationReceipt: FhvDatasetQualificationReceiptV1;
  authorizationReceipt: FhvFullHistoricalAuthorizationReceiptV1;
}): FhvControlReplayReceiptV1 {
  const receipt = assertFhvControlReplayReceiptForAuthorization({
    receiptPath: input.receiptPath,
    identity: input.identity,
    qualificationReceipt: input.qualificationReceipt,
  });
  if (
    input.authorizationReceipt.controlReplayReceiptDigest &&
    input.authorizationReceipt.controlReplayReceiptDigest !== receipt.controlReplayReceiptDigest
  ) {
    throw new FhvArtifactAuthorityError(
      "AUTHORIZATION_CONTROL_REPLAY_DIGEST_MISMATCH",
      "Authorization receipt controlReplayReceiptDigest must match control replay receipt.",
    );
  }
  return receipt;
}

export function assertFhvAuthorizationReceiptForExecution(input: {
  receiptPath: string;
  identity: FhvExecutionIdentity;
  runId: string;
  qualificationReceipt: FhvDatasetQualificationReceiptV1;
  freezeDigest: string;
  controlReplayReceiptDigest?: string;
}): FhvFullHistoricalAuthorizationReceiptV1 {
  const receipt = readFhvFullHistoricalAuthorizationReceipt(input.receiptPath);
  assertIdentityMatch("AUTHORIZATION", input.identity, receipt);
  if (receipt.runId !== input.runId) {
    throw new FhvArtifactAuthorityError(
      "AUTHORIZATION_RUN_ID_MISMATCH",
      "Authorization receipt runId mismatch.",
    );
  }
  if (
    receipt.datasetQualificationReceiptDigest !==
    input.qualificationReceipt.qualificationReceiptDigest
  ) {
    throw new FhvArtifactAuthorityError(
      "AUTHORIZATION_QUALIFICATION_DIGEST_MISMATCH",
      "Authorization qualification digest mismatch.",
    );
  }
  if (receipt.configurationFreezeDigest !== input.freezeDigest) {
    throw new FhvArtifactAuthorityError(
      "AUTHORIZATION_FREEZE_DIGEST_MISMATCH",
      "Authorization freeze digest mismatch.",
    );
  }
  if (
    input.controlReplayReceiptDigest &&
    receipt.controlReplayReceiptDigest !== input.controlReplayReceiptDigest
  ) {
    throw new FhvArtifactAuthorityError(
      "AUTHORIZATION_CONTROL_REPLAY_DIGEST_MISMATCH",
      "Authorization control replay digest mismatch.",
    );
  }
  if (receipt.consumed) {
    throw new FhvArtifactAuthorityError(
      "AUTHORIZATION_ALREADY_CONSUMED",
      "Authorization receipt already consumed.",
    );
  }
  return receipt;
}
