/** DEE-424 / DEE-431 — bounded Linux systemd unit configuration for FHV rehearsal supervision. */

export const FHV_REHEARSAL_RUNTIME_MAX_SEC = 300;

export const FHV_SYSTEMD_CAMPAIGN_UNIT = "waia-fhv-campaign.service" as const;
export const FHV_SYSTEMD_OBSERVER_UNIT = "waia-fhv-observer.service" as const;

export const FHV_SYSTEMD_ALLOWED_UNITS = [
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
] as const;

export type FhvSystemdAllowedUnit = (typeof FHV_SYSTEMD_ALLOWED_UNITS)[number];

export type FhvSystemdUnitConfigV1 = Readonly<{
  schemaVersion: "fhv-systemd-unit-config/v1";
  hostOs: "linux";
  qualifiedSupervisor: "SYSTEMD";
  repoRoot: string;
  workingDirectory: string;
  serviceUser: string;
  environmentFile: string;
  targetSha: string;
  nodeBin: string;
  fhvRunRoot: string;
  fhvRunId: string;
  fhvOrganizationId: string;
  observerPort: number;
}>;

const FULL_SHA = /^[0-9a-f]{40}$/;
const CONTROL_CHARS = /[\0\r\n\t]/;
const UNSAFE_SYSTEMD_CHARS = /[;|`$(){}<>\\&%#='" ]/;
const ABSOLUTE_SAFE_PATH = /^\/(?:[a-zA-Z0-9@._-]+\/)*[a-zA-Z0-9@._-]+$/;
const SAFE_IDENTIFIER = /^[a-zA-Z0-9._-]+$/;
const SAFE_RUN_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class FhvSystemdUnitConfigError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvSystemdUnitConfigError";
  }
}

function assertAbsoluteSafePath(field: string, value: string): void {
  if (!value || !ABSOLUTE_SAFE_PATH.test(value) || value.includes("..")) {
    throw new FhvSystemdUnitConfigError(
      "INVALID_ABSOLUTE_PATH",
      `${field} must be an absolute safe path using [a-zA-Z0-9/._-] segments only.`,
    );
  }
  if (CONTROL_CHARS.test(value) || UNSAFE_SYSTEMD_CHARS.test(value)) {
    throw new FhvSystemdUnitConfigError(
      "UNSAFE_PATH_CHARACTERS",
      `${field} contains forbidden control or injection characters.`,
    );
  }
}

function assertSafeIdentifier(field: string, value: string, pattern: RegExp): void {
  if (!value || CONTROL_CHARS.test(value) || UNSAFE_SYSTEMD_CHARS.test(value)) {
    throw new FhvSystemdUnitConfigError(
      "UNSAFE_IDENTIFIER",
      `${field} contains forbidden characters.`,
    );
  }
  if (!pattern.test(value)) {
    throw new FhvSystemdUnitConfigError("INVALID_IDENTIFIER", `${field} format is invalid.`);
  }
}

const ROOT_SERVICE_USERS = new Set(["root", "0"]);

export type FhvServiceUserValidationSeam = Readonly<{
  resolveUid?: (user: string) => number | null;
}>;

export function assertFhvSystemdServiceUserNotRoot(
  serviceUser: string,
  seam: FhvServiceUserValidationSeam = {},
): void {
  const normalized = serviceUser.trim().toLowerCase();
  if (ROOT_SERVICE_USERS.has(normalized)) {
    throw new FhvSystemdUnitConfigError(
      "SERVICE_USER_ROOT_FORBIDDEN",
      "Service user root/UID 0 is forbidden for FHV systemd units.",
    );
  }
  const resolveUid = seam.resolveUid;
  if (resolveUid) {
    const uid = resolveUid(serviceUser);
    if (uid === 0) {
      throw new FhvSystemdUnitConfigError(
        "SERVICE_USER_ROOT_FORBIDDEN",
        "Resolved service user UID 0 is forbidden for FHV systemd units.",
      );
    }
  }
}

export function assertFhvSystemdUnitConfig(
  input: FhvSystemdUnitConfigV1,
  seam: FhvServiceUserValidationSeam = {},
): void {
  if (input.hostOs !== "linux" || input.qualifiedSupervisor !== "SYSTEMD") {
    throw new FhvSystemdUnitConfigError(
      "HOST_NOT_QUALIFIED",
      "Linux systemd qualification is required for FHV unit rendering.",
    );
  }
  if (!FULL_SHA.test(input.targetSha)) {
    throw new FhvSystemdUnitConfigError(
      "INVALID_TARGET_SHA",
      "targetSha must be a 40-character lowercase hex git SHA.",
    );
  }
  if (input.repoRoot !== input.workingDirectory) {
    throw new FhvSystemdUnitConfigError(
      "REPO_WORKING_DIRECTORY_MISMATCH",
      "repoRoot and workingDirectory must identify the same clean release checkout.",
    );
  }
  assertAbsoluteSafePath("repoRoot", input.repoRoot);
  assertAbsoluteSafePath("workingDirectory", input.workingDirectory);
  assertAbsoluteSafePath("environmentFile", input.environmentFile);
  assertAbsoluteSafePath("nodeBin", input.nodeBin);
  assertAbsoluteSafePath("fhvRunRoot", input.fhvRunRoot);
  assertSafeIdentifier("serviceUser", input.serviceUser, SAFE_IDENTIFIER);
  assertFhvSystemdServiceUserNotRoot(input.serviceUser, seam);
  assertSafeIdentifier("fhvRunId", input.fhvRunId, SAFE_RUN_ID);
  assertSafeIdentifier("fhvOrganizationId", input.fhvOrganizationId, UUID_V4);
  if (input.observerPort < 1 || input.observerPort > 65535) {
    throw new FhvSystemdUnitConfigError("INVALID_OBSERVER_PORT", "observerPort out of range.");
  }
}

export function assertFhvSystemdAllowedUnit(unit: string): void {
  if (!(FHV_SYSTEMD_ALLOWED_UNITS as readonly string[]).includes(unit)) {
    throw new FhvSystemdUnitConfigError("UNKNOWN_UNIT", `Unit not allowlisted: ${unit}`);
  }
}
