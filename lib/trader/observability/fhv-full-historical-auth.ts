import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  claimFileExclusiveLock,
  releaseFileExclusiveLock,
  writeFileAtomicCompareAndReplace,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

/** Human-only authorization literal for issuing scoped authorization receipts. */
export const FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION =
  "AUTHORIZE-FULL-HISTORICAL-VALIDATION" as const;

export type FhvFullHistoricalAuthorizationLiteral =
  typeof FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION;

export const FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_SCHEMA_VERSION =
  "fhv-full-historical-authorization/v1" as const;
export const FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_FILENAME =
  "fhv-full-historical-authorization.v1.json" as const;

export type FhvFullHistoricalAuthorizationReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_SCHEMA_VERSION;
  releaseSha: string;
  releaseTag: string;
  datasetQualificationReceiptDigest: string;
  datasetDigest: string;
  manifestDigest: string;
  configurationFreezeDigest: string;
  controlReplayReceiptDigest?: string;
  organizationId: string;
  operatorId: string;
  runId: string;
  oneExecution: true;
  authorizedAtUtc: string;
  authorizationReceiptDigest: string;
  consumed: boolean;
  consumedAtUtc?: string;
}>;

export class FhvFullHistoricalAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvFullHistoricalAuthError";
  }
}

function computeAuthorizationReceiptDigest(
  receipt: Omit<FhvFullHistoricalAuthorizationReceiptV1, "authorizationReceiptDigest">,
): string {
  return computePayloadDigest(receipt);
}

export function assertFhvFullHistoricalValidationAuthorization(
  authorization: string | undefined,
): void {
  const normalized = authorization?.trim();
  if (!normalized) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_MISSING",
      "AUTHORIZE-FULL-HISTORICAL-VALIDATION is required for Full Historical Validation launch.",
    );
  }
  if (normalized !== FHV_FULL_HISTORICAL_VALIDATION_AUTHORIZATION) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_MISMATCH",
      "Authorization literal must be AUTHORIZE-FULL-HISTORICAL-VALIDATION (not interchangeable with AUTHORIZE-FHV-OPS-DEPLOY).",
    );
  }
}

export function buildFhvFullHistoricalAuthorizationReceipt(input: {
  releaseSha: string;
  releaseTag: string;
  datasetQualificationReceiptDigest: string;
  datasetDigest: string;
  manifestDigest: string;
  configurationFreezeDigest: string;
  controlReplayReceiptDigest?: string;
  organizationId: string;
  operatorId: string;
  runId: string;
  authorizedAtUtc?: string;
}): FhvFullHistoricalAuthorizationReceiptV1 {
  const withoutDigest = {
    schemaVersion: FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_SCHEMA_VERSION,
    releaseSha: input.releaseSha.trim().toLowerCase(),
    releaseTag: input.releaseTag.trim(),
    datasetQualificationReceiptDigest: input.datasetQualificationReceiptDigest,
    datasetDigest: input.datasetDigest,
    manifestDigest: input.manifestDigest,
    configurationFreezeDigest: input.configurationFreezeDigest,
    ...(input.controlReplayReceiptDigest
      ? { controlReplayReceiptDigest: input.controlReplayReceiptDigest }
      : {}),
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    runId: input.runId,
    oneExecution: true as const,
    authorizedAtUtc: input.authorizedAtUtc ?? new Date().toISOString(),
    consumed: false,
  };
  return {
    ...withoutDigest,
    authorizationReceiptDigest: computeAuthorizationReceiptDigest(withoutDigest),
  };
}

export function readFhvFullHistoricalAuthorizationReceipt(
  receiptPath: string,
): FhvFullHistoricalAuthorizationReceiptV1 {
  const parsed = JSON.parse(
    readFileSync(receiptPath, "utf8"),
  ) as FhvFullHistoricalAuthorizationReceiptV1;
  const { authorizationReceiptDigest, ...body } = parsed;
  const expected = computeAuthorizationReceiptDigest(body);
  if (expected !== authorizationReceiptDigest) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_RECEIPT_DIGEST_MISMATCH",
      "Authorization receipt digest mismatch.",
    );
  }
  return parsed;
}

export function writeFhvFullHistoricalAuthorizationReceiptAtomic(input: {
  receiptDir: string;
  releaseSha: string;
  releaseTag: string;
  datasetQualificationReceiptDigest: string;
  datasetDigest: string;
  manifestDigest: string;
  configurationFreezeDigest: string;
  controlReplayReceiptDigest?: string;
  organizationId: string;
  operatorId: string;
  runId: string;
}): { receiptPath: string; receipt: FhvFullHistoricalAuthorizationReceiptV1 } {
  mkdirSync(input.receiptDir, { recursive: true });
  const receiptPath = join(input.receiptDir, FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_FILENAME);
  if (existsSync(receiptPath)) {
    return {
      receiptPath,
      receipt: readFhvFullHistoricalAuthorizationReceipt(receiptPath),
    };
  }
  const receipt = buildFhvFullHistoricalAuthorizationReceipt(input);
  writeFileAtomicExclusive(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receiptPath, receipt };
}

