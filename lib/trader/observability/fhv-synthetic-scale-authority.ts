import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
  FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
  type FhvExecutionPurpose,
} from "@/lib/trader/observability/fhv-execution-purpose";

export const FHV_SYNTHETIC_SCALE_AUTHORITY_SCHEMA_VERSION =
  "fhv-synthetic-scale-authority/v1" as const;
export const FHV_SYNTHETIC_SCALE_AUTHORITY_FILENAME =
  "fhv-synthetic-scale-authority.v1.json" as const;

export const FHV_SYNTHETIC_SCALE_AUTHORITY_CLASS = "SYNTHETIC_OFFICIAL_SCALE_PROOF" as const;
export const FHV_SYNTHETIC_SCALE_PERMITTED_QUALIFICATION_MODE = "OFFICIAL_MULTI_YEAR" as const;

export type FhvSyntheticScaleAuthorityV1 = Readonly<{
  schemaVersion: typeof FHV_SYNTHETIC_SCALE_AUTHORITY_SCHEMA_VERSION;
  authorityClass: typeof FHV_SYNTHETIC_SCALE_AUTHORITY_CLASS;
  permittedExecutionPurposes: readonly [
    typeof FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
    typeof FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
  ];
  permittedQualificationMode: typeof FHV_SYNTHETIC_SCALE_PERMITTED_QUALIFICATION_MODE;
  runId: string;
  organizationId: string;
  releaseSha: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  maxCycles: number | null;
  targetCycleCount: number;
  checkpointEveryCycles: number;
  technicalObservationMode: boolean;
  issuedAtUtc: string;
  contentDigest: string;
  rawSha256: string;
}>;

export class FhvSyntheticScaleAuthorityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvSyntheticScaleAuthorityError";
  }
}

function computeRawSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function computeFhvSyntheticScaleAuthorityContentDigest(
  authority: Omit<FhvSyntheticScaleAuthorityV1, "contentDigest" | "rawSha256">,
): string {
  return computePayloadDigest(authority);
}

export function buildFhvSyntheticScaleAuthority(input: {
  runId: string;
  organizationId: string;
  releaseSha: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  maxCycles?: number | null;
  targetCycleCount: number;
  checkpointEveryCycles: number;
  technicalObservationMode?: boolean;
  issuedAtUtc?: string;
}): FhvSyntheticScaleAuthorityV1 {
  const withoutDigests = {
    schemaVersion: FHV_SYNTHETIC_SCALE_AUTHORITY_SCHEMA_VERSION,
    authorityClass: FHV_SYNTHETIC_SCALE_AUTHORITY_CLASS,
    permittedExecutionPurposes: [
      FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
    ] as const,
    permittedQualificationMode: FHV_SYNTHETIC_SCALE_PERMITTED_QUALIFICATION_MODE,
    runId: input.runId,
    organizationId: input.organizationId,
    releaseSha: input.releaseSha.trim().toLowerCase(),
    datasetContentDigest: input.datasetContentDigest,
    manifestSemanticDigest: input.manifestSemanticDigest,
    maxCycles: input.maxCycles ?? null,
    targetCycleCount: input.targetCycleCount,
    checkpointEveryCycles: input.checkpointEveryCycles,
    technicalObservationMode: input.technicalObservationMode ?? false,
    issuedAtUtc: input.issuedAtUtc ?? new Date().toISOString(),
  };
  const withContentDigest = {
    ...withoutDigests,
    contentDigest: computeFhvSyntheticScaleAuthorityContentDigest(withoutDigests),
  };
  const jsonWithoutRaw = `${JSON.stringify(withContentDigest, null, 2)}\n`;
  return {
    ...withContentDigest,
    rawSha256: computeRawSha256(jsonWithoutRaw),
  };
}

