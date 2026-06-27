import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";
import {
  CredentialDecryptError,
  CredentialPayloadInvalidError,
} from "@/lib/trader/credentials/errors";
import type { ExchangeCredentialRow } from "@/lib/trader/credentials/types";
import {
  DEK_WRAP_AUTH_TAG_BYTE_LENGTH,
  DEK_WRAP_IV_BYTE_LENGTH,
  importAesGcmKey,
} from "@/lib/trader/security/dek-wrap-crypto";
import { credentialPayloadAad } from "@/lib/trader/security/index";
import {
  generateDataKey,
  type MasterKeyProvider,
  type WrappedDataKey,
} from "@/lib/trader/security/master-key-provider";

export const CREDENTIAL_PAYLOAD_IV_BYTE_LENGTH = DEK_WRAP_IV_BYTE_LENGTH;
export const CREDENTIAL_PAYLOAD_AUTH_TAG_BYTE_LENGTH = DEK_WRAP_AUTH_TAG_BYTE_LENGTH;

export type EncryptedCredentialPayload = {
  encryptedPayload: string;
  payloadKeyVersion: string;
  wrappedDekKeyVersion: string;
  wrappedDekKey: string;
};

type CredentialPayloadJson = {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function zeroizeDek(dek: Uint8Array): void {
  dek.fill(0);
}

function serializeCredentialPayload(credentials: ConnectorCredentialInput): Uint8Array {
  const payload: CredentialPayloadJson = {
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
  };
  if (credentials.passphrase !== undefined) {
    payload.passphrase = credentials.passphrase;
  }
  return new TextEncoder().encode(JSON.stringify(payload));
}

function parseCredentialPayload(bytes: Uint8Array): ConnectorCredentialInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CredentialPayloadInvalidError();
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as CredentialPayloadJson).apiKey !== "string" ||
    typeof (parsed as CredentialPayloadJson).apiSecret !== "string"
  ) {
    throw new CredentialPayloadInvalidError();
  }

  const record = parsed as CredentialPayloadJson;
  const result: ConnectorCredentialInput = {
    apiKey: record.apiKey,
    apiSecret: record.apiSecret,
  };
  if (record.passphrase !== undefined) {
    result.passphrase = record.passphrase;
  }
  return result;
}

function toWrappedDataKey(row: ExchangeCredentialRow): WrappedDataKey {
  if (!row.wrappedDekKeyVersion || !row.wrappedDekKey) {
    throw new CredentialPayloadInvalidError("Wrapped data key metadata is missing.");
  }
  return {
    keyVersion: row.wrappedDekKeyVersion,
    wrappedKey: row.wrappedDekKey,
  };
}

/** Envelope-encrypt connector credentials with a per-record DEK (DEE-234). */
export async function encryptCredentialPayload(
  provider: MasterKeyProvider,
  credentials: ConnectorCredentialInput,
): Promise<EncryptedCredentialPayload> {
  const { plaintext: dek, wrapped } = await generateDataKey(provider);
  const keyVersion = provider.getCurrentKeyVersion();

  try {
    const dekKey = await importAesGcmKey(dek);
    const plaintext = serializeCredentialPayload(credentials);
    const iv = new Uint8Array(CREDENTIAL_PAYLOAD_IV_BYTE_LENGTH);
    crypto.getRandomValues(iv);

    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(credentialPayloadAad(keyVersion)),
        },
        dekKey,
        toArrayBuffer(plaintext),
      ),
    );

    const blob = new Uint8Array(iv.byteLength + encrypted.byteLength);
    blob.set(iv, 0);
    blob.set(encrypted, iv.byteLength);

    return {
      encryptedPayload: Buffer.from(blob).toString("base64"),
      payloadKeyVersion: keyVersion,
      wrappedDekKeyVersion: wrapped.keyVersion,
      wrappedDekKey: wrapped.wrappedKey,
    };
  } finally {
    zeroizeDek(dek);
  }
}

/** Decrypt envelope-encrypted connector credentials (server-only). */
export async function decryptCredentialPayload(
  provider: MasterKeyProvider,
  row: ExchangeCredentialRow,
): Promise<ConnectorCredentialInput> {
  if (!row.encryptedPayload || !row.payloadKeyVersion) {
    throw new CredentialPayloadInvalidError();
  }

  let blob: Uint8Array;
  try {
    blob = new Uint8Array(Buffer.from(row.encryptedPayload, "base64"));
  } catch {
    throw new CredentialDecryptError("Encrypted payload is not valid base64.");
  }

  if (
    blob.byteLength <=
    CREDENTIAL_PAYLOAD_IV_BYTE_LENGTH + CREDENTIAL_PAYLOAD_AUTH_TAG_BYTE_LENGTH
  ) {
    throw new CredentialDecryptError("Encrypted payload blob has invalid length.");
  }

  const iv = new Uint8Array(blob.subarray(0, CREDENTIAL_PAYLOAD_IV_BYTE_LENGTH));
  const ciphertextAndTag = new Uint8Array(blob.subarray(CREDENTIAL_PAYLOAD_IV_BYTE_LENGTH));
  const wrapped = toWrappedDataKey(row);
  const dek = await provider.decryptDataKey(wrapped);

  try {
    const dekKey = await importAesGcmKey(dek);
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(credentialPayloadAad(row.payloadKeyVersion)),
        },
        dekKey,
        toArrayBuffer(ciphertextAndTag),
      );
    } catch {
      throw new CredentialDecryptError();
    }

    return parseCredentialPayload(new Uint8Array(plaintext));
  } finally {
    zeroizeDek(dek);
  }
}
