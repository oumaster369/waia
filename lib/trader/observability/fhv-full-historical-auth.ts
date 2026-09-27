import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  assertMetadataBytesSupported,
  readMetadataBytesSync,
  CONTROL_REPLAY_METADATA_PROFILE,
  readMetadataTextSync,
  type FhvMetadataReadOptions,
} from "@/lib/trader/backtest/streaming-evidence/bounded-metadata-read";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertControlReplayAuthorizationPurpose,
  assertFullHistoricalAuthorizationPurpose,
  assertFhvExecutionPurpose,
  FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
  FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
  type FhvExecutionPurpose,
} from "@/lib/trader/observability/fhv-execution-purpose";
import {
  claimFileExclusiveLock,
  releaseFileExclusiveLock,
  writeFileAtomicCompareAndReplace,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  assertImmutableArtifactExactMatch,
  FhvImmutableArtifactCollisionError,
} from "@/lib/trader/observability/fhv-immutable-artifact-guard";

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
  executionPurpose: FhvExecutionPurpose;
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
  executionPurpose: FhvExecutionPurpose;
  authorizedAtUtc?: string;
}): FhvFullHistoricalAuthorizationReceiptV1 {
  if (input.executionPurpose === FHV_EXECUTION_PURPOSE_CONTROL_REPLAY) {
    assertControlReplayAuthorizationPurpose(input.executionPurpose);
    if (input.controlReplayReceiptDigest) {
      throw new FhvFullHistoricalAuthError(
        "CONTROL_REPLAY_RECEIPT_FORBIDDEN",
        "CONTROL_REPLAY authorization must not include controlReplayReceiptDigest.",
      );
    }
  } else {
    assertFullHistoricalAuthorizationPurpose(input.executionPurpose);
    if (!input.controlReplayReceiptDigest) {
      throw new FhvFullHistoricalAuthError(
        "CONTROL_REPLAY_RECEIPT_REQUIRED",
        "FULL_HISTORICAL authorization requires controlReplayReceiptDigest.",
      );
    }
  }
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
    executionPurpose: assertFhvExecutionPurpose(input.executionPurpose),
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
  options?: FhvMetadataReadOptions,
): FhvFullHistoricalAuthorizationReceiptV1 {
  const parsed = JSON.parse(
    readMetadataTextSync(receiptPath, options),
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

const AUTHORIZATION_RECEIPT_COMPARE_KEYS = [
  "schemaVersion",
  "releaseSha",
  "releaseTag",
  "datasetQualificationReceiptDigest",
  "datasetDigest",
  "manifestDigest",
  "configurationFreezeDigest",
  "controlReplayReceiptDigest",
  "organizationId",
  "operatorId",
  "runId",
  "executionPurpose",
  "oneExecution",
] as const satisfies readonly (keyof FhvFullHistoricalAuthorizationReceiptV1)[];

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
  executionPurpose: FhvExecutionPurpose;
}): { receiptPath: string; receipt: FhvFullHistoricalAuthorizationReceiptV1 } {
  mkdirSync(input.receiptDir, { recursive: true });
  const receiptPath = join(input.receiptDir, FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_FILENAME);

  if (existsSync(receiptPath)) {
    const existing = readFhvFullHistoricalAuthorizationReceipt(receiptPath);
    const requested = buildFhvFullHistoricalAuthorizationReceipt({
      ...input,
      authorizedAtUtc: existing.authorizedAtUtc,
    });
    assertImmutableArtifactExactMatch({
      artifactPath: receiptPath,
      artifactLabel: "Full historical authorization receipt",
      existing,
      requested,
      compareKeys: AUTHORIZATION_RECEIPT_COMPARE_KEYS,
    });
    return {
      receiptPath,
      receipt: existing,
    };
  }
  const receipt = buildFhvFullHistoricalAuthorizationReceipt(input);
  writeFileAtomicExclusive(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receiptPath, receipt };
}

export { FhvImmutableArtifactCollisionError };

function buildConsumedAuthorizationReceipt(
  receipt: FhvFullHistoricalAuthorizationReceiptV1,
  consumedAtUtc: string,
): FhvFullHistoricalAuthorizationReceiptV1 {
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
    executionPurpose: receipt.executionPurpose,
    oneExecution: true as const,
    authorizedAtUtc: receipt.authorizedAtUtc,
    consumed: true as const,
    consumedAtUtc,
  };
  return {
    ...withoutDigest,
    authorizationReceiptDigest: computeAuthorizationReceiptDigest(withoutDigest),
  };
}

