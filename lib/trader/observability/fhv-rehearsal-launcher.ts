import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  HTR_WP03_BENCHMARK_FIXTURE_PATH,
  HTR_WP03_BENCHMARK_FIXTURE_SHA256,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import { computeFhvAlertPolicyDigest } from "@/lib/trader/observability/fhv-alert-policy-v1";
import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";

export const FHV_REHEARSAL_MAX_RUNTIME_MS = 5 * 60 * 1000;

export const FHV_REHEARSAL_ALLOWED_FIXTURES = {
  HTR_WP03_BENCHMARK: {
    fixturePath: HTR_WP03_BENCHMARK_FIXTURE_PATH,
    fixtureSha256: HTR_WP03_BENCHMARK_FIXTURE_SHA256,
    label: "htr-wp03-benchmark",
  },
} as const;

export type FhvRehearsalFixtureId = keyof typeof FHV_REHEARSAL_ALLOWED_FIXTURES;

export type FhvRehearsalLaunchConfigV1 = Readonly<{
  schemaVersion: "fhv-rehearsal-launch/v1";
  fixtureId: FhvRehearsalFixtureId;
  targetSha: string;
  runId: string;
  organizationId: string;
  artifactRoot: string;
  alertPolicyDigest: string;
  maxRuntimeMs: number;
  t4DeterministicPause?: boolean;
  deterministicPauseAtCycle?: number;
}>;

export class FhvRehearsalLaunchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvRehearsalLaunchError";
  }
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ABSOLUTE_SAFE_PATH = /^\/[a-zA-Z0-9@/._-]+$/;

export function resolveFhvRehearsalAlertPolicyDigest(): string {
  return computeFhvAlertPolicyDigest();
}

export function assertFhvRehearsalRunId(runId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(runId)) {
    throw new FhvRehearsalLaunchError(
      "INVALID_RUN_ID",
      "runId must be a bounded lowercase identifier.",
    );
  }
}

export function rejectExternalDatasetPath(datasetPath: string, repoRoot: string): void {
  const normalized = datasetPath.trim();
  if (!normalized) {
    throw new FhvRehearsalLaunchError("DATASET_PATH_REQUIRED", "Dataset path is required.");
  }
  const allowed = Object.values(FHV_REHEARSAL_ALLOWED_FIXTURES).map((entry) => entry.fixturePath);
  if (!allowed.includes(normalized)) {
    throw new FhvRehearsalLaunchError(
      "DATASET_NOT_ALLOWLISTED",
      "Only approved repository fixtures may be used for FHV rehearsal.",
    );
  }
  if (normalized.includes("..")) {
    throw new FhvRehearsalLaunchError("PATH_TRAVERSAL", "Dataset path traversal is rejected.");
  }
  if (!normalized.startsWith(repoRoot)) {
    throw new FhvRehearsalLaunchError(
      "EXTERNAL_DATASET_REJECTED",
      "External or real dataset paths are rejected for rehearsal.",
    );
  }
}

export function resolveFhvRehearsalRunDirectory(artifactRoot: string, runId: string): string {
  assertFhvRehearsalRunId(runId);
  return join(artifactRoot, "RI-P7", "fhv-ops-rehearsal", runId);
}

export function assertFhvRehearsalRunDirectoryAvailable(runDir: string): void {
  if (existsSync(runDir)) {
    throw new FhvRehearsalLaunchError(
      "RUN_DIRECTORY_COLLISION",
      "Rehearsal run directory already exists; refusing silent reuse.",
    );
  }
}

export function buildFhvRehearsalLaunchConfig(input: {
  fixtureId: FhvRehearsalFixtureId;
  targetSha: string;
  runId: string;
  organizationId: string;
  artifactRoot: string;
  maxRuntimeMs?: number;
  t4DeterministicPause?: boolean;
}): FhvRehearsalLaunchConfigV1 {
  if (!FULL_SHA.test(input.targetSha)) {
    throw new FhvRehearsalLaunchError("INVALID_TARGET_SHA", "targetSha must be a full git SHA.");
  }
  assertFhvRehearsalRunId(input.runId);
  const fixture = FHV_REHEARSAL_ALLOWED_FIXTURES[input.fixtureId];
  rejectExternalDatasetPath(fixture.fixturePath, process.cwd());
  const runDir = resolveFhvRehearsalRunDirectory(input.artifactRoot, input.runId);
  assertFhvRehearsalRunDirectoryAvailable(runDir);
  const maxRuntimeMs = input.maxRuntimeMs ?? FHV_REHEARSAL_MAX_RUNTIME_MS;
  if (maxRuntimeMs <= 0 || maxRuntimeMs > FHV_REHEARSAL_MAX_RUNTIME_MS) {
    throw new FhvRehearsalLaunchError(
      "INVALID_MAX_RUNTIME",
      `Rehearsal runtime must be >0 and <= ${FHV_REHEARSAL_MAX_RUNTIME_MS}ms.`,
    );
  }
  return {
    schemaVersion: "fhv-rehearsal-launch/v1",
    fixtureId: input.fixtureId,
    targetSha: input.targetSha,
    runId: input.runId,
    organizationId: input.organizationId,
    artifactRoot: input.artifactRoot,
    alertPolicyDigest: resolveFhvRehearsalAlertPolicyDigest(),
    maxRuntimeMs,
    ...(input.t4DeterministicPause
      ? {
          t4DeterministicPause: true as const,
          deterministicPauseAtCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
        }
      : {}),
  };
}

