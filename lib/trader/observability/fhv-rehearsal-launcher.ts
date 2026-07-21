import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  HTR_WP03_BENCHMARK_FIXTURE_PATH,
  HTR_WP03_BENCHMARK_FIXTURE_SHA256,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import { computeFhvAlertPolicyDigest } from "@/lib/trader/observability/fhv-alert-policy-v1";

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

export function readFhvRehearsalManifest(runDir: string): FhvRehearsalLaunchConfigV1 {
  const manifestPath = join(runDir, "fhv-rehearsal-manifest.v1.json");
  if (!existsSync(manifestPath)) {
    throw new FhvRehearsalLaunchError("MANIFEST_MISSING", "Rehearsal manifest not found.");
  }
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as FhvRehearsalLaunchConfigV1;
  if (parsed.schemaVersion !== "fhv-rehearsal-launch/v1") {
    throw new FhvRehearsalLaunchError("MANIFEST_INVALID", "Rehearsal manifest schema mismatch.");
  }
  return parsed;
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
