/**
 * Deterministic replay ID factory (HTR-WP10 / DEE-415).
 *
 * Research/backtest replay must never let `crypto.randomUUID()` reach semantic
 * evidence when the default session factory runs without caller-supplied IDs.
 * These factories produce stable, monotonic UUID-shaped strings from fixed
 * namespace seeds so two replays over the same bars yield byte-identical IDs.
 */

/** First golden-fixture bar close — canonical replay clock seed (HTR-WP10). */
export const RESEARCH_REPLAY_CLOCK_START_MS = Date.parse("2026-01-01T00:01:00.000Z");

export const RESEARCH_REPLAY_ID_NAMESPACE = {
  session: 415_700,
  decision: 415_800,
  order: 415_900,
} as const;

export function createDeterministicReplayIdFactory(namespaceSeed: number): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(namespaceSeed + sequence).padStart(12, "0")}`;
  };
}