function consumeAuthorizationSnapshotHeld(
  receiptPath: string,
  expectedContent: string,
  receipt: FhvFullHistoricalAuthorizationReceiptV1,
  options?: FhvMetadataReadOptions,
): FhvFullHistoricalAuthorizationReceiptV1 {
  const consumedReceipt = buildConsumedAuthorizationReceipt(receipt, new Date().toISOString());
  const nextContent = `${JSON.stringify(consumedReceipt, null, 2)}\n`;
  writeFileAtomicCompareAndReplace({
    finalPath: receiptPath,
    expectedContent,
    nextContent,
    metadataReadProfile: options?.metadataReadProfile,
  });
  return consumedReceipt;
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
    return consumeAuthorizationSnapshotHeld(receiptPath, expectedContent, receipt);
  } finally {
    releaseFileExclusiveLock(lockPath, lockFd);
  }
}

export function assertFhvFullHistoricalAuthorizationReceiptForLaunch(
  input: {
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
  },
  options?: FhvMetadataReadOptions,
): FhvFullHistoricalAuthorizationReceiptV1 {
  const receipt = readFhvFullHistoricalAuthorizationReceipt(input.receiptPath, options);
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
  if (receipt.executionPurpose === undefined || receipt.executionPurpose === null) {
    throw new FhvFullHistoricalAuthError(
      "EXECUTION_PURPOSE_MISSING",
      "Authorization receipt executionPurpose is required.",
    );
  }
  assertFhvExecutionPurpose(receipt.executionPurpose);
  return receipt;
}

export const FHV_CONTROL_REPLAY_METADATA_OPTIONS = Object.freeze({
  metadataReadProfile: CONTROL_REPLAY_METADATA_PROFILE,
});
export type FhvControlReplayExpectedIdentity = Pick<
  FhvFullHistoricalAuthorizationReceiptV1,
  | "releaseSha"
  | "releaseTag"
  | "datasetQualificationReceiptDigest"
  | "datasetDigest"
  | "manifestDigest"
  | "configurationFreezeDigest"
  | "organizationId"
  | "operatorId"
  | "runId"
>;
export type FhvControlReplayTransitionInput = Readonly<{
  artifactRoot: string;
  runId: string;
  authorizationReceiptPath: string;
  expectedIdentity: FhvControlReplayExpectedIdentity;
}>;
const CONTROL_IDENTITY_KEYS = [
  "releaseSha",
  "releaseTag",
  "datasetQualificationReceiptDigest",
  "datasetDigest",
  "manifestDigest",
  "configurationFreezeDigest",
  "organizationId",
  "operatorId",
  "runId",
] as const;
const strictMetadata = FHV_CONTROL_REPLAY_METADATA_OPTIONS;

export function resolveFhvControlReplayHistoryDirectory(
  artifactRoot: string,
  runId: string,
): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(runId)) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_IDENTITY_MISMATCH",
      "Invalid Control Replay run identity.",
    );
  }
  return resolve(
    artifactRoot,
    "RI-P7",
    "fhv-full-historical",
    runId,
    "control",
    "authorization-transition.v1",
  );
}

