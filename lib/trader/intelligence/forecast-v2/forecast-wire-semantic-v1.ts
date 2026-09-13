import { createHash } from "node:crypto";
import { compareCodePoints } from "../htr-semantic-canonical-json";

/** Exact HTR_SEMANTIC_CANONICAL_JSON_V1 bytes for admitted forecast JSON, streamed.
 * Native Buffers deliberately retain legacy numeric-key semantics; JSON Buffer
 * wire objects are different values, just as in the original canonicalizer.
 * Prototype-mutating keys are explicitly refused, not given legacy setter semantics.
 */
export function computeForecastWireSemanticDigestV1(value: unknown): string {
  const hash = createHash("sha256");
  const active = new Set<object>();
  const write = (item: unknown): void => {
    if (item === null || typeof item === "boolean" || typeof item === "string") {
      hash.update(JSON.stringify(item));
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item))
        throw new Error("HTR_SEMANTIC_CANONICAL_JSON_V1: non-finite number prohibited");
      hash.update(JSON.stringify(item));
      return;
    }
    if (typeof item !== "object")
      throw new Error("HTR_SEMANTIC_CANONICAL_JSON_V1: unsupported value type");
    if (active.has(item)) throw new Error("FORECAST_WIRE_SEMANTIC_CYCLE");
    active.add(item);
    if (Array.isArray(item)) {
      hash.update("[");
      for (let i = 0; i < item.length; i++) {
        if (i) hash.update(",");
        if (i in item) write(item[i]);
        else hash.update("null");
      }
      hash.update("]");
    } else {
      const keys = Object.keys(item).sort(compareCodePoints);
      if (keys.includes("__proto__")) throw new Error("FORECAST_WIRE_SEMANTIC_PROTOTYPE_KEY");
      const isIndex = (key: string) => /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < 4294967295;
      // The old sorted-object construction is then enumerated by JSON.stringify:
      // integer-index properties first numerically, followed by inserted string keys.
      const ordered = [
        ...keys.filter(isIndex).sort((a, b) => Number(a) - Number(b)),
        ...keys.filter((key) => !isIndex(key)),
      ];
      hash.update("{");
      for (const [i, key] of ordered.entries()) {
        if (i) hash.update(",");
        hash.update(JSON.stringify(key));
        hash.update(":");
        write((item as Record<string, unknown>)[key]);
      }
      hash.update("}");
    }
    active.delete(item);
  };
  write(value);
  return hash.digest("hex");
}
