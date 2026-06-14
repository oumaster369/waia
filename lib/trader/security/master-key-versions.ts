/** Supported master key versions (DEE-220 §4). DEE-196c adds v2+. */
export const CURRENT_MASTER_KEY_VERSION = "v1" as const;

export type MasterKeyVersion = typeof CURRENT_MASTER_KEY_VERSION | string;

/** Version label → Secrets Store secret name (extensible for rotation). */
export const MASTER_KEY_SECRET_NAMES_BY_VERSION: Readonly<Record<string, string>> = {
  v1: "ai-trader-master-key-v1",
};

export function resolveMasterKeySecretName(version: string): string | undefined {
  return MASTER_KEY_SECRET_NAMES_BY_VERSION[version];
}

export function assertSupportedMasterKeyVersion(version: string): void {
  if (!resolveMasterKeySecretName(version)) {
    throw new Error(`Unsupported master key version: ${version}`);
  }
}
