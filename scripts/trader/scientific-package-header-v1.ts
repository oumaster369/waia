/** Decode only the allowlisted projection of an authenticated codec/v1 header.
 * Not a package hydrator, scientific validator or independently trusted identity.
 * Unknown values are not interpreted. JSON input is bounded before parsing.
 */
export function projectScientificPackageHeaderV1(line: string) {
  const fail = (): never => { throw new Error("SCIENTIFIC_PACKAGE_HEADER_REFUSED"); };
  if (Buffer.byteLength(line) > 65536) fail();
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return fail(); }
  const tagged = (value: unknown, tag: string): unknown => {
    if (!Array.isArray(value) || value.length !== 2 || value[0] !== tag) return fail();
    return value[1];
  };
  const string = (value: unknown): string => {
    const result = tagged(value, "s");
    return typeof result === "string" ? result : fail();
  };
  const obj = (value: unknown): Map<string, unknown> => {
    const rows = tagged(value, "o"), out = new Map<string, unknown>();
    if (!Array.isArray(rows)) return fail();
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 2) return fail();
      const key = string(row[0]);
      if (out.has(key)) return fail();
      out.set(key, row[1]);
    }
    return out;
  };
  const number = (value: unknown): number => {
    const hex = tagged(value, "n");
    if (typeof hex !== "string" || !/^[a-f0-9]{16}$/.test(hex)) return fail();
    const result = Buffer.from(hex, "hex").readDoubleBE();
    return Number.isSafeInteger(result) && result > 0 ? result : fail();
  };
  const digest = (value: unknown, tag: "s" | "b"): string => {
    const result = tagged(value, tag);
    return typeof result === "string" && /^[a-f0-9]{64}$/.test(result) ? result : fail();
  };
  const record = tagged(parsed, "a");
  if (!Array.isArray(record) || record.length !== 2 || string(record[0]) !== "header") return fail();
  const header = obj(record[1]), family = obj(header.get("family"));
  const organizationId = string(family.get("organizationId"));
  const symbol = string(family.get("symbol"));
  const codeReleaseSha = string(family.get("codeReleaseSha"));
  if (!organizationId || organizationId.length > 128 || !/^[A-Z0-9]{1,32}$/.test(symbol) ||
      !/^[a-f0-9]{40}$/.test(codeReleaseSha)) return fail();
  return Object.freeze({ organizationId, symbol, codeReleaseSha,
    developmentDatasetDigestHex: digest(family.get("developmentDatasetDigestHex"), "s"),
    runtimeContractDigestHex: digest(header.get("runtimeContractDigest"), "b"),
    primaryHorizonMinutes: number(family.get("primaryHorizonMinutes")),
    k: number(header.get("kConfigDec")), m: number(header.get("mConfigDec")),
    generationDigestHex: digest(header.get("predictivePackageGenerationIdentityDigest"), "b"),
    contentDigestHex: digest(header.get("predictivePackageContentDigest"), "b"),
    targetGridDigestHex: digest(header.get("terminalTargetGridIdentityDigestHex"), "s"),
  });
}
