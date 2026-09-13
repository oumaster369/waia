import { createHash } from "node:crypto";
import { computePoolSemanticDigest, type PoolSemanticDigestInput } from "./pool-semantic-digest-v1";
import { quantizeScale8HalfUp } from "./quantize-scale8-half-up-v1";
import { assertAsciiLine, assertCanonicalIntegerLine, assertDigestHex64 } from "./scientific-identity-validators-v1";
import { FEATURE_VERSION, OUTCOME_VERSION, POOL_SEM_VERSION, STATE_ASSIGNMENT_VERSION, type SourceAnchor } from "./source-anchor-v1";

// Fixed implementation policy, not an environment/public hydration option.
// The Map has at most MAX_ENTRIES keys; its engine-dependent heap overhead is
// additional to this exact arena + Uint32 backing-store cap.
const MAX_BACKING_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 262_144;
const ARENA_BYTES_PER_ENTRY = 512;
const MAX_SUFFIX_BYTES = 8192;

/** @internal Only the codec's synchronous final validation of freshly decoded,
 * unpublished plain records may call this scope. No await, source iterator or
 * caller callback occurs inside that validation. This is NOT a mutable-object
 * cache for the public pool digest API. No owned object is frozen or modified.
 *
 * Reuse changes hash update boundaries, never bytes or validation decisions.
 * Unsupported suffixes/capacity exhaustion use the complete original suffix
 * emission; unavailable allocation uses the unchanged full pool implementation.
 */
export function withHydrationPoolDigestsV1<T>(
  sourceCount: number,
  validate: (compute: typeof computePoolSemanticDigest) => T,
): T {
  const entries = Number.isSafeInteger(sourceCount) && sourceCount > 0
    ? Math.min(sourceCount, MAX_ENTRIES) : 0;
  const metadataBytes = entries * 8;
  const arenaBytes = Math.min(entries * ARENA_BYTES_PER_ENTRY, MAX_BACKING_BYTES - metadataBytes);
  let offsets: Uint32Array | null = null;
  let lengths: Uint32Array | null = null;
  let arena: Buffer | null = null;
  const indices = new Map<SourceAnchor, number>();
  let active = true, used = 0;
  if (entries > 0 && arenaBytes > 0) {
    try {
      offsets = new Uint32Array(entries);
      lengths = new Uint32Array(entries);
      // Avoid pooled slab aliasing/accounting, and don't allocate 64MiB for tiny fixtures.
      arena = Buffer.allocUnsafeSlow(arenaBytes);
    } catch {
      // Allocation is an optimization concern, never permission to omit validation.
      offsets = null; lengths = null; arena = null;
    }
  }
  const originalSuffix = (a: SourceAnchor, emit: (bytes: Buffer) => void) => {
    const line = (value: string) => emit(Buffer.from(`${value}\n`, "utf8"));
    line(assertCanonicalIntegerLine(a.closedBarEpochMs, "closedBarEpochMs"));
    line(a.venue); line(a.market); line(a.symbol);
    if (a.outcome13d.length !== 13)
      throw new Error("[forecast-v2/pool-sem] outcome13d must have 13 components");
    for (const component of a.outcome13d) line(quantizeScale8HalfUp(component));
  };
  const suffix = (a: SourceAnchor, emit: (bytes: Buffer) => void) => {
    const index = indices.get(a);
    if (index !== undefined && arena && offsets && lengths) {
      emit(arena.subarray(offsets[index]!, offsets[index]! + lengths[index]!));
      return;
    }
    // Bound temporary grouping; unusual but valid source text remains supported
    // through exactly the old per-field path, with no added scientific rejection.
    if (typeof a.venue !== "string" || a.venue.length > 256 ||
        typeof a.market !== "string" || a.market.length > 256 ||
        typeof a.symbol !== "string" || a.symbol.length > 256 ||
        !Array.isArray(a.outcome13d) || a.outcome13d.length !== 13) {
      originalSuffix(a, emit); return;
    }
    const fields = [assertCanonicalIntegerLine(a.closedBarEpochMs, "closedBarEpochMs"), a.venue, a.market, a.symbol];
    for (const component of a.outcome13d) fields.push(quantizeScale8HalfUp(component));
    const bytes = Buffer.from(fields.join("\n") + "\n", "utf8");
    // Finite binary64 with the bounded fields above fits this bound. If the
    // quantizer contract is ever widened, correctness still wins over caching.
    if (bytes.length <= MAX_SUFFIX_BYTES && arena && offsets && lengths &&
        indices.size < entries && bytes.length <= arena.length - used) {
      const slot = indices.size;
      bytes.copy(arena, used); offsets[slot] = used; lengths[slot] = bytes.length;
      indices.set(a, slot); used += bytes.length;
    }
    emit(bytes);
  };
  const compute = (input: PoolSemanticDigestInput): Buffer => {
    if (!active || !arena) return computePoolSemanticDigest(input);
    // Same validators, header order and ordinal sort as the unchanged reference.
    assertAsciiLine(input.organizationId, "organizationId");
    assertAsciiLine(input.venue, "venue");
    assertAsciiLine(input.market, "market");
    assertAsciiLine(input.symbol, "symbol");
    assertDigestHex64(input.developmentDatasetDigestHex, "developmentDatasetDigestHex");
    const hasher = createHash("sha256");
    const emit = (bytes: Buffer) => { hasher.update(bytes); };
    const header = [POOL_SEM_VERSION, input.organizationId, input.venue, input.market, input.symbol,
      assertCanonicalIntegerLine(input.primaryHorizonMinutes, "primaryHorizonMinutes"),
      assertCanonicalIntegerLine(input.replicaOrdinal, "replicaOrdinal"), input.stateId,
      FEATURE_VERSION, OUTCOME_VERSION, STATE_ASSIGNMENT_VERSION];
    for (const value of header) emit(Buffer.from(`${value}\n`, "utf8"));
    emit(Buffer.from(input.developmentDatasetDigestHex, "hex"));
    emit(Buffer.from(`${assertCanonicalIntegerLine(input.observations.length, "n_pool")}\n`, "utf8"));
    const ordered = [...input.observations].sort((a, b) => a.resamplePositionOrdinal - b.resamplePositionOrdinal);
    for (const obs of ordered) {
      emit(Buffer.from(`${assertCanonicalIntegerLine(obs.resamplePositionOrdinal, "resamplePositionOrdinal")}\n`, "utf8"));
      suffix(obs.anchor, emit);
    }
    return hasher.digest();
  };
  try { return validate(compute); }
  finally {
    active = false; indices.clear(); arena = null; offsets = null; lengths = null;
  }
}
