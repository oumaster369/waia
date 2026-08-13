import { createHash } from "node:crypto";

import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export function sha256HexFromBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeSha256Hex(value: string, label = "sha256"): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_HEX_RE.test(normalized)) {
    throw new TreasuryValidationError(
      "INVALID_SHA256",
      `${label} must be a 64-char lowercase hex digest`,
    );
  }
  return normalized;
}

export function arrayBufferToSha256Hex(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("hex");
}

export function sha256HexToArrayBuffer(hex: string): ArrayBuffer {
  const normalized = normalizeSha256Hex(hex);
  const bytes = Buffer.from(normalized, "hex");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
