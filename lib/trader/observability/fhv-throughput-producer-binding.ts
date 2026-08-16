import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { arch, cpus, hostname, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

import { FhvT4BootIdError, normalizeFhvT4BootId } from "@/lib/trader/observability/fhv-t4-boot-id";
import { assertFhvCleanTrackedHeadCheckout } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import {
  assertCanonicalFhvThroughputSamplerContract,
  type FhvThroughputQualifierSamplerContract,
} from "@/lib/trader/observability/fhv-throughput-sampler";

/**
 * Execution-time producer/sampler/host binding for official throughput evidence.
 *
 * Written when the representative run starts, not when the growth-law report or receipt is generated.
 * A later clean checkout or a different physical host cannot re-label progress produced elsewhere.
 */

export const FHV_THROUGHPUT_PRODUCER_BINDING_SCHEMA = "fhv-throughput-producer-binding/v2" as const;
export const FHV_THROUGHPUT_PRODUCER_BINDING_FILENAME =
  "fhv-throughput-producer-binding.v2.json" as const;

export class FhvThroughputProducerBindingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvThroughputProducerBindingError";
  }
}

export type FhvThroughputProducerHostIdentityV1 = Readonly<{
  hostname: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  nodeVersion: string;
  /** SHA-256 of `/etc/machine-id` bytes when readable (T4 canonical). Null off Linux. */
  machineIdSha256: string | null;
  /** Canonical T4 boot_id when `/proc/sys/kernel/random/boot_id` is readable. Null off Linux. */
  bootId: string | null;
}>;

export type FhvThroughputProducerBindingV1 = Readonly<{
  schemaVersion: typeof FHV_THROUGHPUT_PRODUCER_BINDING_SCHEMA;
  capturedAtUtc: string;
  runDir: string;
  runId: string;
  producer: Readonly<{
    headSha: string;
    trackedTreeClean: true;
  }>;
  host: FhvThroughputProducerHostIdentityV1;
  samplerContract: FhvThroughputQualifierSamplerContract;
  bindingDigest: string;
}>;

export type FhvProgressProducerStampV1 = Readonly<{
  producerHeadSha: string;
  producerBindingDigest: string;
  samplerContractVersion: FhvThroughputQualifierSamplerContract["version"];
  appliedIntervalMs: number;
}>;

const LINUX_MACHINE_ID_PATH = "/etc/machine-id";
const LINUX_BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";

let hostIdentityForTests: FhvThroughputProducerHostIdentityV1 | null = null;

/** Test-only seam. Not an environment-variable bypass. */
export function setFhvThroughputProducerHostIdentityForTests(
  identity: FhvThroughputProducerHostIdentityV1 | null,
): void {
  hostIdentityForTests = identity;
}

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function digestBody(body: Omit<FhvThroughputProducerBindingV1, "bindingDigest">): string {
  return sha256Utf8(JSON.stringify(body));
}

function readLinuxMachineIdSha256(): string | null {
  if (!existsSync(LINUX_MACHINE_ID_PATH)) {
    return null;
  }
  try {
    return createHash("sha256").update(readFileSync(LINUX_MACHINE_ID_PATH)).digest("hex");
  } catch {
    return null;
  }
}

function readLinuxBootId(): string | null {
  if (!existsSync(LINUX_BOOT_ID_PATH)) {
    return null;
  }
  try {
    return normalizeFhvT4BootId(readFileSync(LINUX_BOOT_ID_PATH, "utf8"));
  } catch (error) {
    if (error instanceof FhvT4BootIdError) {
      throw error;
    }
    return null;
  }
}

export function captureFhvThroughputProducerHostIdentity(): FhvThroughputProducerHostIdentityV1 {
  if (hostIdentityForTests) {
    return hostIdentityForTests;
  }
  const cpuList = cpus();
  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    cpuModel: cpuList[0]?.model ?? "unknown",
    cpuCount: cpuList.length,
    nodeVersion: process.version,
    machineIdSha256: readLinuxMachineIdSha256(),
    bootId: readLinuxBootId(),
  };
}

export function assertFhvThroughputProducerHostIdentity(
  host: FhvThroughputProducerHostIdentityV1 | null | undefined,
): FhvThroughputProducerHostIdentityV1 {
  if (!host) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_HOST_IDENTITY_MISSING",
      "Producer binding has no execution-time host/runtime identity",
    );
  }
  if (!host.hostname?.trim() || !host.platform?.trim() || !host.arch?.trim()) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_HOST_IDENTITY_MISSING",
      "Producer host identity is missing hostname/platform/arch",
    );
  }
  if (!host.cpuModel?.trim() || !Number.isInteger(host.cpuCount) || host.cpuCount < 1) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_HOST_IDENTITY_MISSING",
      "Producer host identity is missing CPU model/count",
    );
  }
  if (!host.nodeVersion?.trim()) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_RUNTIME_IDENTITY_MISSING",
      "Producer host identity is missing Node version",
    );
  }
  return host;
}

export function assertFhvThroughputProducerHostMatches(input: {
  producer: FhvThroughputProducerHostIdentityV1;
  current: FhvThroughputProducerHostIdentityV1;
}): void {
  const producer = assertFhvThroughputProducerHostIdentity(input.producer);
  const current = assertFhvThroughputProducerHostIdentity(input.current);
  if (producer.nodeVersion !== current.nodeVersion) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_RUNTIME_MISMATCH",
      `producer Node ${producer.nodeVersion} != qualification host Node ${current.nodeVersion}`,
    );
  }
  if (
    producer.hostname !== current.hostname ||
    producer.platform !== current.platform ||
    producer.arch !== current.arch ||
    producer.cpuModel !== current.cpuModel ||
    producer.cpuCount !== current.cpuCount ||
    producer.machineIdSha256 !== current.machineIdSha256 ||
    producer.bootId !== current.bootId
  ) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_HOST_MISMATCH",
      `producer host ${producer.hostname}/${producer.arch}/${producer.cpuModel} != qualification host ${current.hostname}/${current.arch}/${current.cpuModel}`,
    );
  }
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
  host?: FhvThroughputProducerHostIdentityV1;
}): FhvThroughputProducerBindingV1 {
  const checkout = assertFhvCleanTrackedHeadCheckout({
    repoPath: input.repoPath,
    ...(input.expectedHeadSha ? { expectedHeadSha: input.expectedHeadSha } : {}),
  });
  const samplerContract = assertCanonicalFhvThroughputSamplerContract(input.samplerContract);
  const host = assertFhvThroughputProducerHostIdentity(
    input.host ?? captureFhvThroughputProducerHostIdentity(),
  );
  const runDir = resolve(input.runDir);
  const body: Omit<FhvThroughputProducerBindingV1, "bindingDigest"> = {
    schemaVersion: FHV_THROUGHPUT_PRODUCER_BINDING_SCHEMA,
    capturedAtUtc: input.capturedAtUtc ?? new Date().toISOString(),
    runDir,
    runId: input.runId,
    producer: {
      headSha: checkout.headSha,
      trackedTreeClean: true,
    },
    host,
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
  if (!binding.runId?.trim()) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_RUN_ID_MISSING",
      "Producer binding has no runId",
    );
  }
  assertFhvThroughputProducerHostIdentity(binding.host);
  const analyzedRunDir = resolve(input.runDir);
  if (resolve(binding.runDir) !== analyzedRunDir) {
    throw new FhvThroughputProducerBindingError(
      "FHV_THROUGHPUT_PRODUCER_RUNDIR_MISMATCH",
      `producer binding runDir ${binding.runDir} != analyzed ${analyzedRunDir}`,
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
