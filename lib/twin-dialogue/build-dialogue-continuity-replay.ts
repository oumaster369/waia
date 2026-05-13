import type { ProviderMessage } from "@/lib/ai-gateway/completion-types";
import type { TwinDialogueTurnDbRow } from "@/lib/twin-persistence/loader";
import {
  DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS,
  DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS_PER_TURN,
  DIALOGUE_CONTINUITY_MAX_REPLAY_MESSAGES,
} from "@/lib/twin-dialogue/dialogue-continuity-config";

export type DialogueContinuityReplayBuildResult = {
  priorMessages: ProviderMessage[];
  /** Number of replay messages forwarded to provider (excluding current turn). */
  replayRolesInjected: number;
  replayCharsTotal: number;
  /** True when any persisted content was clipped or newer turns omitted due to budgets. */
  replayTruncated: boolean;
};

function clipTurnContent(content: string, perTurnCap: number): { text: string; clipped: boolean } {
  const t = content.trimEnd();
  if (t.length <= perTurnCap) {
    return { text: t, clipped: false };
  }
  return { text: t.slice(-perTurnCap), clipped: true };
}

/**
 * Build bounded chronological replay messages for the Twin completion envelope (DEE-109).
 * `rowsTailChronological` is the persisted tail oldest→newest; must not include the current request.
 */
export function buildBoundedDialogueContinuityReplay(
  rowsTailChronological: ReadonlyArray<TwinDialogueTurnDbRow>,
): DialogueContinuityReplayBuildResult {
  let replayTruncated = false;
  const pickedNewestFirst: ProviderMessage[] = [];

  for (let i = rowsTailChronological.length - 1; i >= 0; i--) {
    if (pickedNewestFirst.length >= DIALOGUE_CONTINUITY_MAX_REPLAY_MESSAGES) {
      replayTruncated = true;
      break;
    }

    const row = rowsTailChronological[i]!;
    if (row.role !== "user" && row.role !== "assistant") {
      continue;
    }

    const clipped = clipTurnContent(row.content, DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS_PER_TURN);
    if (clipped.clipped) {
      replayTruncated = true;
    }

    const currentChars = pickedNewestFirst.reduce((sum, m) => sum + m.content.length, 0);
    const remainingBudget = DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS - currentChars;
    if (remainingBudget <= 0) {
      replayTruncated = true;
      break;
    }

    let text = clipped.text;
    if (text.length > remainingBudget) {
      text = text.slice(-remainingBudget);
      replayTruncated = true;
    }

    pickedNewestFirst.push({ role: row.role, content: text });

    const newTotal = pickedNewestFirst.reduce((sum, m) => sum + m.content.length, 0);
    if (newTotal >= DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS) {
      replayTruncated = true;
      break;
    }
  }

  const priorMessages = pickedNewestFirst.slice().reverse();
  const replayCharsTotal = priorMessages.reduce((sum, m) => sum + m.content.length, 0);

  return {
    priorMessages,
    replayRolesInjected: priorMessages.length,
    replayCharsTotal,
    replayTruncated,
  };
}
