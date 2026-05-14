import "server-only";

/** DEE-109 Slice 1 — bounded transcript replay only; default off for rollback parity. */

export function isTwinDialogueContinuityReplayEnabled(): boolean {
  const raw = process.env.WAIA_TWIN_DIALOGUE_CONTINUITY;
  if (raw === undefined || raw === "") {
    return false;
  }
  const v = raw.trim().toLowerCase();
  return (
    v === "1" ||
    v === "true" ||
    v === "yes" ||
    v === "on" ||
    v === "replay" ||
    v === "replay_v1"
  );
}

/** Max persisted role rows (user+assistant+…) considered when building replay (after SQL tail). */
export const DIALOGUE_CONTINUITY_SQL_TAIL_LIMIT = 48;

/** Max user+assistant messages injected into provider history (excluding current turn). */
export const DIALOGUE_CONTINUITY_MAX_REPLAY_MESSAGES = 6;

/** Total character budget for replay content only (excluding current message). */
export const DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS = 2400;

/** Per-turn cap for replay; longer stored turns are tail-preserved truncation. */
export const DIALOGUE_CONTINUITY_MAX_REPLAY_CHARS_PER_TURN = 800;
