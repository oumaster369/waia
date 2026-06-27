import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { MasterKeyNotReadyError } from "@/lib/trader/security/errors";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";

/** Fail-closed gate before any real credential write (DEE-196 / DEE-221). */
export function assertCredentialStorageAllowed(provider: MasterKeyProvider): void {
  assertCredentialCryptoAllowed(provider);
}

/** Fail-closed gate before decrypting stored credentials (DEE-221). */
export function assertCredentialDecryptionAllowed(provider: MasterKeyProvider): void {
  assertCredentialCryptoAllowed(provider);
}

function assertCredentialCryptoAllowed(provider: MasterKeyProvider): void {
  if (!provider.isProductionReady()) {
    throw new MasterKeyNotReadyError();
  }
}