export function materializeFhvRehearsalManifest(config: FhvRehearsalLaunchConfigV1): {
  runDir: string;
  manifestPath: string;
} {
  const runDir = resolveFhvRehearsalRunDirectory(config.artifactRoot, config.runId);
  mkdirSync(join(runDir, "control"), { recursive: true });
  const manifestPath = join(runDir, "fhv-rehearsal-manifest.v1.json");
  writeFileSync(manifestPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { runDir, manifestPath };
}

const MANIFEST_OPTIONAL_FIELDS = ["t4DeterministicPause", "deterministicPauseAtCycle"] as const;

const MANIFEST_REQUIRED_FIELDS = [
  "schemaVersion",
  "fixtureId",
  "targetSha",
  "runId",
  "organizationId",
  "artifactRoot",
  "alertPolicyDigest",
  "maxRuntimeMs",
] as const;

function assertAbsoluteSafeArtifactPath(field: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    !ABSOLUTE_SAFE_PATH.test(value) ||
    value.includes("..")
  ) {
    throw new FhvRehearsalLaunchError(
      "INVALID_ARTIFACT_ROOT",
      `${field} must be an absolute safe path.`,
    );
  }
  return value;
}

export function validateFhvRehearsalManifestAtRuntime(input: {
  runRoot: string;
  raw?: unknown;
}): FhvRehearsalLaunchConfigV1 {
  let parsed: Record<string, unknown>;
  if (input.raw !== undefined) {
    if (typeof input.raw !== "object" || input.raw === null || Array.isArray(input.raw)) {
      throw new FhvRehearsalLaunchError(
        "MANIFEST_INVALID_JSON",
        "Rehearsal manifest must be a JSON object.",
      );
    }
    parsed = input.raw as Record<string, unknown>;
  } else {
    const manifestPath = join(input.runRoot, "fhv-rehearsal-manifest.v1.json");
    if (!existsSync(manifestPath)) {
      throw new FhvRehearsalLaunchError("MANIFEST_MISSING", "Rehearsal manifest not found.");
    }
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    } catch {
      throw new FhvRehearsalLaunchError(
        "MANIFEST_INVALID_JSON",
        "Rehearsal manifest is not valid JSON.",
      );
    }
  }

  const allowedKeys = new Set<string>([...MANIFEST_REQUIRED_FIELDS, ...MANIFEST_OPTIONAL_FIELDS]);
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) {
      throw new FhvRehearsalLaunchError(
        "MANIFEST_UNKNOWN_FIELD",
        `Rehearsal manifest contains unknown field: ${key}`,
      );
    }
  }
  for (const field of MANIFEST_REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      throw new FhvRehearsalLaunchError(
        "MANIFEST_MISSING_FIELD",
        `Rehearsal manifest missing required field: ${field}`,
      );
    }
  }

  if (parsed.schemaVersion !== "fhv-rehearsal-launch/v1") {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_SCHEMA_MISMATCH",
      "Rehearsal manifest schemaVersion mismatch.",
    );
  }

  const fixtureId = parsed.fixtureId;
  if (typeof fixtureId !== "string" || !(fixtureId in FHV_REHEARSAL_ALLOWED_FIXTURES)) {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_FIXTURE_NOT_ALLOWLISTED",
      "fixtureId must belong to FHV_REHEARSAL_ALLOWED_FIXTURES.",
    );
  }

  const targetSha = parsed.targetSha;
  if (typeof targetSha !== "string" || !FULL_SHA.test(targetSha)) {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_INVALID_TARGET_SHA",
      "targetSha must be a full lowercase 40-character git SHA.",
    );
  }

  const runId = parsed.runId;
  if (typeof runId !== "string") {
    throw new FhvRehearsalLaunchError("MANIFEST_INVALID_RUN_ID", "runId must be a string.");
  }
  assertFhvRehearsalRunId(runId);

  const organizationId = parsed.organizationId;
  if (typeof organizationId !== "string" || !UUID_V4.test(organizationId)) {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_INVALID_ORGANIZATION_ID",
      "organizationId must be a valid UUID.",
    );
  }

  const artifactRoot = assertAbsoluteSafeArtifactPath("artifactRoot", parsed.artifactRoot);

  const alertPolicyDigest = parsed.alertPolicyDigest;
  if (typeof alertPolicyDigest !== "string" || !/^[0-9a-f]{64}$/.test(alertPolicyDigest)) {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_INVALID_ALERT_POLICY_DIGEST",
      "alertPolicyDigest must be a 64-character hex digest.",
    );
  }
  if (alertPolicyDigest !== resolveFhvRehearsalAlertPolicyDigest()) {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_ALERT_POLICY_DIGEST_MISMATCH",
      "alertPolicyDigest does not match the current pinned policy digest.",
    );
  }

  const maxRuntimeMs = parsed.maxRuntimeMs;
  if (typeof maxRuntimeMs !== "number" || !Number.isFinite(maxRuntimeMs)) {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_INVALID_MAX_RUNTIME",
      "maxRuntimeMs must be a finite number.",
    );
  }
  if (maxRuntimeMs <= 0 || maxRuntimeMs > FHV_REHEARSAL_MAX_RUNTIME_MS) {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_MAX_RUNTIME_OUT_OF_BOUNDS",
      `maxRuntimeMs must be >0 and <= ${FHV_REHEARSAL_MAX_RUNTIME_MS}.`,
    );
  }

  const expectedRunRoot = resolveFhvRehearsalRunDirectory(artifactRoot, runId);
  const normalizedRunRoot = input.runRoot.replace(/\/+$/, "");
  const normalizedExpected = expectedRunRoot.replace(/\/+$/, "");
  if (normalizedRunRoot !== normalizedExpected) {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_RUN_ROOT_MISMATCH",
      "runRoot does not match artifactRoot canonical run path.",
    );
  }

  const fixture = FHV_REHEARSAL_ALLOWED_FIXTURES[fixtureId as FhvRehearsalFixtureId];
  rejectExternalDatasetPath(fixture.fixturePath, process.cwd());

  const t4DeterministicPause = parsed.t4DeterministicPause === true;
  const deterministicPauseAtCycle =
    parsed.deterministicPauseAtCycle === undefined
      ? undefined
      : Number(parsed.deterministicPauseAtCycle);
  if (t4DeterministicPause) {
    if (deterministicPauseAtCycle !== FHV_REHEARSAL_CHECKPOINT_CYCLE) {
      throw new FhvRehearsalLaunchError(
        "MANIFEST_T4_PAUSE_CYCLE_INVALID",
        `deterministicPauseAtCycle must be ${FHV_REHEARSAL_CHECKPOINT_CYCLE} when t4DeterministicPause is true.`,
      );
    }
    if (fixtureId !== "HTR_WP03_BENCHMARK") {
      throw new FhvRehearsalLaunchError(
        "MANIFEST_T4_FIXTURE_INVALID",
        "T4 deterministic pause requires HTR_WP03_BENCHMARK fixture.",
      );
    }
  } else if (parsed.t4DeterministicPause !== undefined && parsed.t4DeterministicPause !== false) {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_T4_FLAG_INVALID",
      "t4DeterministicPause must be boolean.",
    );
  } else if (deterministicPauseAtCycle !== undefined) {
    throw new FhvRehearsalLaunchError(
      "MANIFEST_T4_PAUSE_CYCLE_WITHOUT_FLAG",
      "deterministicPauseAtCycle requires t4DeterministicPause=true.",
    );
  }

  return {
    schemaVersion: "fhv-rehearsal-launch/v1",
    fixtureId: fixtureId as FhvRehearsalFixtureId,
    targetSha,
    runId,
    organizationId,
    artifactRoot,
    alertPolicyDigest,
    maxRuntimeMs,
    ...(t4DeterministicPause
      ? {
          t4DeterministicPause: true as const,
          deterministicPauseAtCycle: FHV_REHEARSAL_CHECKPOINT_CYCLE,
        }
      : {}),
  };
}

export function readFhvRehearsalManifest(runDir: string): FhvRehearsalLaunchConfigV1 {
  return validateFhvRehearsalManifestAtRuntime({ runRoot: runDir });
}

export function computeFhvRehearsalTerminalClassification(input: {
  terminalState: string;
  elapsedMs: number;
  maxRuntimeMs: number;
}): "REHEARSAL_OK" | "REHEARSAL_TIMEOUT" | "REHEARSAL_FAILED" {
  if (input.elapsedMs > input.maxRuntimeMs) {
    return "REHEARSAL_TIMEOUT";
  }
  if (input.terminalState === "BENCHMARK_OK" || input.terminalState === "REHEARSAL_OK") {
    return "REHEARSAL_OK";
  }
  return "REHEARSAL_FAILED";
}

export function digestFhvRehearsalEvidence(runDir: string): string {
  const manifest = readFhvRehearsalManifest(runDir);
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}