export function readFhvSyntheticScaleAuthority(
  authorityPath: string,
): FhvSyntheticScaleAuthorityV1 {
  const raw = readFileSync(authorityPath, "utf8");
  const parsed = JSON.parse(raw) as FhvSyntheticScaleAuthorityV1;
  const { contentDigest, rawSha256, ...withoutDigests } = parsed;
  const expectedContent = computeFhvSyntheticScaleAuthorityContentDigest(withoutDigests);
  if (expectedContent !== contentDigest) {
    throw new FhvSyntheticScaleAuthorityError(
      "SYNTHETIC_SCALE_AUTHORITY_DIGEST_MISMATCH",
      "Synthetic scale authority contentDigest mismatch.",
    );
  }
  const jsonWithoutRaw = `${JSON.stringify({ ...withoutDigests, contentDigest }, null, 2)}\n`;
  if (computeRawSha256(jsonWithoutRaw) !== rawSha256) {
    throw new FhvSyntheticScaleAuthorityError(
      "SYNTHETIC_SCALE_AUTHORITY_RAW_SHA256_MISMATCH",
      "Synthetic scale authority rawSha256 mismatch.",
    );
  }
  return parsed;
}

export function writeFhvSyntheticScaleAuthorityAtomic(
  authorityPath: string,
  authority: FhvSyntheticScaleAuthorityV1,
): void {
  mkdirSync(join(authorityPath, ".."), { recursive: true });
  if (existsSync(authorityPath)) {
    throw new FhvSyntheticScaleAuthorityError(
      "SYNTHETIC_SCALE_AUTHORITY_EXISTS",
      "Synthetic scale authority already exists.",
    );
  }
  writeFileAtomicExclusive(authorityPath, `${JSON.stringify(authority, null, 2)}\n`);
}

export function assertFhvSyntheticScaleAuthorityForLaunch(input: {
  authority: FhvSyntheticScaleAuthorityV1;
  executionPurpose: FhvExecutionPurpose;
  runId: string;
  organizationId: string;
  releaseSha: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  maxCycles?: number;
}): void {
  if (
    input.authority.authorityClass !== FHV_SYNTHETIC_SCALE_AUTHORITY_CLASS ||
    input.authority.permittedQualificationMode !== FHV_SYNTHETIC_SCALE_PERMITTED_QUALIFICATION_MODE
  ) {
    throw new FhvSyntheticScaleAuthorityError(
      "SYNTHETIC_SCALE_AUTHORITY_CLASS_MISMATCH",
      "Synthetic scale authority class or qualification mode mismatch.",
    );
  }
  if (!input.authority.permittedExecutionPurposes.includes(input.executionPurpose)) {
    throw new FhvSyntheticScaleAuthorityError(
      "SYNTHETIC_SCALE_EXECUTION_PURPOSE_FORBIDDEN",
      `executionPurpose ${input.executionPurpose} is not permitted by synthetic scale authority.`,
    );
  }
  if (input.authority.runId !== input.runId) {
    throw new FhvSyntheticScaleAuthorityError(
      "SYNTHETIC_SCALE_RUN_ID_MISMATCH",
      "Synthetic scale authority runId mismatch.",
    );
  }
  if (input.authority.organizationId !== input.organizationId) {
    throw new FhvSyntheticScaleAuthorityError(
      "SYNTHETIC_SCALE_ORGANIZATION_ID_MISMATCH",
      "Synthetic scale authority organizationId mismatch.",
    );
  }
  if (input.authority.releaseSha !== input.releaseSha.trim().toLowerCase()) {
    throw new FhvSyntheticScaleAuthorityError(
      "SYNTHETIC_SCALE_RELEASE_SHA_MISMATCH",
      "Synthetic scale authority releaseSha mismatch.",
    );
  }
  if (
    input.authority.datasetContentDigest !== input.datasetContentDigest ||
    input.authority.manifestSemanticDigest !== input.manifestSemanticDigest
  ) {
    throw new FhvSyntheticScaleAuthorityError(
      "SYNTHETIC_SCALE_DATASET_DIGEST_MISMATCH",
      "Synthetic scale authority dataset digests mismatch.",
    );
  }
  if (input.maxCycles != null && input.authority.maxCycles != null) {
    if (input.maxCycles !== input.authority.maxCycles) {
      throw new FhvSyntheticScaleAuthorityError(
        "SYNTHETIC_SCALE_MAX_CYCLES_MISMATCH",
        "maxCycles must match synthetic scale authority maxCycles.",
      );
    }
  }
}
