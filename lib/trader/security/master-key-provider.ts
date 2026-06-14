import { generateRandomDek } from "@/lib/trader/security/dek-wrap-crypto";

/** Metadata persisted alongside wrapped data keys (DEE-196 stores with credential ciphertext). */
export type WrappedDataKey = {
  /** Master key version label, e.g. "v1". Must match wrap-time version. */
  keyVersion: string;
  /** Base64 of [ iv (12B) | ciphertext (32B) | authTag (16B) ]. */
  wrappedKey: string;
};

export interface MasterKeyProvider {
  encryptDataKey(plaintextDataKey: Uint8Array): Promise<WrappedDataKey>;
  decryptDataKey(wrapped: WrappedDataKey): Promise<Uint8Array>;
  getCurrentKeyVersion(): string;
  isProductionReady(): boolean;
}

export async function generateDataKey(
  provider: MasterKeyProvider,
): Promise<{ plaintext: Uint8Array; wrapped: WrappedDataKey }> {
  const plaintext = await generateRandomDek();
  const wrapped = await provider.encryptDataKey(plaintext);
  return { plaintext, wrapped };
}
