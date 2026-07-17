import type { QualificationAttemptResult } from "@/lib/trader/backtest/replay-qualification-harness";

export const HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA =
  "htr-wp22-completed-runtime-qualification/v1" as const;

export const HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE = "completed-runtime-d11b" as const;

export type HtrWp22CompletedRuntimeQualificationPhase =
  typeof HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE;

export type HtrWp22CompletedRuntimeQualificationTerminalState =
  | "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS"
  | "HTR_WP22_COMPLETED_RUNTIME_D11B_THRESHOLDS_NOT_MET"
  | "HTR_WP22_COMPLETED_RUNTIME_D11B_ATTEMPT_INVALIDATED";

export type HtrWp22CompletedRuntimeQualificationResult = {
  schemaVersion: typeof HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA;
  phase: HtrWp22CompletedRuntimeQualificationPhase;
  terminalState: HtrWp22CompletedRuntimeQualificationTerminalState;
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  hostFingerprintSha256: string;
  d11bThresholdsBinding: "D11B_THRESHOLDS_UNCHANGED";
  qualificationHarnessSha256: string;
  qualificationAttempt: QualificationAttemptResult;
  invalidationReason?: string;
  payloadSha256?: string;
};
