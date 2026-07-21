/** DEE-424 — bounded Linux systemd unit configuration for FHV rehearsal supervision. */

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

export class FhvSystemdUnitConfigError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvSystemdUnitConfigError";
  }
}

export function assertFhvSystemdUnitConfig(input: FhvSystemdUnitConfigV1): void {
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
  for (const [field, value] of Object.entries({
    repoRoot: input.repoRoot,
    workingDirectory: input.workingDirectory,
    serviceUser: input.serviceUser,
    environmentFile: input.environmentFile,
    nodeBin: input.nodeBin,
    fhvRunRoot: input.fhvRunRoot,
    fhvRunId: input.fhvRunId,
    fhvOrganizationId: input.fhvOrganizationId,
  })) {
    if (!value || value.includes("..") || value.includes("\0") || value.includes(";")) {
      throw new FhvSystemdUnitConfigError(
        "INVALID_PATH_OR_IDENTIFIER",
        `${field} contains invalid characters.`,
      );
    }
  }
  if (input.observerPort < 1 || input.observerPort > 65535) {
    throw new FhvSystemdUnitConfigError("INVALID_OBSERVER_PORT", "observerPort out of range.");
  }
}

export function assertFhvSystemdAllowedUnit(unit: string): void {
  if (!(FHV_SYSTEMD_ALLOWED_UNITS as readonly string[]).includes(unit)) {
    throw new FhvSystemdUnitConfigError("UNKNOWN_UNIT", `Unit not allowlisted: ${unit}`);
  }
}
