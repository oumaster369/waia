/**
 * DEE-424 / DEE-436 — FHV rehearsal launcher (repository fixture only).
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  buildFhvRehearsalLaunchConfig,
  materializeFhvRehearsalManifest,
  type FhvRehearsalFixtureId,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ABSOLUTE_SAFE_PATH = /^\/(?:[^\0/]+\/)*[^\0/]+$/;

class FhvRehearsalCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvRehearsalCliError";
  }
}

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      throw new FhvRehearsalCliError("UNKNOWN_ARG", `Unexpected positional argument: ${token}`);
    }
    if (token === "--t4-deterministic-pause") {
      parsed.set(token, true);
      continue;
    }
    const value = argv[index + 1]?.trim();
    if (!value) {
      throw new FhvRehearsalCliError("MISSING_FLAG_VALUE", `Missing value for ${token}`);
    }
    if (parsed.has(token)) {
      throw new FhvRehearsalCliError("DUPLICATE_FLAG", `Duplicate flag: ${token}`);
    }
    parsed.set(token, value);
    index += 1;
  }
  return parsed;
}

export function resolveFhvRehearsalCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): {
  targetSha: string;
  runId: string;
  organizationId: string;
  fixtureId: FhvRehearsalFixtureId;
  artifactRoot: string;
  t4DeterministicPause: boolean;
} {
  const flags = parseArgv(argv);
  const allowed = new Set([
    "--target-sha",
    "--run-id",
    "--organization-id",
    "--fixture",
    "--artifact-root",
    "--t4-deterministic-pause",
  ]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) {
      throw new FhvRehearsalCliError("UNKNOWN_FLAG", `Unknown flag: ${key}`);
    }
  }

  const targetSha = (flags.get("--target-sha") as string | undefined) ?? env.FHV_TARGET_SHA?.trim();
  const runId = (flags.get("--run-id") as string | undefined) ?? env.FHV_RUN_ID?.trim();
  const organizationId =
    (flags.get("--organization-id") as string | undefined) ?? env.FHV_ORGANIZATION_ID?.trim();
  const fixtureId = ((flags.get("--fixture") as string | undefined) ??
    "HTR_WP03_BENCHMARK") as FhvRehearsalFixtureId;
  const artifactRoot =
    (flags.get("--artifact-root") as string | undefined) ?? env.FHV_ARTIFACT_ROOT?.trim();

  if (!targetSha || !FULL_SHA.test(targetSha)) {
    throw new FhvRehearsalCliError("INVALID_TARGET_SHA", "target-sha must be a full git SHA.");
  }
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new FhvRehearsalCliError("INVALID_RUN_ID", "run-id is invalid.");
  }
  if (!organizationId || !UUID_V4.test(organizationId)) {
    throw new FhvRehearsalCliError("INVALID_ORGANIZATION_ID", "organization-id must be UUID v4.");
  }
  if (!artifactRoot || !ABSOLUTE_SAFE_PATH.test(artifactRoot) || artifactRoot.includes("..")) {
    throw new FhvRehearsalCliError(
      "INVALID_ARTIFACT_ROOT",
      "--artifact-root must be an absolute safe path.",
    );
  }

  return {
    targetSha,
    runId,
    organizationId,
    fixtureId,
    artifactRoot,
    t4DeterministicPause: flags.has("--t4-deterministic-pause"),
  };
}

async function main(): Promise<void> {
  const config = resolveFhvRehearsalCliConfig();
  const launchConfig = buildFhvRehearsalLaunchConfig({
    fixtureId: config.fixtureId,
    targetSha: config.targetSha,
    runId: config.runId,
    organizationId: config.organizationId,
    artifactRoot: config.artifactRoot,
    t4DeterministicPause: config.t4DeterministicPause,
  });
  const { runDir, manifestPath } = materializeFhvRehearsalManifest(launchConfig);
  mkdirSync(join(runDir, "streaming-evidence"), { recursive: true });

  const payload = {
    schemaVersion: "fhv-rehearsal-cli-result/v1",
    classification: "REHEARSAL_PREPARED",
    runDir,
    manifestPath,
    alertPolicyDigest: launchConfig.alertPolicyDigest,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

const invokedDirectly = process.argv[1]?.includes("fhv-rehearsal-cli.ts") ?? false;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    const code = error instanceof FhvRehearsalCliError ? error.code : "FAILED";
    process.stderr.write(`[fhv-rehearsal] ${code}: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

export { FhvRehearsalCliError };
