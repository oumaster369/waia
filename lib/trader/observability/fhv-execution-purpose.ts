/** Scoped execution purpose bound into authorization, freeze, launch, and checkpoints. */
export const FHV_EXECUTION_PURPOSE_CONTROL_REPLAY = "CONTROL_REPLAY" as const;
export const FHV_EXECUTION_PURPOSE_FULL_HISTORICAL = "FULL_HISTORICAL" as const;

export type FhvExecutionPurpose =
  | typeof FHV_EXECUTION_PURPOSE_CONTROL_REPLAY
  | typeof FHV_EXECUTION_PURPOSE_FULL_HISTORICAL;

export function assertFhvExecutionPurpose(value: string): FhvExecutionPurpose {
  if (
    value === FHV_EXECUTION_PURPOSE_CONTROL_REPLAY ||
    value === FHV_EXECUTION_PURPOSE_FULL_HISTORICAL
  ) {
    return value;
  }
  throw new Error(`[fhv] invalid executionPurpose: ${value}`);
}

export function assertControlReplayAuthorizationPurpose(
  executionPurpose: FhvExecutionPurpose,
): void {
  if (executionPurpose !== FHV_EXECUTION_PURPOSE_CONTROL_REPLAY) {
    throw new Error(
      "[fhv] CONTROL_REPLAY launch requires executionPurpose=CONTROL_REPLAY on authorization receipt.",
    );
  }
}

export function assertFullHistoricalAuthorizationPurpose(
  executionPurpose: FhvExecutionPurpose,
): void {
  if (executionPurpose !== FHV_EXECUTION_PURPOSE_FULL_HISTORICAL) {
    throw new Error(
      "[fhv] FULL_HISTORICAL launch requires executionPurpose=FULL_HISTORICAL on authorization receipt.",
    );
  }
}