export function consumeFhvFullHistoricalAuthorizationReceipt(
  receiptPath: string,
): FhvFullHistoricalAuthorizationReceiptV1 {
  const lockPath = `${receiptPath}.consume.lock`;
  const lockFd = claimFileExclusiveLock(lockPath);
  try {
    const expectedContent = readFileSync(receiptPath, "utf8");
    const receipt = JSON.parse(expectedContent) as FhvFullHistoricalAuthorizationReceiptV1;
    const { authorizationReceiptDigest, ...body } = receipt;
    if (computeAuthorizationReceiptDigest(body) !== authorizationReceiptDigest) {
      throw new FhvFullHistoricalAuthError(
        "AUTHORIZATION_RECEIPT_DIGEST_MISMATCH",
        "Authorization receipt digest mismatch.",
      );
    }
    if (receipt.consumed) {
      throw new FhvFullHistoricalAuthError(
        "AUTHORIZATION_ALREADY_CONSUMED",
        "Authorization receipt has already been consumed.",
      );
    }
    const consumedAtUtc = new Date().toISOString();
    const withoutDigest = {
      schemaVersion: receipt.schemaVersion,
      releaseSha: receipt.releaseSha,
      releaseTag: receipt.releaseTag,
      datasetQualificationReceiptDigest: receipt.datasetQualificationReceiptDigest,
      datasetDigest: receipt.datasetDigest,
      manifestDigest: receipt.manifestDigest,
      configurationFreezeDigest: receipt.configurationFreezeDigest,
      ...(receipt.controlReplayReceiptDigest
        ? { controlReplayReceiptDigest: receipt.controlReplayReceiptDigest }
        : {}),
      organizationId: receipt.organizationId,
      operatorId: receipt.operatorId,
      runId: receipt.runId,
      oneExecution: true as const,
      authorizedAtUtc: receipt.authorizedAtUtc,
      consumed: true as const,
      consumedAtUtc,
    };
    const consumedReceipt: FhvFullHistoricalAuthorizationReceiptV1 = {
      ...withoutDigest,
      authorizationReceiptDigest: computeAuthorizationReceiptDigest(withoutDigest),
    };
    const nextContent = `${JSON.stringify(consumedReceipt, null, 2)}\n`;
    writeFileAtomicCompareAndReplace({
      finalPath: receiptPath,
      expectedContent,
      nextContent,
    });
    return consumedReceipt;
  } finally {
    releaseFileExclusiveLock(lockPath, lockFd);
  }
}

export function assertFhvFullHistoricalAuthorizationReceiptForLaunch(input: {
  receiptPath: string;
  authorizationReceiptDigest: string;
  releaseSha: string;
  releaseTag?: string;
  datasetQualificationReceiptDigest: string;
  datasetDigest: string;
  manifestDigest: string;
  configurationFreezeDigest: string;
  controlReplayReceiptDigest?: string;
  organizationId: string;
  operatorId: string;
  runId: string;
}): FhvFullHistoricalAuthorizationReceiptV1 {
  const receipt = readFhvFullHistoricalAuthorizationReceipt(input.receiptPath);
  if (receipt.authorizationReceiptDigest !== input.authorizationReceiptDigest) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_RECEIPT_DIGEST_MISMATCH",
      "authorizationReceiptDigest mismatch.",
    );
  }
  if (receipt.consumed) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_ALREADY_CONSUMED",
      "Authorization receipt has already been consumed.",
    );
  }
  if (receipt.releaseSha !== input.releaseSha.trim().toLowerCase()) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_RELEASE_SHA_MISMATCH",
      "Authorization receipt releaseSha mismatch.",
    );
  }
  if (input.releaseTag && receipt.releaseTag !== input.releaseTag.trim()) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_RELEASE_TAG_MISMATCH",
      "Authorization receipt releaseTag mismatch.",
    );
  }
  if (receipt.datasetQualificationReceiptDigest !== input.datasetQualificationReceiptDigest) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_QUALIFICATION_DIGEST_MISMATCH",
      "Authorization receipt datasetQualificationReceiptDigest mismatch.",
    );
  }
  if (
    receipt.datasetDigest !== input.datasetDigest ||
    receipt.manifestDigest !== input.manifestDigest ||
    receipt.configurationFreezeDigest !== input.configurationFreezeDigest
  ) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_DIGEST_BINDING_MISMATCH",
      "Authorization receipt digest bindings mismatch.",
    );
  }
  if (
    input.controlReplayReceiptDigest &&
    receipt.controlReplayReceiptDigest !== input.controlReplayReceiptDigest
  ) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_CONTROL_REPLAY_DIGEST_MISMATCH",
      "Authorization receipt controlReplayReceiptDigest mismatch.",
    );
  }
  if (
    receipt.organizationId !== input.organizationId ||
    receipt.operatorId !== input.operatorId ||
    receipt.runId !== input.runId
  ) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_IDENTITY_MISMATCH",
      "Authorization receipt identity mismatch.",
    );
  }
  if (receipt.oneExecution !== true) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_ONE_EXECUTION_REQUIRED",
      "Authorization receipt must declare oneExecution=true.",
    );
  }
  return receipt;
}
