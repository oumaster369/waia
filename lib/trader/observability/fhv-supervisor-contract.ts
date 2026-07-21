/** Supervisor-neutral contract — concrete OS units blocked until HOST_OS qualification. */

export type FhvSupervisorHostOs = "linux" | "macos" | "unknown";

export type FhvSupervisorAction =
  | "start_campaign"
  | "stop_campaign"
  | "restart_observer"
  | "graceful_stop_campaign"
  | "emergency_stop_campaign";

export type FhvSupervisorContractV1 = Readonly<{
  schemaVersion: "fhv-supervisor-contract/v1";
  hostOs: FhvSupervisorHostOs;
  campaignServiceName: string;
  observerServiceName: string;
  implementationStatus: "blocked_pending_host_qualification" | "qualified";
}>;

export const FHV_SUPERVISOR_NEUTRAL_CONTRACT: FhvSupervisorContractV1 = {
  schemaVersion: "fhv-supervisor-contract/v1",
  hostOs: "unknown",
  campaignServiceName: "waia-fhv-campaign",
  observerServiceName: "waia-fhv-observer",
  implementationStatus: "blocked_pending_host_qualification",
};

export function resolveFhvSupervisorContract(hostOs: FhvSupervisorHostOs): FhvSupervisorContractV1 {
  if (hostOs === "unknown") {
    return FHV_SUPERVISOR_NEUTRAL_CONTRACT;
  }
  return {
    ...FHV_SUPERVISOR_NEUTRAL_CONTRACT,
    hostOs,
    implementationStatus: "qualified",
  };
}

export function mapPlatformToFhvHostOs(platform: NodeJS.Platform): FhvSupervisorHostOs {
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "macos";
  return "unknown";
}
