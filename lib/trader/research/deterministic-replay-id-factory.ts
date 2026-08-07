/**
 * Deterministic replay ID factory (HTR-WP10 / DEE-415).
 *
 * Research/backtest replay must never let `crypto.randomUUID()` reach semantic
 * evidence when the default session factory runs without caller-supplied IDs.
 * These factories produce stable, monotonic UUID-shaped strings from fixed
 * namespace seeds so two replays over the same bars yield byte-identical IDs.
 */

import { computeStableJsonDigest } from "@/lib/trader/research/digest";

/** First golden-fixture bar close — canonical replay clock seed (HTR-WP10). */
export const RESEARCH_REPLAY_CLOCK_START_MS = Date.parse("2026-01-01T00:01:00.000Z");

export const RESEARCH_REPLAY_ID_NAMESPACE = {
  session: 415_700,
  decision: 415_800,
  order: 415_900,
} as const;

export type FhvDeterministicIdFrontierV1 = {
  schemaVersion: "fhv-deterministic-id-frontier/v1";
  namespaceSeed: number;
  sequence: number;
  contentDigest: string;
};

export type DeterministicReplayIdFactory = {
  (): string;
  captureFrontier: () => FhvDeterministicIdFrontierV1;
  restoreFrontier: (frontier: FhvDeterministicIdFrontierV1) => void;
};

function buildFrontierBody(namespaceSeed: number, sequence: number) {
  return {
    schemaVersion: "fhv-deterministic-id-frontier/v1" as const,
    namespaceSeed,
    sequence,
  };
}

export function createDeterministicReplayIdFactory(
  namespaceSeed: number,
): DeterministicReplayIdFactory {
  let sequence = 0;

  const next = (): string => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(namespaceSeed + sequence).padStart(12, "0")}`;
  };

  const captureFrontier = (): FhvDeterministicIdFrontierV1 => {
    const body = buildFrontierBody(namespaceSeed, sequence);
    return {
      ...body,
      contentDigest: computeStableJsonDigest(body),
    };
  };

  const restoreFrontier = (frontier: FhvDeterministicIdFrontierV1): void => {
    if (frontier.namespaceSeed !== namespaceSeed) {
      throw new Error(
        `[fhv] deterministic id frontier namespace mismatch: expected ${namespaceSeed}, got ${frontier.namespaceSeed}`,
      );
    }
    const body = buildFrontierBody(frontier.namespaceSeed, frontier.sequence);
    if (computeStableJsonDigest(body) !== frontier.contentDigest) {
      throw new Error("[fhv] deterministic id frontier contentDigest mismatch");
    }
    sequence = frontier.sequence;
  };

  const factory = next as DeterministicReplayIdFactory;
  factory.captureFrontier = captureFrontier;
  factory.restoreFrontier = restoreFrontier;
  return factory;
}
