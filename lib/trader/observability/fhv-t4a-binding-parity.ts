/**
 * DEE-436 — canonical T4A operator binding parity (code ↔ packet exports).
 */

/** Env names consumed by `resolveFhvT4aOperatorBindings` via `requireEnv`. */
export const FHV_T4A_OPERATOR_BINDING_ENV_NAMES = [
  "EXEC_HOST",
  "SSH_USER",
  "FHV_LOCAL_RELEASE_ROOT",
  "FHV_T4A_LOCAL_STATE_DIR",
  "FHV_LOCAL_NODE_BIN",
  "FHV_LOCAL_GIT_BIN",
  "FHV_LOCAL_SSH_BIN",
  "EXECUTION_SERVER_TARGET_SHA",
  "FHV_RELEASE_TAG",
  "FHV_RUN_ID",
  "FHV_ORGANIZATION_ID",
  "FHV_OPERATOR_ID",
  "FHV_SERVICE_USER",
  "FHV_ENVIRONMENT_FILE",
  "FHV_ARTIFACT_ROOT",
  "FHV_CHECKOUT_PARENT",
  "FHV_EXPECTED_HOSTNAME",
  "FHV_EXPECTED_MACHINE_ID_SHA256",
  "FHV_NODE_BIN",
  "FHV_COREPACK_BIN",
  "FHV_GIT_BIN",
  "FHV_PYTHON_BIN",
  "FHV_DOCKER_BIN",
  "FHV_SYSTEMCTL_BIN",
  "FHV_SYSTEMD_ANALYZE_BIN",
] as const;

/** Optional env names resolved by `resolveFhvT4aOperatorBindings` (non-required). */
export const FHV_T4A_OPERATOR_OPTIONAL_BINDING_ENV_NAMES = [
  "FHV_ORIGIN_URL",
  "FHV_T4A_AUTHORIZATION",
  "FHV_T4A_WORKSTATION_TRACE_PATH",
] as const;

/** Human packet V5 export names under Declared Human bindings. */
export const FHV_T4A_PACKET_BINDING_EXPORT_NAMES = [
  "EXEC_HOST",
  "SSH_USER",
  "FHV_LOCAL_NODE_BIN",
  "FHV_LOCAL_GIT_BIN",
  "FHV_LOCAL_SSH_BIN",
  "FHV_T4A_LOCAL_STATE_DIR",
  "FHV_LOCAL_RELEASE_ROOT",
  "EXECUTION_SERVER_TARGET_SHA",
  "FHV_RELEASE_TAG",
  "FHV_RUN_ID",
  "FHV_ORGANIZATION_ID",
  "FHV_OPERATOR_ID",
  "FHV_SERVICE_USER",
  "FHV_ENVIRONMENT_FILE",
  "FHV_ARTIFACT_ROOT",
  "FHV_CHECKOUT_PARENT",
  "FHV_EXPECTED_HOSTNAME",
  "FHV_EXPECTED_MACHINE_ID_SHA256",
  "FHV_NODE_BIN",
  "FHV_COREPACK_BIN",
  "FHV_GIT_BIN",
  "FHV_PYTHON_BIN",
  "FHV_DOCKER_BIN",
  "FHV_SYSTEMCTL_BIN",
  "FHV_SYSTEMD_ANALYZE_BIN",
  "FHV_EXPECTED_LEGACY_CONTAINER_NAME",
  "FHV_EXPECTED_LEGACY_CONTAINER_IMAGE",
  "FHV_ORIGIN_URL",
  "FHV_T4A_WORKSTATION_TRACE_PATH",
  "FHV_REPO_ROOT",
  "FHV_WORKING_DIRECTORY",
  "FHV_RUN_DIR",
  "FHV_RENDERED_UNITS_DIR",
  "FHV_INSTALLED_UNITS_DIR",
  "FHV_SEAL_DESTINATION",
  "FHV_CONTINUITY_BEFORE",
  "FHV_CONTINUITY_AFTER",
  "FHV_HOST_PROBE_PATH",
  "FHV_POST_ROLLBACK_HOST_PROBE_PATH",
] as const;

export type FhvT4aOperatorBindingEnvName = (typeof FHV_T4A_OPERATOR_BINDING_ENV_NAMES)[number];
export type FhvT4aPacketBindingExportName = (typeof FHV_T4A_PACKET_BINDING_EXPORT_NAMES)[number];

export function resolveFhvT4aOperatorBindingEnvNames(): readonly string[] {
  return FHV_T4A_OPERATOR_BINDING_ENV_NAMES;
}

export function resolveFhvT4aPacketBindingExportNames(): readonly string[] {
  return FHV_T4A_PACKET_BINDING_EXPORT_NAMES;
}

export class FhvT4aBindingParityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aBindingParityError";
  }
}

/** Required operator env names must appear as packet exports (subset parity). */
export function assertFhvT4aBindingParity(packetBody: string): void {
  for (const name of FHV_T4A_OPERATOR_BINDING_ENV_NAMES) {
    if (!packetBody.includes(`export ${name}=`)) {
      throw new FhvT4aBindingParityError(
        "FHV_T4A_BINDING_PARITY_GAP",
        `Packet missing export for required binding: ${name}`,
      );
    }
  }
  if (!packetBody.includes("FHV_POST_ROLLBACK_HOST_PROBE_PATH")) {
    throw new FhvT4aBindingParityError(
      "FHV_T4A_BINDING_PARITY_GAP",
      "Packet missing FHV_POST_ROLLBACK_HOST_PROBE_PATH export.",
    );
  }
}
