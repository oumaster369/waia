/**
 * DEE-436 — canonical T4A operator binding parity (code ↔ packet exports).
 */

import {
  assertPacketExportsMatchBindingSpec,
  FHV_T4A_OPTIONAL_BINDING_ENV_NAMES,
  FHV_T4A_REQUIRED_BINDING_ENV_NAMES,
  parsePacketBindingExports,
} from "@/lib/trader/observability/fhv-t4a-binding-spec";

export {
  FHV_T4A_OPTIONAL_BINDING_ENV_NAMES as FHV_T4A_OPERATOR_OPTIONAL_BINDING_ENV_NAMES,
  FHV_T4A_REQUIRED_BINDING_ENV_NAMES as FHV_T4A_OPERATOR_BINDING_ENV_NAMES,
  parsePacketBindingExports,
};

/** Human packet V5 export names under Declared Human bindings. */
export const FHV_T4A_PACKET_BINDING_EXPORT_NAMES = [
  ...FHV_T4A_REQUIRED_BINDING_ENV_NAMES,
  ...FHV_T4A_OPTIONAL_BINDING_ENV_NAMES.filter((name) => name !== "FHV_T4A_AUTHORIZATION"),
  "FHV_EXPECTED_LEGACY_CONTAINER_NAME",
  "FHV_EXPECTED_LEGACY_CONTAINER_IMAGE",
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

export type FhvT4aOperatorBindingEnvName = (typeof FHV_T4A_REQUIRED_BINDING_ENV_NAMES)[number];
export type FhvT4aPacketBindingExportName = (typeof FHV_T4A_PACKET_BINDING_EXPORT_NAMES)[number];

export function resolveFhvT4aOperatorBindingEnvNames(): readonly string[] {
  return FHV_T4A_REQUIRED_BINDING_ENV_NAMES;
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
  try {
    assertPacketExportsMatchBindingSpec(packetBody);
  } catch (error) {
    throw new FhvT4aBindingParityError(
      error instanceof Error && "code" in error
        ? String((error as { code: string }).code)
        : "FHV_T4A_BINDING_PARITY_GAP",
      error instanceof Error ? error.message : String(error),
    );
  }
}