export function computeFhvControlReplayByteDigest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseStrictControlReplayAuthorization(
  bytes: Buffer,
  expected: FhvControlReplayExpectedIdentity,
  consumed: boolean,
): FhvFullHistoricalAuthorizationReceiptV1 {
  const receipt = JSON.parse(bytes.toString("utf8")) as FhvFullHistoricalAuthorizationReceiptV1;
  const { authorizationReceiptDigest, ...body } = receipt;
  if (computeAuthorizationReceiptDigest(body) !== authorizationReceiptDigest) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_RECEIPT_DIGEST_MISMATCH",
      "Authorization receipt digest mismatch.",
    );
  }
  const keys = [
    ...CONTROL_IDENTITY_KEYS,
    "schemaVersion",
    "executionPurpose",
    "oneExecution",
    "authorizedAtUtc",
    "authorizationReceiptDigest",
    "consumed",
    ...(consumed ? ["consumedAtUtc"] : []),
  ].sort();
  if (
    JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(keys) ||
    receipt.schemaVersion !== FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_SCHEMA_VERSION ||
    receipt.executionPurpose !== FHV_EXECUTION_PURPOSE_CONTROL_REPLAY ||
    receipt.oneExecution !== true ||
    receipt.consumed !== consumed ||
    typeof receipt.authorizedAtUtc !== "string" ||
    !receipt.authorizedAtUtc ||
    (consumed && (typeof receipt.consumedAtUtc !== "string" || !receipt.consumedAtUtc))
  ) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_TRANSITION_INVALID",
      "Unsupported Control Replay authorization body.",
    );
  }
  if (
    CONTROL_IDENTITY_KEYS.some(
      (key) =>
        typeof expected[key] !== "string" ||
        expected[key].length === 0 ||
        receipt[key] !== expected[key],
    )
  ) {
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_IDENTITY_MISMATCH",
      "Control Replay authorization identity mismatch.",
    );
  }
  return receipt;
}

function buildControlReplayPair(input: {
  issued: FhvFullHistoricalAuthorizationReceiptV1;
  consumed: FhvFullHistoricalAuthorizationReceiptV1;
  issuedBytes: Buffer;
  consumedBytes: Buffer;
}) {
  const body = {
    schemaVersion: "fhv-control-replay-authorization-pair/v1" as const,
    profile: CONTROL_REPLAY_METADATA_PROFILE,
    identity: Object.fromEntries(
      CONTROL_IDENTITY_KEYS.map((key) => [key, input.issued[key]]),
    ) as FhvControlReplayExpectedIdentity,
    executionPurpose: FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
    issuedFilename: "issued.v1.json" as const,
    consumedFilename: "consumed.v1.json" as const,
    issuedAuthorizationReceiptDigest: input.issued.authorizationReceiptDigest,
    consumedAuthorizationReceiptDigest: input.consumed.authorizationReceiptDigest,
    issuedBytesSha256: computeFhvControlReplayByteDigest(input.issuedBytes),
    consumedBytesSha256: computeFhvControlReplayByteDigest(input.consumedBytes),
  };
  return { ...body, pairDigest: computeStableJsonDigest(body) };
}
export type FhvControlReplayAuthorizationPairV1 = ReturnType<typeof buildControlReplayPair>;

function writeControlReplayHistoryExact(path: string, bytes: Buffer): void {
  assertMetadataBytesSupported(bytes, strictMetadata);
  if (existsSync(path)) {
    if (!readMetadataBytesSync(path, strictMetadata).equals(bytes)) {
      throw new FhvFullHistoricalAuthError(
        "AUTHORIZATION_HISTORY_CONFLICT",
        "Immutable Control Replay history differs.",
      );
    }
    return;
  }
  writeFileAtomicExclusive(path, bytes);
}

export function readFhvControlReplayAuthorizationTransitionV1(
  input: FhvControlReplayTransitionInput,
) {
  if (input.expectedIdentity.runId !== input.runId)
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_IDENTITY_MISMATCH",
      "Run identity mismatch.",
    );
  const historyDir = resolveFhvControlReplayHistoryDirectory(input.artifactRoot, input.runId);
  const issuedPath = join(historyDir, "issued.v1.json");
  if (!existsSync(issuedPath))
    throw new FhvFullHistoricalAuthError(
      "ORIGINAL_AUTHORIZATION_UNAVAILABLE",
      "Original issued authorization is unavailable.",
    );
  const issuedBytes = readMetadataBytesSync(issuedPath, strictMetadata);
  const issued = parseStrictControlReplayAuthorization(issuedBytes, input.expectedIdentity, false);
  const consumedPath = join(historyDir, "consumed.v1.json");
  const pairPath = join(historyDir, "pair.v1.json");
  if (!existsSync(consumedPath) || !existsSync(pairPath))
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_TRANSITION_INCOMPLETE",
      "Consumed authorization transition is incomplete.",
    );
  const consumedBytes = readMetadataBytesSync(consumedPath, strictMetadata);
  const consumed = parseStrictControlReplayAuthorization(
    consumedBytes,
    input.expectedIdentity,
    true,
  );
  const projected = buildConsumedAuthorizationReceipt(issued, consumed.consumedAtUtc!);
  if (computeStableJsonDigest(projected) !== computeStableJsonDigest(consumed))
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_TRANSITION_INVALID",
      "Consumed authorization is not the native transition from original Ai.",
    );
  const currentBytes = readMetadataBytesSync(input.authorizationReceiptPath, strictMetadata);
  if (!currentBytes.equals(consumedBytes))
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_HISTORY_CONFLICT",
      "Current authorization differs from retained Ac.",
    );
  const pair = JSON.parse(
    readMetadataTextSync(pairPath, strictMetadata),
  ) as FhvControlReplayAuthorizationPairV1;
  const expectedPair = buildControlReplayPair({ issued, consumed, issuedBytes, consumedBytes });
  if (computeStableJsonDigest(pair) !== computeStableJsonDigest(expectedPair))
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_TRANSITION_INVALID",
      "Authorization pair content or digest mismatch.",
    );
  return { historyDir, issued, consumed, pair, issuedBytes, consumedBytes };
}

