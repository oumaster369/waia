import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  runCheckpointResumeHarness,
  type CheckpointResumeHarnessResult,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";

export const HTR_WP22_CHECKPOINT_RESUME_PARITY_SCHEMA =
  "htr-wp22-checkpoint-resume-parity/v1" as const;

export type HtrWp22CheckpointResumeParityResult = {
  schemaVersion: typeof HTR_WP22_CHECKPOINT_RESUME_PARITY_SCHEMA;
  terminalState: "HTR_WP22_CHECKPOINT_RESUME_PASS" | "HTR_WP22_CHECKPOINT_RESUME_FAIL";
  gitSha: string;
  dirtyTree: boolean;
  upstreamHarness: Pick<
    CheckpointResumeHarnessResult,
    | "terminalState"
    | "parity"
    | "frontierSeparation"
    | "disconnectTerminal"
    | "uninterruptedSemanticParityDigest"
    | "resumedSemanticParityDigest"
  >;
  payloadSha256?: string;
};

export async function runHtrWp22CheckpointResumeParity(): Promise<HtrWp22CheckpointResumeParityResult> {
  const harness = await runCheckpointResumeHarness();
  const passed =
    harness.terminalState === "REPLAY_RUN_OK" &&
    harness.parity.evidenceDigestMatch &&
    harness.parity.semanticReproDigestMatch &&
    harness.parity.semanticParityDigestMatch &&
    harness.frontierSeparation.passed &&
    harness.disconnectTerminal.passed &&
    harness.uninterruptedSemanticParityDigest === harness.resumedSemanticParityDigest;

  const semanticBody = {
    schemaVersion: HTR_WP22_CHECKPOINT_RESUME_PARITY_SCHEMA,
    terminalState: passed
      ? ("HTR_WP22_CHECKPOINT_RESUME_PASS" as const)
      : ("HTR_WP22_CHECKPOINT_RESUME_FAIL" as const),
    gitSha: readGitCodeSha(),
    dirtyTree: readGitDirtyTree(),
    upstreamHarness: {
      terminalState: harness.terminalState,
      parity: harness.parity,
      frontierSeparation: harness.frontierSeparation,
      disconnectTerminal: harness.disconnectTerminal,
      uninterruptedSemanticParityDigest: harness.uninterruptedSemanticParityDigest,
      resumedSemanticParityDigest: harness.resumedSemanticParityDigest,
    },
  };

  return {
    ...semanticBody,
    payloadSha256: computeSemanticSha256Hex(semanticBody),
  };
}

export function evaluateHtrWp22CheckpointResumeParity(
  result: HtrWp22CheckpointResumeParityResult,
): boolean {
  return result.terminalState === "HTR_WP22_CHECKPOINT_RESUME_PASS";
}
