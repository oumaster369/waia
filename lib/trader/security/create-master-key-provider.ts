import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  isDevMasterKeyModeEnabled,
  isProductionDeployment,
} from "@/lib/trader/security/deployment-tier";
import { DevMasterKeyProvider } from "@/lib/trader/security/dev-master-key-provider";
import { MasterKeyConfigError } from "@/lib/trader/security/errors";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import {
  type SecretsStoreBinding,
  SecretsStoreMasterKeyProvider,
} from "@/lib/trader/security/secrets-store-master-key-provider";

export type CreateMasterKeyProviderOptions = {
  env?: Record<string, unknown>;
  injectSecretGetter?: () => Promise<string>;
  /** Test override for production-ready signal on Secrets Store provider. */
  productionReady?: boolean;
};

function readBindingFromEnv(
  env: Record<string, unknown> | undefined,
): SecretsStoreBinding | undefined {
  const candidate = env?.AI_TRADER_MASTER_KEY;
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as SecretsStoreBinding).get === "function"
  ) {
    return candidate as SecretsStoreBinding;
  }
  return undefined;
}

async function resolveCloudflareEnv(
  explicitEnv?: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  if (explicitEnv) {
    return explicitEnv;
  }
  try {
    return getCloudflareContext().env as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function resolveSecretGetter(
  options?: CreateMasterKeyProviderOptions,
): Promise<(() => Promise<string>) | undefined> {
  if (options?.injectSecretGetter) {
    return options.injectSecretGetter;
  }

  const env = await resolveCloudflareEnv(options?.env);
  const binding = readBindingFromEnv(env);
  if (!binding) {
    return undefined;
  }

  return () => binding.get();
}

/** Async factory — must be awaited before any crypto operation (DEE-220 §6). */
export async function createMasterKeyProvider(
  options?: CreateMasterKeyProviderOptions,
): Promise<MasterKeyProvider> {
  if (isProductionDeployment() && isDevMasterKeyModeEnabled()) {
    throw new MasterKeyConfigError(
      "AI_TRADER_MASTER_KEY_MODE=dev is forbidden on production deployments.",
    );
  }

  const secretGetter = await resolveSecretGetter(options);
  if (secretGetter) {
    return SecretsStoreMasterKeyProvider.create({
      secretGetter,
      productionReady: options?.productionReady,
    });
  }

  if (isProductionDeployment()) {
    return SecretsStoreMasterKeyProvider.createNotConfigured();
  }

  return DevMasterKeyProvider.create();
}