/** Owns the existing native consume lock; no caller-provided receipt or held-lock escape. */
export function consumeFhvControlReplayAuthorizationWithHistoryV1(
  input: FhvControlReplayTransitionInput & { expectedIssuedReceiptDigest: string },
) {
  const request = { ...input, expectedIdentity: { ...input.expectedIdentity } };
  const historyDir = resolveFhvControlReplayHistoryDirectory(request.artifactRoot, request.runId);
  if (request.expectedIdentity.runId !== request.runId)
    throw new FhvFullHistoricalAuthError(
      "AUTHORIZATION_IDENTITY_MISMATCH",
      "Run identity mismatch.",
    );
  const lockPath = `${request.authorizationReceiptPath}.consume.lock`;
  const lockFd = claimFileExclusiveLock(lockPath);
  try {
    const issuedBytes = readMetadataBytesSync(request.authorizationReceiptPath, strictMetadata);
    const current = JSON.parse(
      issuedBytes.toString("utf8"),
    ) as FhvFullHistoricalAuthorizationReceiptV1;
    if (current.consumed === true)
      throw new FhvFullHistoricalAuthError(
        "AUTHORIZATION_ALREADY_CONSUMED",
        "Authorization receipt has already been consumed.",
      );
    const issued = parseStrictControlReplayAuthorization(
      issuedBytes,
      request.expectedIdentity,
      false,
    );
    if (issued.authorizationReceiptDigest !== request.expectedIssuedReceiptDigest)
      throw new FhvFullHistoricalAuthError(
        "AUTHORIZATION_RECEIPT_DIGEST_MISMATCH",
        "Issued authorization changed before consumption.",
      );
    for (const filename of ["consumed.v1.json", "pair.v1.json", "initialized.v1.json"]) {
      if (existsSync(join(historyDir, filename)))
        throw new FhvFullHistoricalAuthError(
          "AUTHORIZATION_HISTORY_CONFLICT",
          "Existing transition cannot be consumed again.",
        );
    }
    mkdirSync(historyDir, { recursive: true });
    writeControlReplayHistoryExact(join(historyDir, "issued.v1.json"), issuedBytes);
    const consumed = consumeAuthorizationSnapshotHeld(
      request.authorizationReceiptPath,
      issuedBytes.toString("utf8"),
      issued,
      strictMetadata,
    );
    const nextContent = `${JSON.stringify(consumed, null, 2)}\n`;
    const consumedBytes = readMetadataBytesSync(request.authorizationReceiptPath, strictMetadata);
    if (!consumedBytes.equals(Buffer.from(nextContent)))
      throw new FhvFullHistoricalAuthError(
        "AUTHORIZATION_HISTORY_CONFLICT",
        "Native consumed readback changed.",
      );
    writeControlReplayHistoryExact(join(historyDir, "consumed.v1.json"), consumedBytes);
    const pair = buildControlReplayPair({ issued, consumed, issuedBytes, consumedBytes });
    writeControlReplayHistoryExact(
      join(historyDir, "pair.v1.json"),
      Buffer.from(`${JSON.stringify(pair, null, 2)}\n`),
    );
    return readFhvControlReplayAuthorizationTransitionV1(request);
  } finally {
    releaseFileExclusiveLock(lockPath, lockFd);
  }
}
