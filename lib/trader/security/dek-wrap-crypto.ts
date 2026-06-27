import { MasterKeyDecryptError, MasterKeyInvalidDekError } from "@/lib/trader/security/errors";
import type { WrappedDataKey } from "@/lib/trader/security/master-key-provider";

export const DEK_BYTE_LENGTH = 32;
export const DEK_WRAP_IV_BYTE_LENGTH = 12;
export const DEK_WRAP_AUTH_TAG_BYTE_LENGTH = 16;
export const DEK_WRAP_BLOB_BYTE_LENGTH =
  DEK_WRAP_IV_BYTE_LENGTH + DEK_BYTE_LENGTH + DEK_WRAP_AUTH_TAG_BYTE_LENGTH;

export function dekWrapAad(keyVersion: string): string {
  return `waia:trader:dek-wrap:${keyVersion}`;
}

export function assertDekByteLength(dek: Uint8Array): void {
  if (dek.byteLength !== DEK_BYTE_LENGTH) {
    throw new MasterKeyInvalidDekError();
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

export async function importAesGcmKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.byteLength !== DEK_BYTE_LENGTH) {
    throw new MasterKeyInvalidDekError("Master key material must be exactly 32 bytes.");
  }
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function decodeMasterKeyBase64(encoded: string): Uint8Array {
  const trimmed = encoded.trim();
  const binary = Buffer.from(trimmed, "base64");
  return new Uint8Array(binary);
}

export async function wrapDekWithMasterKey(input: {
  masterKey: CryptoKey;
  plaintextDek: Uint8Array;
  keyVersion: string;
}): Promise<WrappedDataKey> {
  assertDekByteLength(input.plaintextDek);
  const iv = new Uint8Array(DEK_WRAP_IV_BYTE_LENGTH);
  crypto.getRandomValues(iv);

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(dekWrapAad(input.keyVersion)),
      },
      input.masterKey,
      toArrayBuffer(input.plaintextDek),
    ),
  );

  if (encrypted.byteLength !== DEK_BYTE_LENGTH + DEK_WRAP_AUTH_TAG_BYTE_LENGTH) {
    throw new MasterKeyDecryptError("Unexpected AES-GCM output length while wrapping DEK.");
  }

  const blob = new Uint8Array(DEK_WRAP_BLOB_BYTE_LENGTH);
  blob.set(iv, 0);
  blob.set(encrypted, DEK_WRAP_IV_BYTE_LENGTH);

  return {
    keyVersion: input.keyVersion,
    wrappedKey: Buffer.from(blob).toString("base64"),
  };
}

export async function unwrapDekWithMasterKey(input: {
  masterKey: CryptoKey;
  wrapped: WrappedDataKey;
}): Promise<Uint8Array> {
  let blob: Uint8Array;
  try {
    blob = new Uint8Array(Buffer.from(input.wrapped.wrappedKey, "base64"));
  } catch {
    throw new MasterKeyDecryptError("Wrapped data key is not valid base64.");
  }

  if (blob.byteLength !== DEK_WRAP_BLOB_BYTE_LENGTH) {
    throw new MasterKeyDecryptError("Wrapped data key blob has invalid length.");
  }

  const iv = new Uint8Array(blob.subarray(0, DEK_WRAP_IV_BYTE_LENGTH));
  const ciphertextAndTag = new Uint8Array(blob.subarray(DEK_WRAP_IV_BYTE_LENGTH));

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(dekWrapAad(input.wrapped.keyVersion)),
      },
      input.masterKey,
      toArrayBuffer(ciphertextAndTag),
    );
  } catch {
    throw new MasterKeyDecryptError();
  }

  const dek = new Uint8Array(plaintext);
  assertDekByteLength(dek);
  return dek;
}

export async function generateRandomDek(): Promise<Uint8Array> {
  const dek = new Uint8Array(DEK_BYTE_LENGTH);
  crypto.getRandomValues(dek);
  return dek;
}
