import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  FHV_SYSTEMD_ALLOWED_UNITS,
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";

export const FHV_SYSTEMD_DEPLOYED_REVISION_SCHEMA_VERSION =
  "fhv-systemd-deployed-revision/v1" as const;
export const FHV_SYSTEMD_DEPLOYED_REVISION_FILENAME =
  "fhv-systemd-deployed-revision.v1.json" as const;
export const FHV_SYSTEMD_DEPLOYMENT_KIND = "FHV_SYSTEMD_REHEARSAL" as const;
export const FHV_SYSTEMD_LEGACY_CONTAINER_NAME = "ai-trader-execution-host" as const;
export const FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE = "waia-execution-host:bp6" as const;
export const FHV_SYSTEMD_RECORD_WRITER_VERSION = "dee-435-v1" as const;

export type FhvSystemdRenderedUnitDigestsV1 = Readonly<
  Record<typeof FHV_SYSTEMD_CAMPAIGN_UNIT | typeof FHV_SYSTEMD_OBSERVER_UNIT, string>
>;

export type FhvSystemdDeployedRevisionV1 = Readonly<{
  schemaVersion: typeof FHV_SYSTEMD_DEPLOYED_REVISION_SCHEMA_VERSION;
  releaseSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  deploymentKind: typeof FHV_SYSTEMD_DEPLOYMENT_KIND;
  installedUnitNames: readonly [typeof FHV_SYSTEMD_CAMPAIGN_UNIT, typeof FHV_SYSTEMD_OBSERVER_UNIT];
  renderedUnitDigests: FhvSystemdRenderedUnitDigestsV1;
  installedAtUtc: string;
  operatorId: string;
  serviceUser: string;
  legacyContainerName: typeof FHV_SYSTEMD_LEGACY_CONTAINER_NAME;
  legacyContainerImage: typeof FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE;
  legacyContainerRunning: boolean;
  writerVersion: typeof FHV_SYSTEMD_RECORD_WRITER_VERSION;
  contentDigest: string;
}>;

export type FhvSystemdDeployedRevisionInput = Readonly<{
  releaseSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  renderedUnitDigests: FhvSystemdRenderedUnitDigestsV1;
  installedAtUtc: string;
  operatorId: string;
  serviceUser: string;
  legacyContainerRunning: boolean;
}>;

export class FhvSystemdDeployedRevisionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvSystemdDeployedRevisionError";
  }
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const DIGEST_HEX = /^[0-9a-f]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_RUN_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;

export function resolveFhvSystemdDeployedRevisionPath(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.FHV_SYSTEMD_DEPLOYED_REVISION_PATH?.trim();
  if (override) {
    return override;
  }
  return join(repoRoot, ".ops", FHV_SYSTEMD_DEPLOYED_REVISION_FILENAME);
}

function digestRevisionPayload(
  record: Omit<FhvSystemdDeployedRevisionV1, "contentDigest">,
): string {
  return computePayloadDigest(record);
}

export function assertFhvSystemdDeployedRevisionReleaseSha(releaseSha: string): string {
  const normalized = releaseSha.trim();
  if (!FULL_SHA.test(normalized)) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_SHA_INVALID",
      "releaseSha must be a 40-character lowercase hex SHA.",
    );
  }
  return normalized;
}

function assertRenderedUnitDigests(
  renderedUnitDigests: FhvSystemdRenderedUnitDigestsV1,
): FhvSystemdRenderedUnitDigestsV1 {
  for (const unit of FHV_SYSTEMD_ALLOWED_UNITS) {
    const digest = renderedUnitDigests[unit]?.trim();
    if (!digest || !DIGEST_HEX.test(digest)) {
      throw new FhvSystemdDeployedRevisionError(
        "FHV_SYSTEMD_REVISION_UNIT_DIGEST_INVALID",
        `renderedUnitDigests[${unit}] must be a 64-character lowercase hex digest.`,
      );
    }
  }
  return renderedUnitDigests;
}

