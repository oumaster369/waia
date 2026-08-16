import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  FHV_FULL_HISTORICAL_PROGRESS_CYCLE_AMORTIZATION,
  resolveFhvFullHistoricalProgressIntervalMs,
} from "@/lib/trader/observability/fhv-full-historical-progress";

/**
 * Qualifier-owned sampling contract (ADR-0025 AD-6b).
 *
 * Official throughput evidence must not become weaker because the calling shell inherited
 * `FHV_IDHPS_PROGRESS_INTERVAL_MS`. An external interval may only sample more frequently.
 */
export const FHV_THROUGHPUT_QUALIFIER_SAMPLER_CONTRACT_VERSION =
  "fhv-throughput-qualifier-sampler/v1" as const;

/** Wall-clock ceiling for official/representative qualifier sampling. */
export const FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS = 250;

export const FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES = 6;
export const FHV_THROUGHPUT_QUALIFIER_MIN_HOT_WINDOWS = 4;
export const FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES = 2;

export type FhvThroughputQualifierSamplerContract = Readonly<{
  version: typeof FHV_THROUGHPUT_QUALIFIER_SAMPLER_CONTRACT_VERSION;
  maxIntervalMs: typeof FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS;
  appliedIntervalMs: number;
  cycleAmortization: typeof FHV_FULL_HISTORICAL_PROGRESS_CYCLE_AMORTIZATION;
  minProgressSamples: typeof FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES;
  minHotWindows: typeof FHV_THROUGHPUT_QUALIFIER_MIN_HOT_WINDOWS;
  minCheckpointSamples: typeof FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES;
}>;

/**
 * Clamp observational cadence so an inherited env value cannot exceed the qualifier ceiling.
 * `0` remains legal (sample every amortized cycle) because it is stronger, not weaker.
 */
export function resolveFhvThroughputQualifierProgressIntervalMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const observational = resolveFhvFullHistoricalProgressIntervalMs(env);
  return Math.min(observational, FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS);
}

export function buildFhvThroughputQualifierSamplerContract(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FhvThroughputQualifierSamplerContract {
  return {
    version: FHV_THROUGHPUT_QUALIFIER_SAMPLER_CONTRACT_VERSION,
    maxIntervalMs: FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS,
    appliedIntervalMs: resolveFhvThroughputQualifierProgressIntervalMs(env),
    cycleAmortization: FHV_FULL_HISTORICAL_PROGRESS_CYCLE_AMORTIZATION,
    minProgressSamples: FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES,
    minHotWindows: FHV_THROUGHPUT_QUALIFIER_MIN_HOT_WINDOWS,
    minCheckpointSamples: FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES,
  };
}

export function isFhvThroughputQualifierSamplingRequired(input: {
  maxCycles?: number | null;
  boundedFixture?: boolean;
}): boolean {
  return input.boundedFixture !== true && input.maxCycles != null;
}

export class FhvThroughputSamplerContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvThroughputSamplerContractError";
  }
}

/**
 * Validate the canonical sampler contract fields, not only `version`.
 * Environment variables never enter this function and cannot weaken the contract.
 */
export function assertCanonicalFhvThroughputSamplerContract(
  contract:
    | {
        version?: string;
        maxIntervalMs?: number;
        appliedIntervalMs?: number;
        cycleAmortization?: number;
        minProgressSamples?: number;
        minHotWindows?: number;
        minCheckpointSamples?: number;
      }
    | null
    | undefined,
): FhvThroughputQualifierSamplerContract {
  if (!contract) {
    throw new FhvThroughputSamplerContractError(
      "FHV_THROUGHPUT_SAMPLER_CONTRACT_MISSING",
      "Throughput sampler contract is missing",
    );
  }
  if (contract.version !== FHV_THROUGHPUT_QUALIFIER_SAMPLER_CONTRACT_VERSION) {
    throw new FhvThroughputSamplerContractError(
      "FHV_THROUGHPUT_SAMPLER_CONTRACT_VERSION_MISMATCH",
      `sampler version ${String(contract.version)} != ${FHV_THROUGHPUT_QUALIFIER_SAMPLER_CONTRACT_VERSION}`,
    );
  }
  if (contract.maxIntervalMs !== FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS) {
    throw new FhvThroughputSamplerContractError(
      "FHV_THROUGHPUT_SAMPLER_MAX_INTERVAL_WEAKENED",
      `maxIntervalMs ${String(contract.maxIntervalMs)} != ${FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS}`,
    );
  }
  const appliedIntervalMs = contract.appliedIntervalMs;
  if (
    appliedIntervalMs == null ||
    !Number.isFinite(appliedIntervalMs) ||
    appliedIntervalMs < 0 ||
    appliedIntervalMs > FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS
  ) {
    throw new FhvThroughputSamplerContractError(
      "FHV_THROUGHPUT_SAMPLER_APPLIED_INTERVAL_OUT_OF_RANGE",
      `appliedIntervalMs ${String(appliedIntervalMs)} not in [0, ${FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS}]`,
    );
  }
  if (contract.cycleAmortization !== FHV_FULL_HISTORICAL_PROGRESS_CYCLE_AMORTIZATION) {
    throw new FhvThroughputSamplerContractError(
      "FHV_THROUGHPUT_SAMPLER_CYCLE_AMORTIZATION_MISMATCH",
      `cycleAmortization ${String(contract.cycleAmortization)} != ${FHV_FULL_HISTORICAL_PROGRESS_CYCLE_AMORTIZATION}`,
    );
  }
  if (contract.minProgressSamples !== FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES) {
    throw new FhvThroughputSamplerContractError(
      "FHV_THROUGHPUT_SAMPLER_MIN_PROGRESS_WEAKENED",
      `minProgressSamples ${String(contract.minProgressSamples)} != ${FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES}`,
    );
  }
  if (contract.minHotWindows !== FHV_THROUGHPUT_QUALIFIER_MIN_HOT_WINDOWS) {
    throw new FhvThroughputSamplerContractError(
      "FHV_THROUGHPUT_SAMPLER_MIN_HOT_WINDOWS_WEAKENED",
      `minHotWindows ${String(contract.minHotWindows)} != ${FHV_THROUGHPUT_QUALIFIER_MIN_HOT_WINDOWS}`,
    );
  }
  if (contract.minCheckpointSamples !== FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES) {
    throw new FhvThroughputSamplerContractError(
      "FHV_THROUGHPUT_SAMPLER_MIN_CHECKPOINT_WEAKENED",
      `minCheckpointSamples ${String(contract.minCheckpointSamples)} != ${FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES}`,
    );
  }
  return {
    version: FHV_THROUGHPUT_QUALIFIER_SAMPLER_CONTRACT_VERSION,
    maxIntervalMs: FHV_THROUGHPUT_QUALIFIER_MAX_INTERVAL_MS,
    appliedIntervalMs,
    cycleAmortization: FHV_FULL_HISTORICAL_PROGRESS_CYCLE_AMORTIZATION,
    minProgressSamples: FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES,
    minHotWindows: FHV_THROUGHPUT_QUALIFIER_MIN_HOT_WINDOWS,
    minCheckpointSamples: FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES,
  };
}
