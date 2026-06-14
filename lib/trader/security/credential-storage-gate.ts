import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { MasterKeyNotReadyError } from "@/lib/trader/security/errors";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";

/** Fail-closed gate before any real credential write (DEE-196 must call this). */
export function assertCredentialStorageAllowed(provider: MasterKeyProvider): void {
  if (!provider.isProductionReady()) {
    throw new MasterKeyNotReadyError();
  }
}
