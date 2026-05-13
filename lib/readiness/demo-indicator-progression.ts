import type { IndicatorPercent, IndicatorVector } from "@/lib/readiness/types";

/** Minimum trimmed length before a Twin user message qualifies for demo advancement (v1 heuristic). */
export const DEMO_READINESS_MIN_MESSAGE_CHARS = 24;

/**
 * Self-referential tokens (Russian + English) as whole-ish tokens — avoids matching substrings inside unrelated words.
 * Uses Unicode letters for boundaries via `\p{L}` (requires `u` flag).
 */
const SELF_REFERRAL_PATTERN =
  /(?:^|[^\p{L}])(?:я|мне|мой|моя|мои|мы|меня|i|me|my|mine|we)(?:$|[^\p{L}])/iu;

export function messageLooksSelfReferential(userMessageTrimmed: string): boolean {
  return SELF_REFERRAL_PATTERN.test(userMessageTrimmed.normalize("NFC"));
}

function nextDemoStage(from: IndicatorPercent): IndicatorPercent | null {
  if (from === 0) return 33;
  if (from === 33) return 67;
  if (from === 67) return 100;
  return null;
}

/**
 * Chooses one indicator at the lowest non-terminal stage (lowest numeric value wins; ties → lowest index).
 * Advances by exactly one DEE-22 stage on that indicator when the user message is substantive + self-referential.
 */
export function planDemoReadinessAdvancement(
  indicators: IndicatorVector,
  userMessageTrimmed: string,
): { indicatorIndex: number; from: IndicatorPercent; to: IndicatorPercent } | null {
  const t = userMessageTrimmed.trim();
  if (t.length < DEMO_READINESS_MIN_MESSAGE_CHARS) {
    return null;
  }
  if (!messageLooksSelfReferential(t)) {
    return null;
  }

  let bestIdx = -1;
  for (let i = 0; i < 6; i++) {
    const v = indicators[i];
    if (v === 100) continue;
    if (bestIdx === -1 || v < indicators[bestIdx]) {
      bestIdx = i;
    }
  }

  if (bestIdx === -1) {
    return null;
  }

  const from = indicators[bestIdx];
  const to = nextDemoStage(from);
  if (to === null) {
    return null;
  }

  return { indicatorIndex: bestIdx, from, to };
}
