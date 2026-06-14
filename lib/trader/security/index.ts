import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

export { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
export type { CreateMasterKeyProviderOptions } from "@/lib/trader/security/create-master-key-provider";
export { assertCredentialStorageAllowed } from "@/lib/trader/security/credential-storage-gate";
export { DEK_BYTE_LENGTH, dekWrapAad } from "@/lib/trader/security/dek-wrap-crypto";
export {
  getDeploymentTier,
  isDevMasterKeyModeEnabled,
  isPreviewOrStagingDeployment,
  isProductionDeployment,
} from "@/lib/trader/security/deployment-tier";
export { DevMasterKeyProvider } from "@/lib/trader/security/dev-master-key-provider";
export {
  MASTER_KEY_ERROR_CODES,
  MasterKeyConfigError,
  MasterKeyDecryptError,
  MasterKeyError,
  MasterKeyInvalidDekError,
  MasterKeyNotReadyError,
  MasterKeyVersionMismatchError,
} from "@/lib/trader/security/errors";
export type { MasterKeyErrorCode } from "@/lib/trader/security/errors";
export {
  generateDataKey,
  type MasterKeyProvider,
  type WrappedDataKey,
} from "@/lib/trader/security/master-key-provider";
export {
  CURRENT_MASTER_KEY_VERSION,
  MASTER_KEY_SECRET_NAMES_BY_VERSION,
  resolveMasterKeySecretName,
} from "@/lib/trader/security/master-key-versions";
export {
  SecretsStoreMasterKeyProvider,
  type SecretsStoreBinding,
} from "@/lib/trader/security/secrets-store-master-key-provider";

// Re-export credential payload AAD prefix for DEE-196 (distinct from DEK wrap AAD).
export function credentialPayloadAad(keyVersion: string): string {
  return `waia:trader:cred:${keyVersion}`;
}
