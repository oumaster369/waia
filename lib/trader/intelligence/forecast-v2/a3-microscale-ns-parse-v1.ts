/**
 * Parse A3_MICROSCALE_NS override for non-authoritative microscale diagnostics.
 * Explicit override requires exactly the requested N values (including a single N).
 */

export function parseA3MicroscaleNs(raw: string | undefined): number[] {
  const source = (raw ?? "1000,5000,10000,25000,50000").trim();
  if (source.length === 0) {
    throw new Error("[a3-microscale] A3_MICROSCALE_NS must not be empty");
  }
  const parts = source.split(",").map((s) => s.trim());
  if (parts.some((p) => p.length === 0)) {
    throw new Error("[a3-microscale] A3_MICROSCALE_NS contains an empty token");
  }
  const ns: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new Error(`[a3-microscale] malformed A3_MICROSCALE_NS token: ${part}`);
    }
    const n = Number(part);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`[a3-microscale] A3_MICROSCALE_NS values must be positive integers: ${part}`);
    }
    if (n > 50_000) {
      throw new Error(`[a3-microscale] A3_MICROSCALE_NS value ${n} exceeds max 50000`);
    }
    ns.push(n);
  }
  if (new Set(ns).size !== ns.length) {
    throw new Error("[a3-microscale] A3_MICROSCALE_NS must not contain duplicates");
  }
  return ns;
}
