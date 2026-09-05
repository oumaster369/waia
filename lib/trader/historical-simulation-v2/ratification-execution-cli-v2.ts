import type { HistoricalExecutionServerBootstrapResultV2 } from
  "./execution-server-bootstrap-v2";
import { parseHistoricalSimulationLaunchConsumerCliEnvV2 } from
  "./launch-consumer-cli-v2";
import type { HistoricalSimulationRunLifecycleEventV2 } from "./run-lifecycle-v2";
import type { KmFourSurfaceProductionPreflightInputV2 } from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-preflight-v2";
import type {
  HistoricalExecutionServerBootstrapManifestV2,
} from "./execution-server-launch-cli-v2";
import {
  CURRENT_FHV_FIRST_ECONOMIC_RECORD_INDEX_V2,
  type HistoricalTechnicalLaunchPlanV2,
} from "./ratification-split-v2";

type CliEnvironment = Readonly<Record<string, string | undefined>>;

export type HistoricalTechnicalProposalCliConfigV2 = Readonly<{
  databaseUrl: string;
  preflight: KmFourSurfaceProductionPreflightInputV2;
  launchPlan: HistoricalTechnicalLaunchPlanV2;
}>;

export type ApprovedHistoricalLaunchCliConfigV2 = Readonly<{
  databaseUrl: string; organizationId: string; runId: string; releaseSha: string;
}>;

const POSITIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_RATIFICATION_EXECUTION_CLI_REFUSED:${code}`);
}

function required(env: CliEnvironment, key: string): string {
  const value = env[key]?.trim();
  if (!value) refuse(key);
  return value;
}

function absolutePath(env: CliEnvironment, key: string): string {
  const value = required(env, key);
  if (!value.startsWith("/") || value.includes("\0")) refuse(key);
  return value;
}

function integer(env: CliEnvironment, key: string, minimum: number): number {
  const value = required(env, key);
  if (!/^\d+$/.test(value)) refuse(key);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) refuse(key);
  return parsed;
}

function positiveNumber(env: CliEnvironment, key: string, allowZero = false): number {
  const value = required(env, key);
  if (!POSITIVE_DECIMAL.test(value)) refuse(key);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) refuse(key);
  return parsed;
}

function positiveDecimal(env: CliEnvironment, key: string): string {
  const value = required(env, key);
  if (!POSITIVE_DECIMAL.test(value) || Number(value) <= 0) refuse(key);
  return value;
}

/** Parses only technical/dataset scope. An operator identity is deliberately impossible here. */
export function parseHistoricalTechnicalProposalCliEnvV2(
  env: CliEnvironment,
): HistoricalTechnicalProposalCliConfigV2 {
  const scope = parseHistoricalSimulationLaunchConsumerCliEnvV2(env);
  const symbol = required(env, "WAIA_HISTORICAL_SYMBOL");
  const horizon = integer(env, "WAIA_HISTORICAL_PRIMARY_HORIZON_MINUTES", 1);
  if (symbol !== "BTCUSDT" && symbol !== "ETHUSDT") refuse("WAIA_HISTORICAL_SYMBOL");
  if (horizon !== 30 && horizon !== 60) {
    refuse("WAIA_HISTORICAL_PRIMARY_HORIZON_MINUTES");
  }
  const preflight: KmFourSurfaceProductionPreflightInputV2 = Object.freeze({
    organizationId: scope.organizationId,
    runId: scope.runId,
    releaseSha: scope.releaseSha,
    datasetRoot: absolutePath(env, "FHV_DATASET_ROOT"),
    qualificationReceiptPath: absolutePath(env, "FHV_PRE_HOLDOUT_QUALIFICATION_RECEIPT_PATH"),
    runtimeRequalificationReceiptPath:
      absolutePath(env, "FHV_RUNTIME_REQUALIFICATION_RECEIPT_PATH"),
    htxVolumeQualificationReceiptPaths: Object.freeze({
      BTCUSDT: absolutePath(env, "FHV_HTX_VOLUME_BTCUSDT_RECEIPT_PATH"),
      ETHUSDT: absolutePath(env, "FHV_HTX_VOLUME_ETHUSDT_RECEIPT_PATH"),
    }),
    initialDevelopmentRecordIndex:
      integer(env, "FHV_INITIAL_DEVELOPMENT_RECORD_INDEX", 0),
    developmentCycleCount: integer(env, "FHV_DEVELOPMENT_CYCLE_COUNT", 1),
    economics: Object.freeze({
      notionalUsdt: positiveNumber(env, "FHV_ECONOMICS_NOTIONAL_USDT"),
      costRate: positiveNumber(env, "FHV_ECONOMICS_COST_RATE", true),
      slippageBufferUsdt: positiveNumber(env, "FHV_ECONOMICS_SLIPPAGE_BUFFER_USDT", true),
      nRefUsdt: positiveNumber(env, "FHV_ECONOMICS_N_REF_USDT"),
    }),
  });
  return Object.freeze({
    databaseUrl: scope.databaseUrl,
    preflight,
    launchPlan: Object.freeze({
      accountId: required(env, "WAIA_HISTORICAL_ACCOUNT_ID"),
      symbol,
      primaryHorizonMinutes: horizon,
      startingCashUsdt: positiveDecimal(env, "WAIA_HISTORICAL_STARTING_CASH_USDT"),
      defaultQuantity: positiveDecimal(env, "WAIA_HISTORICAL_DEFAULT_QUANTITY"),
      // This explicit operator-selected value is checked against the
      // receipt-derived first WF_ECONOMIC record while sealing the proposal.
      initialRecordIndex: integer(env, "WAIA_HISTORICAL_INITIAL_RECORD_INDEX",
        CURRENT_FHV_FIRST_ECONOMIC_RECORD_INDEX_V2),
      cycleCount: integer(env, "WAIA_HISTORICAL_CYCLE_COUNT", 1),
    }),
  });
}

export function parseApprovedHistoricalLaunchCliEnvV2(
  env: CliEnvironment,
): ApprovedHistoricalLaunchCliConfigV2 {
  return parseHistoricalSimulationLaunchConsumerCliEnvV2(env);
}

export async function runHistoricalTechnicalProposalCliV2(
  env: CliEnvironment,
  prepare: (databaseUrl: string, input: Readonly<{
    preflight: KmFourSurfaceProductionPreflightInputV2;
    launchPlan: HistoricalTechnicalLaunchPlanV2;
  }>) => Promise<Readonly<{ id: string; proposal: Readonly<{ contentDigestHex: string }> }>>,
) {
  const config = parseHistoricalTechnicalProposalCliEnvV2(env);
  return prepare(config.databaseUrl, { preflight: config.preflight, launchPlan: config.launchPlan });
}

/** Final authority is loaded from PostgreSQL; the sealed manifest never crosses a manual file. */
export async function runApprovedHistoricalLaunchCliV2(
  env: CliEnvironment,
  dependencies: Readonly<{
    finalize(databaseUrl: string, scope: Omit<ApprovedHistoricalLaunchCliConfigV2,
      "databaseUrl">): Promise<Readonly<{ authorityId: string;
        manifest: HistoricalExecutionServerBootstrapManifestV2 }>>;
    bootstrap(databaseUrl: string,
      manifest: HistoricalExecutionServerBootstrapManifestV2):
      Promise<HistoricalExecutionServerBootstrapResultV2>;
    consume(env: CliEnvironment, signal?: AbortSignal):
      Promise<HistoricalSimulationRunLifecycleEventV2>;
  }>,
  signal?: AbortSignal,
): Promise<Readonly<{ authorityId: string;
  bootstrap: HistoricalExecutionServerBootstrapResultV2;
  lifecycle: HistoricalSimulationRunLifecycleEventV2 }>> {
  const config = parseApprovedHistoricalLaunchCliEnvV2(env);
  const finalized = await dependencies.finalize(config.databaseUrl, {
    organizationId: config.organizationId, runId: config.runId,
    releaseSha: config.releaseSha,
  });
  const bootstrap = await dependencies.bootstrap(config.databaseUrl, finalized.manifest);
  const lifecycle = bootstrap.lifecycle.phase === "COMPLETED"
    ? bootstrap.lifecycle : await dependencies.consume(env, signal);
  return Object.freeze({ authorityId: finalized.authorityId, bootstrap, lifecycle });
}
