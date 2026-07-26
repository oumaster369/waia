/**
 * DEE-436 — host preflight v2 parsing and binding parity.
 */

import { normalizeFhvT4BootId } from "@/lib/trader/observability/fhv-t4-boot-id";

export const FHV_T4_HOST_PREFLIGHT_SCHEMA_VERSION = "fhv-t4-host-preflight/v2" as const;

export type FhvT4HostPreflightV2 = Readonly<{
  schemaVersion: typeof FHV_T4_HOST_PREFLIGHT_SCHEMA_VERSION;
  classification: string;
  hostname: string;
  machineIdSha256: string;
  serviceUser: string;
  serviceUid: number;
  serviceGid: number;
  servicePrimaryGroup: string;
  environmentFile: string;
  artifactRoot: string;
  checkoutParent: string;
  nodeBin: string;
  corepackBin: string;
  gitBin: string;
  pythonBin: string;
  dockerBin: string;
  systemctlBin: string;
  systemdAnalyzeBin: string;
  legacyContainerName: string;
  legacyContainerImage: string;
  legacyContainerState: string;
  hostBootId: string;
  minimumFreeKiB: number;
  observedFreeKiB: number;
  hostMonotonicSample: Readonly<Record<string, unknown>>;
}>;

export class FhvT4HostPreflightError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4HostPreflightError";
  }
}

export function parseFhvT4HostPreflightV2(raw: unknown): FhvT4HostPreflightV2 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4HostPreflightError(
      "FHV_T4_PREFLIGHT_INVALID",
      "Host preflight payload must be an object.",
    );
  }
  const payload = raw as FhvT4HostPreflightV2;
  if (payload.schemaVersion !== FHV_T4_HOST_PREFLIGHT_SCHEMA_VERSION) {
    throw new FhvT4HostPreflightError(
      "FHV_T4_PREFLIGHT_SCHEMA_MISMATCH",
      "Host preflight schemaVersion mismatch.",
    );
  }
  const requiredStrings = [
    "hostname",
    "machineIdSha256",
    "serviceUser",
    "servicePrimaryGroup",
    "environmentFile",
    "artifactRoot",
    "checkoutParent",
    "nodeBin",
    "corepackBin",
    "gitBin",
    "pythonBin",
    "dockerBin",
    "systemctlBin",
    "systemdAnalyzeBin",
    "hostBootId",
    "legacyContainerName",
    "legacyContainerImage",
    "legacyContainerState",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof payload[key] !== "string" || !payload[key].trim()) {
      throw new FhvT4HostPreflightError(
        "FHV_T4_PREFLIGHT_FIELD_MISSING",
        `Host preflight missing ${key}.`,
      );
    }
  }
  if (!Number.isInteger(payload.serviceUid) || payload.serviceUid <= 0) {
    throw new FhvT4HostPreflightError(
      "FHV_T4_PREFLIGHT_SERVICE_UID_INVALID",
      "serviceUid invalid.",
    );
  }
  if (!Number.isInteger(payload.serviceGid) || payload.serviceGid <= 0) {
    throw new FhvT4HostPreflightError(
      "FHV_T4_PREFLIGHT_SERVICE_GID_INVALID",
      "serviceGid invalid.",
    );
  }
  if (
    !Number.isInteger(payload.minimumFreeKiB) ||
    !Number.isInteger(payload.observedFreeKiB) ||
    payload.observedFreeKiB < payload.minimumFreeKiB
  ) {
    throw new FhvT4HostPreflightError(
      "FHV_T4_PREFLIGHT_FREE_SPACE_INVALID",
      "Free space fields invalid.",
    );
  }
  if (typeof payload.hostMonotonicSample !== "object" || payload.hostMonotonicSample === null) {
    throw new FhvT4HostPreflightError(
      "FHV_T4_PREFLIGHT_MONOTONIC_INVALID",
      "hostMonotonicSample required.",
    );
  }
  const normalizedHostBootId = normalizeFhvT4BootId(payload.hostBootId);
  const sampleBootId =
    typeof payload.hostMonotonicSample.bootId === "string"
      ? payload.hostMonotonicSample.bootId
      : "";
  if (normalizeFhvT4BootId(sampleBootId) !== normalizedHostBootId) {
    throw new FhvT4HostPreflightError(
      "PREFLIGHT_HOST_BOOT_ID_DROPPED",
      "hostBootId must match hostMonotonicSample.bootId.",
    );
  }
  return {
    ...payload,
    hostBootId: normalizedHostBootId,
  };
}

export function assertPreflightMatchesBindings(
  preflight: FhvT4HostPreflightV2,
  bindings: Readonly<{
    serviceUser: string;
    environmentFile: string;
    artifactRoot: string;
    checkoutParent: string;
    nodeBin: string;
    corepackBin: string;
    gitBin: string;
    pythonBin: string;
    dockerBin: string;
    systemctlBin: string;
    systemdAnalyzeBin: string;
    expectedHostname: string;
    expectedMachineIdSha256: string;
  }>,
): void {
  const pairs: readonly [string, string, string][] = [
    ["serviceUser", bindings.serviceUser, preflight.serviceUser],
    ["environmentFile", bindings.environmentFile, preflight.environmentFile],
    ["artifactRoot", bindings.artifactRoot, preflight.artifactRoot],
    ["checkoutParent", bindings.checkoutParent, preflight.checkoutParent],
    ["nodeBin", bindings.nodeBin, preflight.nodeBin],
    ["corepackBin", bindings.corepackBin, preflight.corepackBin],
    ["gitBin", bindings.gitBin, preflight.gitBin],
    ["pythonBin", bindings.pythonBin, preflight.pythonBin],
    ["dockerBin", bindings.dockerBin, preflight.dockerBin],
    ["expectedHostname", bindings.expectedHostname, preflight.hostname],
    ["expectedMachineIdSha256", bindings.expectedMachineIdSha256, preflight.machineIdSha256],
  ];
  for (const [label, expected, actual] of pairs) {
    if (expected !== actual) {
      throw new FhvT4HostPreflightError(
        "FHV_T4_PREFLIGHT_BINDING_MISMATCH",
        `${label} mismatch: expected ${expected}, got ${actual}`,
      );
    }
  }
  if (preflight.systemctlBin !== bindings.systemctlBin) {
    throw new FhvT4HostPreflightError(
      "FHV_T4_PREFLIGHT_BINDING_MISMATCH",
      "systemctlBin mismatch.",
    );
  }
  if (preflight.systemdAnalyzeBin !== bindings.systemdAnalyzeBin) {
    throw new FhvT4HostPreflightError(
      "FHV_T4_PREFLIGHT_BINDING_MISMATCH",
      "systemdAnalyzeBin mismatch.",
    );
  }
}
