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
  type HtxCredentialPurpose,
  type HtxPermissionMetadata,
  type HtxSecureConnectorConfig,
} from "@/lib/trader/security/htx-credential-types";
import { HtxConnectorValidationError } from "@/lib/trader/connectors/htx/errors";

export type ResolveHtxSecureCredentialInput = {
  purpose: HtxCredentialPurpose;
  venue: string;
  exchangeAccountId: string;
  credentials: ConnectorCredentialInput;
  permissionMetadata: Record<string, unknown> | null;
};

/** Validate stored metadata before any decryption or fresh venue probe. */
export function requireHtxStoredPermissionMetadata(
  input: Omit<ResolveHtxSecureCredentialInput, "credentials">,
): HtxPermissionMetadata {
  if (input.purpose !== "read" && input.purpose !== "trade") {
    throw new HtxConnectorValidationError("PERMISSION_METADATA_UNVERIFIED", "HTX credential purpose must be explicit");
  }
  if (input.venue !== "htx") {
    throw new HtxConnectorValidationError("UNSUPPORTED_VENUE", "HTX secure credential resolver only supports htx");
  }
  if (!input.exchangeAccountId.trim()) {
    throw new HtxConnectorValidationError("ACCOUNT_ID_MISMATCH", "HTX stored credentials require a non-empty exchange account identity");
  }
  const metadata = parseHtxPermissionMetadata(input.permissionMetadata);
  if (!metadata) {
    throw new HtxConnectorValidationError("PERMISSION_METADATA_UNVERIFIED", "HTX stored permission metadata is missing or invalid");
  }
  if (metadata.exchangeAccountId !== input.exchangeAccountId) {
    throw new HtxConnectorValidationError("ACCOUNT_ID_MISMATCH", "HTX credential metadata account id does not match stored exchange account id");
  }
  assertHtxPermissionMetadataSafe(metadata, input.purpose);
  return metadata;
}

/** Resolve a declared purpose; this does not grant live execution authority. */
export function resolveHtxSecureCredential(
  input: ResolveHtxSecureCredentialInput,
): HtxSecureConnectorConfig {
  const metadata = requireHtxStoredPermissionMetadata(input);
  validateHtxConnectorCredentialInput(input.credentials);
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
    expectedSpotAccountId: resolved.spotAccountId,
  };
}
