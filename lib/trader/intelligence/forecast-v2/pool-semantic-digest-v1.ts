import { createHash } from "node:crypto";

import {
  FEATURE_VERSION,
  OUTCOME_VERSION,
  POOL_SEM_VERSION,
  STATE_ASSIGNMENT_VERSION,
  type PoolObservation,
} from "./source-anchor-v1";
import { quantizeScale8HalfUp } from "./quantize-scale8-half-up-v1";
import {
  assertAsciiLine,
  assertCanonicalIntegerLine,
  assertDigestHex64,
} from "./scientific-identity-validators-v1";

export { POOL_SEM_VERSION };

function line(value: string): Buffer {
  return Buffer.from(`${value}\n`, "utf8");
}

export type PoolSemanticDigestInput = {
  organizationId: string;
  venue: string;
  market: string;
  symbol: string;
  primaryHorizonMinutes: number;
  replicaOrdinal: number;
  stateId: "S0" | "S1" | "S2";
  developmentDatasetDigestHex: string;
  observations: readonly PoolObservation[];
};

export function buildPoolSemanticDigestStream(input: PoolSemanticDigestInput): Buffer {
  assertAsciiLine(input.organizationId, "organizationId");
  assertAsciiLine(input.venue, "venue");
  assertAsciiLine(input.market, "market");
  assertAsciiLine(input.symbol, "symbol");
  assertDigestHex64(input.developmentDatasetDigestHex, "developmentDatasetDigestHex");

  const chunks: Buffer[] = [
    line(POOL_SEM_VERSION),
    line(input.organizationId),
    line(input.venue),
    line(input.market),
    line(input.symbol),
    line(assertCanonicalIntegerLine(input.primaryHorizonMinutes, "primaryHorizonMinutes")),
    line(assertCanonicalIntegerLine(input.replicaOrdinal, "replicaOrdinal")),
    line(input.stateId),
    line(FEATURE_VERSION),
    line(OUTCOME_VERSION),
    line(STATE_ASSIGNMENT_VERSION),
    Buffer.from(input.developmentDatasetDigestHex, "hex"),
    line(assertCanonicalIntegerLine(input.observations.length, "n_pool")),
  ];

  const ordered = [...input.observations].sort(
    (a, b) => a.resamplePositionOrdinal - b.resamplePositionOrdinal,
  );

  for (const obs of ordered) {
    chunks.push(
      line(assertCanonicalIntegerLine(obs.resamplePositionOrdinal, "resamplePositionOrdinal")),
    );
    chunks.push(line(assertCanonicalIntegerLine(obs.anchor.closedBarEpochMs, "closedBarEpochMs")));
    chunks.push(line(obs.anchor.venue));
    chunks.push(line(obs.anchor.market));
    chunks.push(line(obs.anchor.symbol));
    if (obs.anchor.outcome13d.length !== 13) {
      throw new Error("[forecast-v2/pool-sem] outcome13d must have 13 components");
    }
    for (const component of obs.anchor.outcome13d) {
      chunks.push(line(quantizeScale8HalfUp(component)));
    }
  }

  return Buffer.concat(chunks);
}

export function computePoolSemanticDigest(input: PoolSemanticDigestInput): Buffer {
  return createHash("sha256").update(buildPoolSemanticDigestStream(input)).digest();
}
