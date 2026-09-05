import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";

import {
  parseHistoricalSimulationLaunchConsumerCliEnvV2,
  type HistoricalSimulationLaunchConsumerCliConfigV2,
} from "./launch-consumer-cli-v2";
import type { HistoricalExecutionServerBootstrapResultV2 } from
  "./execution-server-bootstrap-v2";
import type { HistoricalProductionFirstCycleBootstrapInputV2 } from
  "./production-first-cycle-bootstrap-v2";
import type { HistoricalSimulationRunLifecycleEventV2 } from "./run-lifecycle-v2";

export const HISTORICAL_EXECUTION_SERVER_BOOTSTRAP_MANIFEST_V2 =
  "waia.trader.historical_execution_server_bootstrap_manifest.v2" as const;

type CliEnvironment = Readonly<Record<string, string | undefined>>;

export type HistoricalExecutionServerLaunchCliConfigV2 =
  HistoricalSimulationLaunchConsumerCliConfigV2 & Readonly<{
    manifestPath: string;
    manifestContentDigestHex: string;
  }>;

export type HistoricalExecutionServerBootstrapManifestV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_EXECUTION_SERVER_BOOTSTRAP_MANIFEST_V2;
  bootstrap: HistoricalProductionFirstCycleBootstrapInputV2;
  contentDigestHex: string;
}>;

export type HistoricalExecutionServerLaunchCliResultV2 = Readonly<{
  bootstrap: HistoricalExecutionServerBootstrapResultV2;
  lifecycle: HistoricalSimulationRunLifecycleEventV2;
}>;

export type HistoricalExecutionServerLaunchCliDependenciesV2 = Readonly<{
  readManifest(path: string): Promise<string>;
  bootstrapAndQueue(
    databaseUrl: string,
    input: HistoricalProductionFirstCycleBootstrapInputV2,
  ): Promise<HistoricalExecutionServerBootstrapResultV2>;
  consume(
    env: CliEnvironment,
    signal?: AbortSignal,
  ): Promise<HistoricalSimulationRunLifecycleEventV2>;
}>;

const DIGEST = /^[0-9a-f]{64}$/;
const INPUT_KEYS = [
  "accountId",
  "cycleCount",
  "defaultQuantity",
  "initialRecordIndex",
  "policyConfig",
  "preflight",
  "primaryHorizonMinutes",
  "ratifiedAuthorityId",
  "startingCashUsdt",
  "symbol",
] as const;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_EXECUTION_SERVER_LAUNCH_REFUSED:${code}`);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index]);
}

export function parseHistoricalExecutionServerLaunchCliEnvV2(
  env: CliEnvironment,
): HistoricalExecutionServerLaunchCliConfigV2 {
  const consumer = parseHistoricalSimulationLaunchConsumerCliEnvV2(env);
  const manifestPath = env.WAIA_HISTORICAL_BOOTSTRAP_MANIFEST_PATH?.trim();
  const manifestContentDigestHex =
    env.WAIA_HISTORICAL_BOOTSTRAP_MANIFEST_CONTENT_DIGEST?.trim().toLowerCase();
  if (!manifestPath || !manifestPath.startsWith("/")) refuse("MANIFEST_PATH");
  if (!manifestContentDigestHex || !DIGEST.test(manifestContentDigestHex)) {
    refuse("MANIFEST_CONTENT_DIGEST");
  }
  return Object.freeze({ ...consumer, manifestPath, manifestContentDigestHex });
}

export function parseHistoricalExecutionServerBootstrapManifestV2(
  serialized: string,
  expected: HistoricalExecutionServerLaunchCliConfigV2,
): HistoricalProductionFirstCycleBootstrapInputV2 {
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { refuse("MANIFEST_JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      !exactKeys(parsed, ["bootstrap", "contentDigestHex", "schemaVersion"])) {
    refuse("MANIFEST_SHAPE");
  }
  const manifest = parsed as Partial<HistoricalExecutionServerBootstrapManifestV2>;
  if (manifest.schemaVersion !== HISTORICAL_EXECUTION_SERVER_BOOTSTRAP_MANIFEST_V2 ||
      !manifest.bootstrap || typeof manifest.bootstrap !== "object" ||
      Array.isArray(manifest.bootstrap) || !exactKeys(manifest.bootstrap, INPUT_KEYS) ||
      typeof manifest.contentDigestHex !== "string" ||
      !DIGEST.test(manifest.contentDigestHex)) {
    refuse("MANIFEST_SHAPE");
  }
  const computed = computeSemanticSha256Hex({
    schemaVersion: manifest.schemaVersion,
    bootstrap: manifest.bootstrap,
  });
  if (computed !== manifest.contentDigestHex ||
      computed !== expected.manifestContentDigestHex) {
    refuse("MANIFEST_DIGEST");
  }
  const preflight = manifest.bootstrap.preflight;
  if (preflight.organizationId !== expected.organizationId ||
      preflight.runId !== expected.runId ||
      preflight.releaseSha !== expected.releaseSha) {
    refuse("MANIFEST_SCOPE");
  }
  return Object.freeze(manifest.bootstrap);
}

/** Bootstrap, durably queue and consume one WALK_FORWARD run in that order. */
export async function runHistoricalExecutionServerLaunchCliV2(
  env: CliEnvironment,
  dependencies: HistoricalExecutionServerLaunchCliDependenciesV2,
  signal?: AbortSignal,
): Promise<HistoricalExecutionServerLaunchCliResultV2> {
  const config = parseHistoricalExecutionServerLaunchCliEnvV2(env);
  const bootstrapInput = parseHistoricalExecutionServerBootstrapManifestV2(
    await dependencies.readManifest(config.manifestPath),
    config,
  );
  const bootstrap = await dependencies.bootstrapAndQueue(
    config.databaseUrl,
    bootstrapInput,
  );
  const queued = bootstrap.lifecycle;
  if (queued.organizationId !== config.organizationId || queued.runId !== config.runId ||
      queued.partition !== "WALK_FORWARD") {
    refuse("QUEUED_SCOPE");
  }
  const lifecycle = queued.phase === "COMPLETED"
    ? queued
    : await dependencies.consume(env, signal);
  return Object.freeze({ bootstrap, lifecycle });
}
