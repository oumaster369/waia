/** Bounded codec/v1 JSON record decoder for authenticated diagnostic input only. */
export function decodeScientificRecordV1(line: string): unknown {
  const fail = (): never => { throw new Error("SCIENTIFIC_RECORD_REFUSED"); };
  if (Buffer.byteLength(line) > 65536) fail();
  function decode(v: unknown, depth = 0): unknown {
    if (depth > 32) return fail();
    if (v === null || typeof v === "boolean") return v;
    if (!Array.isArray(v) || v.length !== 2) return fail();
    const [tag, data] = v;
    if (tag === "s" && typeof data === "string") return data;
    if ((tag === "n" || tag === "b") && typeof data === "string" && /^(?:[a-f0-9]{2})*$/.test(data)) {
      const bytes = Buffer.from(data, "hex");
      if (tag === "b") return bytes;
      if (bytes.length !== 8) return fail();
      const n = bytes.readDoubleBE();
      return Number.isFinite(n) ? n : fail();
    }
    if (tag === "a" && Array.isArray(data)) return data.map(x => decode(x, depth + 1));
    if (tag === "o" && Array.isArray(data)) {
      const out: Record<string, unknown> = {};
      for (const pair of data) {
        if (!Array.isArray(pair) || pair.length !== 2) return fail();
        const key = decode(pair[0], depth + 1);
        if (typeof key !== "string" || Object.hasOwn(out, key)) return fail();
        Object.defineProperty(out, key, { value: decode(pair[1], depth + 1), enumerable: true });
      }
      return out;
    }
    return fail();
  }
  try { return decode(JSON.parse(line)); } catch { return fail(); }
}
