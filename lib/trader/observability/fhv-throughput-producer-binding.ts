import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertFhvCleanTrackedHeadCheckout } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import {
  assertCanonicalFhvThroughputSamplerContract,
  type FhvThroughputQualifierSamplerContract,
} from "@/lib/trader/observability/fhv-throughput-sampler";

/**
 * Execution-time producer/sampler binding for official throughput evidence.
 *
 * Written when the representative run starts, not when the growth-law report is generated.
 * A later clean checkout cannot re-label progress produced under a different HEAD.
 */

export const FHV_THROUGHPUT_PRODUCER_BINDING_SCHEMA = "fhv-throughput-producer-binding/v1" as const;
export const FHV_THROUGHPUT_PRODUCER_BINDING_FILENAME =
  "fhv-throughput-producer-binding.v1.json" as const;

export class FhvThroughputProducerBindingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvThroughputProducerBindingError";
  }
}

export type FhvThroughputProducerBindingV1 = Readonly<{
  schemaVersion: typeof FHV_THROUGHPUT_PRODUCER_BINDING_SCHEMA;
  capturedAtUtc: string;
  runDir: string;
  runId: string;
  producer: Readonly<{
    headSha: string;
    trackedTreeClean: true;
  }>;
  samplerContract: FhvThroughputQualifierSamplerContract;
  bindingDigest: string;
}>;

export type FhvProgressProducerStampV1 = Readonly<{
  producerHeadSha: string;
  producerBindingDigest: string;
  samplerContractVersion: FhvThroughputQualifierSamplerContract["version"];
  appliedIntervalMs: number;
}>;

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function digestBody(body: Omit<FhvThroughputProducerBindingV1, "bindingDigest">): string {
  return sha256Utf8(JSON.stringify(body));
}

export function resolveFhvThroughputProducerBindingPath(runDir: string): string {
  return join(runDir, FHV_THROUGHPUT_PRODUCER_BINDING_FILENAME);
}

function writeFileAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, contents, "utf8");
  renameSync(tempPath, path);
}

export function stampFhvProgressProducerIdentity(
  binding: FhvThroughputProducerBindingV1,
): FhvProgressProducerStampV1 {
  return {
    producerHeadSha: binding.producer.headSha,
    producerBindingDigest: binding.bindingDigest,
    samplerContractVersion: binding.samplerContract.version,
    appliedIntervalMs: binding.samplerContract.appliedIntervalMs,
  };
}

export function createFhvThroughputProducerBinding(input: {
  runDir: string;
  repoPath: string;
  runId: string;
  samplerContract: FhvThroughputQualifierSamplerContract;
  expectedHeadSha?: string;
  capturedAtUtc?: string;
}): FhvThroughputProducerBindingV1 {
  const checkout = assertFhvCleanTrackedHeadCheckout({
    repoPath: input.repoPath,
    ...(input.expectedHeadSha ? { expectedHeadSha: input.expectedHeadSha } : {}),
  });
  const samplerContract = assertCanonicalFhvThroughputSamplerContract(input.samplerContract);
  const body: Omit<FhvThroughputProducerBindingV1, "bindingDigest"> = {
    schemaVersion: FHV_THROUGHPUT_PRODUCER_BINDING_SCHEMA,
    capturedAtUtc: input.capturedAtUtc ?? new Date().toISOString(),
    runDir: input.runDir,
    runId: input.runId,
    producer: {
      headSha: checkout.headSha,
      trackedTreeClean: true,
    },
    samplerContract,
  };
  const binding: FhvThroughputProducerBindingV1 = {
    ...body,
    bindingDigest: digestBody(body),
  };
  const path = resolveFhvThroughputProducerBindingPath(input.runDir);
  if (existsSync(path)) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_BINDING_OVERWRITE_FORBIDDEN",
      "Producer binding already exists; execution-time identity is immutable.",
    );
  }
  writeFileAtomic(path, `${JSON.stringify(binding, null, 2)}\n`);
  return binding;
}

