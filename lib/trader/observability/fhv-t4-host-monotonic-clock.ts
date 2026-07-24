/**
 * DEE-436 — Linux host monotonic clock contract (CLOCK_BOOTTIME + boot_id).
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

export const FHV_T4_HOST_MONOTONIC_SAMPLE_SCHEMA_VERSION =
  "fhv-t4-host-monotonic-sample/v1" as const;
export const FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS = 300_000 as const;

export type FhvT4HostMonotonicSampleV1 = Readonly<{
  schemaVersion: typeof FHV_T4_HOST_MONOTONIC_SAMPLE_SCHEMA_VERSION;
  clockSource: "CLOCK_BOOTTIME";
  bootId: string;
  monotonicNs: string;
}>;

export class FhvT4HostMonotonicClockError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4HostMonotonicClockError";
  }
}

const BOOT_ID_PATTERN = /^[0-9a-f]{32}$/;

export type FhvT4HostMonotonicReader = () => FhvT4HostMonotonicSampleV1;

let readerOverride: FhvT4HostMonotonicReader | null = null;

export function setFhvT4HostMonotonicReaderForTests(reader: FhvT4HostMonotonicReader | null): void {
  readerOverride = reader;
}

export function parseFhvT4HostMonotonicSample(raw: unknown): FhvT4HostMonotonicSampleV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4HostMonotonicClockError(
      "FHV_T4_HOST_MONOTONIC_INVALID",
      "Host monotonic sample must be an object.",
    );
  }
  const sample = raw as FhvT4HostMonotonicSampleV1;
  if (sample.schemaVersion !== FHV_T4_HOST_MONOTONIC_SAMPLE_SCHEMA_VERSION) {
    throw new FhvT4HostMonotonicClockError(
      "FHV_T4_HOST_MONOTONIC_SCHEMA_MISMATCH",
      "Host monotonic schemaVersion mismatch.",
    );
  }
  if (sample.clockSource !== "CLOCK_BOOTTIME") {
    throw new FhvT4HostMonotonicClockError(
      "FHV_T4_HOST_MONOTONIC_CLOCK_SOURCE_INVALID",
      "clockSource must be CLOCK_BOOTTIME.",
    );
  }
  if (!BOOT_ID_PATTERN.test(sample.bootId.trim())) {
    throw new FhvT4HostMonotonicClockError(
      "FHV_T4_HOST_MONOTONIC_BOOT_ID_INVALID",
      "bootId must be a 32-char lowercase hex string.",
    );
  }
  if (!/^\d+$/.test(sample.monotonicNs.trim())) {
    throw new FhvT4HostMonotonicClockError(
      "FHV_T4_HOST_MONOTONIC_NS_INVALID",
      "monotonicNs must be a decimal integer string.",
    );
  }
  return {
    schemaVersion: sample.schemaVersion,
    clockSource: sample.clockSource,
    bootId: sample.bootId.trim(),
    monotonicNs: sample.monotonicNs.trim(),
  };
}

export function readFhvT4HostMonotonicSample(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): FhvT4HostMonotonicSampleV1 {
  if (readerOverride) {
    return readerOverride();
  }
  const injected = env.FHV_T4_HOST_MONOTONIC_JSON?.trim();
  if (injected) {
    return parseFhvT4HostMonotonicSample(JSON.parse(injected));
  }
  const script = join(repoRoot, "scripts/ops/fhv-t4-host-monotonic-read.sh");
  const output = execFileSync("bash", [script], { encoding: "utf8" }).trim();
  return parseFhvT4HostMonotonicSample(JSON.parse(output));
}

export function elapsedFhvT4HostMonotonicNs(
  startedMonotonicNs: string,
  completedMonotonicNs: string,
): bigint {
  const started = BigInt(startedMonotonicNs);
  const completed = BigInt(completedMonotonicNs);
  if (completed < started) {
    throw new FhvT4HostMonotonicClockError(
      "FHV_T4_HOST_MONOTONIC_ELAPSED_NEGATIVE",
      "completedMonotonicNs must be >= startedMonotonicNs.",
    );
  }
  return completed - started;
}

export function assertFhvT4HostMonotonicBudget(input: {
  hostBootId: string;
  startedMonotonicNs: string;
  completedMonotonicNs: string;
  expectedBootId: string;
  maxBudgetMs?: number;
}): { elapsedMs: number } {
  if (input.hostBootId !== input.expectedBootId) {
    throw new FhvT4HostMonotonicClockError(
      "FHV_T4_HOST_MONOTONIC_BOOT_ID_CHANGED",
      "Host boot ID changed; campaign budget is invalid across reboot.",
    );
  }
  const elapsedNs = elapsedFhvT4HostMonotonicNs(
    input.startedMonotonicNs,
    input.completedMonotonicNs,
  );
  const elapsedMs = Number(elapsedNs / 1_000_000n);
  const maxMs = input.maxBudgetMs ?? FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new FhvT4HostMonotonicClockError(
      "FHV_T4_HOST_MONOTONIC_ELAPSED_INVALID",
      "Elapsed monotonic duration invalid.",
    );
  }
  if (elapsedMs > maxMs) {
    throw new FhvT4HostMonotonicClockError(
      "FHV_T4_HOST_MONOTONIC_BUDGET_EXCEEDED",
      `Shared campaign budget exceeded: ${elapsedMs}ms > ${maxMs}ms.`,
    );
  }
  return { elapsedMs };
}
