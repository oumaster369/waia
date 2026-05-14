/**
 * Fallback assistant copy when the Twin cannot return model text this turn — still surfaced as
 * `assistantPlaceholder` on success responses when `assistantTurn` is null, and used as degraded
 * assistant text after provider/config failures (live gateway path preserves HTTP 200; DEE-79).
 */

export const TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE =
  "The Twin couldn't reply this time—your words may still be saved. Try again shortly.";