export function assertFhvThroughputProducerBinding(input: {
  runDir: string;
  expectedProducerHeadSha?: string;
}): FhvThroughputProducerBindingV1 {
  const path = resolveFhvThroughputProducerBindingPath(input.runDir);
  if (!existsSync(path)) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_BINDING_MISSING",
      `${path} missing — official throughput evidence requires an execution-time producer binding`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_BINDING_MALFORMED",
      `Producer binding is not valid JSON: ${String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_BINDING_MALFORMED",
      "Producer binding is not an object",
    );
  }
  const binding = parsed as FhvThroughputProducerBindingV1;
  if (binding.schemaVersion !== FHV_THROUGHPUT_PRODUCER_BINDING_SCHEMA) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_BINDING_SCHEMA_UNSUPPORTED",
      `schema ${String(binding.schemaVersion)} != ${FHV_THROUGHPUT_PRODUCER_BINDING_SCHEMA}`,
    );
  }
  if (typeof binding.bindingDigest !== "string" || binding.bindingDigest.length !== 64) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_BINDING_DIGEST_MISSING",
      "Producer binding has no valid bindingDigest",
    );
  }
  const { bindingDigest, ...body } = binding;
  const recomputed = digestBody(body);
  if (recomputed !== bindingDigest) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_BINDING_DIGEST_MISMATCH",
      `recomputed ${recomputed} != recorded ${bindingDigest}`,
    );
  }
  assertCanonicalFhvThroughputSamplerContract(binding.samplerContract);
  if (!binding.producer?.trackedTreeClean || !binding.producer.headSha) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_IDENTITY_MISSING",
      "Producer binding does not prove a clean tracked HEAD",
    );
  }
  if (
    input.expectedProducerHeadSha &&
    binding.producer.headSha !== input.expectedProducerHeadSha.toLowerCase()
  ) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_HEAD_MISMATCH",
      `producer HEAD ${binding.producer.headSha} != expected ${input.expectedProducerHeadSha}`,
    );
  }
  return binding;
}

export function assertProgressSeriesMatchesProducerBinding(input: {
  series: readonly Readonly<{
    producerHeadSha?: string;
    producerBindingDigest?: string;
    samplerContractVersion?: string;
    appliedIntervalMs?: number;
  }>[];
  binding: FhvThroughputProducerBindingV1;
}): void {
  if (input.series.length === 0) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_PROGRESS_EMPTY",
      "Progress series is empty",
    );
  }
  for (const [index, row] of input.series.entries()) {
    if (
      row.producerHeadSha == null ||
      row.producerBindingDigest == null ||
      row.samplerContractVersion == null ||
      row.appliedIntervalMs == null
    ) {
      throw new FhvThroughputProducerBindingError(
        "FHV_THROUGHPUT_PRODUCER_STAMP_MISSING",
        `progress row ${index} has no execution-time producer/sampler stamp`,
      );
    }
    if (row.producerHeadSha !== input.binding.producer.headSha) {
      throw new FhvThroughputProducerBindingError(
        "FHV_THROUGHPUT_PRODUCER_STAMP_HEAD_MISMATCH",
        `progress row ${index} producerHeadSha ${row.producerHeadSha} != binding ${input.binding.producer.headSha}`,
      );
    }
    if (row.producerBindingDigest !== input.binding.bindingDigest) {
      throw new FhvThroughputProducerBindingError(
        "FHV_THROUGHPUT_PRODUCER_STAMP_DIGEST_MISMATCH",
        `progress row ${index} producerBindingDigest != sidecar bindingDigest`,
      );
    }
    if (row.samplerContractVersion !== input.binding.samplerContract.version) {
      throw new FhvThroughputProducerBindingError(
        "FHV_THROUGHPUT_PRODUCER_STAMP_SAMPLER_MISMATCH",
        `progress row ${index} samplerContractVersion ${row.samplerContractVersion} != binding`,
      );
    }
    if (row.appliedIntervalMs !== input.binding.samplerContract.appliedIntervalMs) {
      throw new FhvThroughputProducerBindingError(
        "FHV_THROUGHPUT_PRODUCER_STAMP_INTERVAL_MISMATCH",
        `progress row ${index} appliedIntervalMs ${row.appliedIntervalMs} != binding ${input.binding.samplerContract.appliedIntervalMs}`,
      );
    }
  }
}
