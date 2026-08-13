import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

/** ADR-0025 / WP-FHV-STORAGE artifact lifecycle states (Gate-C). */
export const FHV_ARTIFACT_LIFECYCLE_STATES = [
  "CANONICAL_EVIDENCE",
  "ACTIVE_STATE",
  "PROVEN_ORPHAN",
  "TEMPORARY",
] as const;

export type FhvArtifactLifecycleState = (typeof FHV_ARTIFACT_LIFECYCLE_STATES)[number];

export type FhvArtifactLifecycleRecordV1 = Readonly<{
  schemaVersion: "fhv-artifact-lifecycle/v1";
  artifactPath: string;
  lifecycleState: FhvArtifactLifecycleState;
  classifiedAtUtc: string;
  reason: string | null;
}>;

export function classifyFhvArtifactLifecycle(input: {
  artifactPath: string;
  lifecycleState: FhvArtifactLifecycleState;
  reason?: string | null;
  classifiedAtUtc?: string;
}): FhvArtifactLifecycleRecordV1 {
  return {
    schemaVersion: "fhv-artifact-lifecycle/v1",
    artifactPath: input.artifactPath,
    lifecycleState: input.lifecycleState,
    classifiedAtUtc: input.classifiedAtUtc ?? new Date().toISOString(),
    reason: input.reason ?? null,
  };
}

export function assertFhvArtifactLifecycleState(
  state: string,
): asserts state is FhvArtifactLifecycleState {
  if (!(FHV_ARTIFACT_LIFECYCLE_STATES as readonly string[]).includes(state)) {
    throw new Error(`FHV_ARTIFACT_LIFECYCLE_INVALID: ${state}`);
  }
}
