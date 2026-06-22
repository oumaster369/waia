const TRUST_SCORE_SCALE = 8;

/**
 * Canonical decimal string for trust scores (0..1 inclusive).
 * Same form is used for persistence and digest input.
 */
export function normalizeTrustScore(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("TRUST_SCORE_EMPTY");
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("TRUST_SCORE_OUT_OF_RANGE");
  }

  return value.toFixed(TRUST_SCORE_SCALE);
}
