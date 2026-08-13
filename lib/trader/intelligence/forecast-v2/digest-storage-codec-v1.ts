import { assertDigestHex64 } from "./scientific-identity-validators-v1";

/** Physical DB representation: SHA-256 as exactly 32 bytes (bytea). */
export function digestHexToBytea(hex: string): Buffer {
  assertDigestHex64(hex, "digestHex");
  return Buffer.from(hex, "hex");
}

/** Reconstruct canonical lowercase hex from DB bytea (or already-hex text). */
export function digestByteaToHex(value: Buffer | Uint8Array | string): string {
  if (typeof value === "string") {
    if (value.startsWith("\\x") || value.startsWith("\\X")) {
      const hex = value.slice(2).toLowerCase();
      assertDigestHex64(hex, "digestByteaToHex");
      return hex;
    }
    const hex = value.toLowerCase();
    assertDigestHex64(hex, "digestByteaToHex");
    return hex;
  }
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (buf.length !== 32) {
    throw new Error(`[digest-storage] expected 32-byte digest, got ${buf.length}`);
  }
  return buf.toString("hex");
}
