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

function emitPoolSemanticDigestChunks(
  input: PoolSemanticDigestInput,
  emit: (chunk: Buffer) => void,
): void {
  assertAsciiLine(input.organizationId, "organizationId");
  assertAsciiLine(input.venue, "venue");
  assertAsciiLine(input.market, "market");
  assertAsciiLine(input.symbol, "symbol");
  assertDigestHex64(input.developmentDatasetDigestHex, "developmentDatasetDigestHex");

  const header: Buffer[] = [
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
  for (const chunk of header) emit(chunk);

  const ordered = [...input.observations].sort(
    (a, b) => a.resamplePositionOrdinal - b.resamplePositionOrdinal,
  );

  for (const obs of ordered) {
    emit(
      line(assertCanonicalIntegerLine(obs.resamplePositionOrdinal, "resamplePositionOrdinal")),
    );
    emit(line(assertCanonicalIntegerLine(obs.anchor.closedBarEpochMs, "closedBarEpochMs")));
    emit(line(obs.anchor.venue));
    emit(line(obs.anchor.market));
    emit(line(obs.anchor.symbol));
    if (obs.anchor.outcome13d.length !== 13) {
      throw new Error("[forecast-v2/pool-sem] outcome13d must have 13 components");
    }
    for (const component of obs.anchor.outcome13d) {
      emit(line(quantizeScale8HalfUp(component)));
    }
  }
}

export function buildPoolSemanticDigestStream(input: PoolSemanticDigestInput): Buffer {
  const chunks: Buffer[] = [];
  emitPoolSemanticDigestChunks(input, (chunk) => chunks.push(chunk));
  return Buffer.concat(chunks);
}

export function computePoolSemanticDigest(input: PoolSemanticDigestInput): Buffer {
  const hasher = createHash("sha256");
  // Preserve the canonical bytes without retaining every field Buffer or the full stream.
  emitPoolSemanticDigestChunks(input, (chunk) => {
    hasher.update(chunk);
  });
  return hasher.digest();
}
