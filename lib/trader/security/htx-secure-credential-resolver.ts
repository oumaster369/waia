import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";
import type { HtxExchangeConnectorConfig } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import {
  assertHtxPermissionMetadataSafe,
  parseHtxPermissionMetadata,
  validateHtxConnectorCredentialInput,
  type HtxPermissionMetadata,
  type HtxSecureConnectorConfig,
} from "@/lib/trader/security/htx-credential-types";
import { HtxConnectorValidationError } from "@/lib/trader/connectors/htx/errors";

export type ResolveHtxSecureCredentialInput = {
  venue: string;
  exchangeAccountId: string;
  credentials: ConnectorCredentialInput;
  permissionMetadata: Record<string, unknown> | null;
};

/**
 * Service-role boundary for later isolated-host / live connector injection (DEE-221).
 * Does not enable live execution — callers must remain outside execution-service live mode.
 */
export function resolveHtxSecureCredential(
  input: ResolveHtxSecureCredentialInput,
): HtxSecureConnectorConfig {
  if (input.venue !== "htx") {
    throw new HtxConnectorValidationError(
      "UNSUPPORTED_VENUE",
      `HTX secure credential resolver only supports htx; got ${input.venue}`,
    );
  }

  validateHtxConnectorCredentialInput(input.credentials);

  const metadata =
    parseHtxPermissionMetadata(input.permissionMetadata) ??
    ({
      version: 1,
      marketType: "spot",
      exchangeAccountId: input.exchangeAccountId,
      scopes: [],
      warnings: [],
      withdrawForbidden: true,
      transferForbidden: true,
    } satisfies HtxPermissionMetadata);

  if (metadata.exchangeAccountId !== input.exchangeAccountId) {
    throw new HtxConnectorValidationError(
      "ACCOUNT_ID_MISMATCH",
      "HTX credential metadata account id does not match stored exchange account id",
    );
  }

  assertHtxPermissionMetadataSafe(metadata);

  return {
    apiKey: input.credentials.apiKey.trim(),
    apiSecret: input.credentials.apiSecret.trim(),
    spotAccountId: input.exchangeAccountId,
    permissionMetadata: metadata,
  };
}

export function toHtxExchangeConnectorConfig(
  resolved: HtxSecureConnectorConfig,
): HtxExchangeConnectorConfig {
  return {
    apiKey: resolved.apiKey,
    apiSecret: resolved.apiSecret,
  };
}