export function serializeFhvSystemdDeployedRevision(
  input: FhvSystemdDeployedRevisionInput,
): FhvSystemdDeployedRevisionV1 {
  const releaseSha = assertFhvSystemdDeployedRevisionReleaseSha(input.releaseSha);
  if (!input.releaseTag.trim()) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_RELEASE_TAG_REQUIRED",
      "releaseTag is required.",
    );
  }
  if (!SAFE_RUN_ID.test(input.runId.trim())) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_RUN_ID_INVALID",
      "runId format is invalid.",
    );
  }
  if (!UUID_V4.test(input.organizationId.trim())) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_ORG_INVALID",
      "organizationId must be a UUID.",
    );
  }
  if (!input.operatorId.trim()) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_OPERATOR_REQUIRED",
      "operatorId is required.",
    );
  }
  if (!input.serviceUser.trim()) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_SERVICE_USER_REQUIRED",
      "serviceUser is required.",
    );
  }
  if (!input.installedAtUtc.trim()) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_INSTALLED_AT_REQUIRED",
      "installedAtUtc is required.",
    );
  }

  const renderedUnitDigests = assertRenderedUnitDigests(input.renderedUnitDigests);
  const withoutDigest = {
    schemaVersion: FHV_SYSTEMD_DEPLOYED_REVISION_SCHEMA_VERSION,
    releaseSha,
    releaseTag: input.releaseTag.trim(),
    runId: input.runId.trim(),
    organizationId: input.organizationId.trim(),
    deploymentKind: FHV_SYSTEMD_DEPLOYMENT_KIND,
    installedUnitNames: [FHV_SYSTEMD_CAMPAIGN_UNIT, FHV_SYSTEMD_OBSERVER_UNIT] as const,
    renderedUnitDigests,
    installedAtUtc: input.installedAtUtc,
    operatorId: input.operatorId.trim(),
    serviceUser: input.serviceUser.trim(),
    legacyContainerName: FHV_SYSTEMD_LEGACY_CONTAINER_NAME,
    legacyContainerImage: FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE,
    legacyContainerRunning: input.legacyContainerRunning,
    writerVersion: FHV_SYSTEMD_RECORD_WRITER_VERSION,
  };
  return { ...withoutDigest, contentDigest: digestRevisionPayload(withoutDigest) };
}

export function previewFhvSystemdDeployedRevision(
  input: FhvSystemdDeployedRevisionInput,
): FhvSystemdDeployedRevisionV1 {
  return serializeFhvSystemdDeployedRevision(input);
}

export function readFhvSystemdDeployedRevision(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): FhvSystemdDeployedRevisionV1 | null {
  const path = resolveFhvSystemdDeployedRevisionPath(repoRoot, env);
  if (!existsSync(path)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as FhvSystemdDeployedRevisionV1;
  verifyFhvSystemdDeployedRevisionRecord(parsed);
  return parsed;
}

export function verifyFhvSystemdDeployedRevisionRecord(record: FhvSystemdDeployedRevisionV1): void {
  if (record.schemaVersion !== FHV_SYSTEMD_DEPLOYED_REVISION_SCHEMA_VERSION) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_SCHEMA_MISMATCH",
      "Schema version mismatch.",
    );
  }
  if (record.deploymentKind !== FHV_SYSTEMD_DEPLOYMENT_KIND) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_DEPLOYMENT_KIND_MISMATCH",
      "deploymentKind mismatch.",
    );
  }
  assertFhvSystemdDeployedRevisionReleaseSha(record.releaseSha);
  if (!record.releaseTag.trim()) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_RELEASE_TAG_REQUIRED",
      "releaseTag is required.",
    );
  }
  if (!SAFE_RUN_ID.test(record.runId.trim())) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_RUN_ID_INVALID",
      "runId format is invalid.",
    );
  }
  if (!UUID_V4.test(record.organizationId.trim())) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_ORG_INVALID",
      "organizationId must be a UUID.",
    );
  }
  if (record.legacyContainerName !== FHV_SYSTEMD_LEGACY_CONTAINER_NAME) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_LEGACY_CONTAINER_MISMATCH",
      "legacyContainerName mismatch.",
    );
  }
  if (record.legacyContainerImage !== FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_LEGACY_IMAGE_MISMATCH",
      "legacyContainerImage mismatch.",
    );
  }
  if (record.legacyContainerRunning !== true) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_LEGACY_CONTAINER_NOT_RUNNING",
      "legacyContainerRunning must be true at write time.",
    );
  }
  if (
    record.installedUnitNames.length !== 2 ||
    record.installedUnitNames[0] !== FHV_SYSTEMD_CAMPAIGN_UNIT ||
    record.installedUnitNames[1] !== FHV_SYSTEMD_OBSERVER_UNIT
  ) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_UNITS_MISMATCH",
      "installedUnitNames mismatch.",
    );
  }
  assertRenderedUnitDigests(record.renderedUnitDigests);
  if (record.writerVersion !== FHV_SYSTEMD_RECORD_WRITER_VERSION) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_WRITER_VERSION_MISMATCH",
      "writerVersion mismatch.",
    );
  }
  const { contentDigest, ...withoutDigest } = record;
  if (digestRevisionPayload(withoutDigest) !== contentDigest) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_DIGEST_MISMATCH",
      "contentDigest mismatch.",
    );
  }
}

export function writeFhvSystemdDeployedRevisionAtomic(
  repoRoot: string,
  input: FhvSystemdDeployedRevisionInput,
  options?: {
    env?: NodeJS.ProcessEnv;
    writeAtomic?: (path: string, content: string) => void;
  },
): FhvSystemdDeployedRevisionV1 {
  const record = serializeFhvSystemdDeployedRevision(input);
  const path = resolveFhvSystemdDeployedRevisionPath(repoRoot, options?.env);
  mkdirSync(dirname(path), { recursive: true });
  const write = options?.writeAtomic ?? writeFileAtomic;
  write(path, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function verifyFhvSystemdDeployedRevisionMatchesTarget(input: {
  repoRoot: string;
  targetSha: string;
  releaseTag?: string;
  runId?: string;
  organizationId?: string;
  serviceUser?: string;
  renderedUnitDigests?: FhvSystemdRenderedUnitDigestsV1;
  env?: NodeJS.ProcessEnv;
}): FhvSystemdDeployedRevisionV1 {
  const targetSha = assertFhvSystemdDeployedRevisionReleaseSha(input.targetSha);
  const record = readFhvSystemdDeployedRevision(input.repoRoot, input.env);
  if (!record) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_MISSING",
      "FHV systemd deployed-revision record not found.",
    );
  }
  if (record.releaseSha !== targetSha) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_SHA_MISMATCH",
      "FHV systemd deployed-revision releaseSha does not match target SHA.",
    );
  }
  if (input.releaseTag !== undefined && record.releaseTag !== input.releaseTag.trim()) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_RELEASE_TAG_MISMATCH",
      "releaseTag mismatch.",
    );
  }
  if (input.runId !== undefined && record.runId !== input.runId.trim()) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_RUN_ID_MISMATCH",
      "runId mismatch.",
    );
  }
  if (input.organizationId !== undefined && record.organizationId !== input.organizationId.trim()) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_ORG_MISMATCH",
      "organizationId mismatch.",
    );
  }
  if (input.serviceUser !== undefined && record.serviceUser !== input.serviceUser.trim()) {
    throw new FhvSystemdDeployedRevisionError(
      "FHV_SYSTEMD_REVISION_SERVICE_USER_MISMATCH",
      "serviceUser mismatch.",
    );
  }
  if (input.renderedUnitDigests !== undefined) {
    for (const unit of FHV_SYSTEMD_ALLOWED_UNITS) {
      if (record.renderedUnitDigests[unit] !== input.renderedUnitDigests[unit]) {
        throw new FhvSystemdDeployedRevisionError(
          "FHV_SYSTEMD_REVISION_RENDERED_DIGEST_MISMATCH",
          `renderedUnitDigests[${unit}] mismatch.`,
        );
      }
    }
  }
  return record;
}

/** @deprecated use releaseSha — retained for transitional call sites */
export function assertFhvSystemdDeployedRevisionGitSha(gitSha: string): string {
  return assertFhvSystemdDeployedRevisionReleaseSha(gitSha);
}
