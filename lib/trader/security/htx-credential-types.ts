import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";
import { HtxConnectorValidationError } from "@/lib/trader/connectors/htx/errors";

/** HTX spot credential policy version stored in permissionMetadata. */
export const HTX_CREDENTIAL_METADATA_VERSION = 1 as const;

export type HtxPermissionMetadata = {
  version: typeof HTX_CREDENTIAL_METADATA_VERSION;
  marketType: "spot";
  exchangeAccountId: string;
  scopes: string[];
  warnings: string[];
  accountLabel?: string;
  withdrawForbidden: true;
  transferForbidden: true;
};

export type HtxStoredCredentialRecord = {
  venue: "htx";
  exchangeAccountId: string;
  credentials: ConnectorCredentialInput;
  permissionMetadata: HtxPermissionMetadata | null;
};

export type HtxSecureConnectorConfig = {
  apiKey: string;
  apiSecret: string;
  spotAccountId: string;
  permissionMetadata: HtxPermissionMetadata;
};

export function validateHtxConnectorCredentialInput(input: ConnectorCredentialInput): void {
  const apiKey = input.apiKey.trim();
  const apiSecret = input.apiSecret.trim();
  if (!apiKey || !apiSecret) {
    throw new HtxConnectorValidationError(
      "INVALID_CREDENTIALS",
      "HTX credentials require non-empty apiKey and apiSecret",
    );
  }
}

export function buildHtxPermissionMetadata(input: {
  exchangeAccountId: string;
  scopes?: readonly string[];
  warnings?: readonly string[];
  accountLabel?: string;
}): HtxPermissionMetadata {
  const metadata: HtxPermissionMetadata = {
    version: HTX_CREDENTIAL_METADATA_VERSION,
    marketType: "spot",
    exchangeAccountId: input.exchangeAccountId,
    scopes: [...(input.scopes ?? [])],
    warnings: [...(input.warnings ?? [])],
    withdrawForbidden: true,
    transferForbidden: true,
  };

  if (input.accountLabel) {
    metadata.accountLabel = input.accountLabel;
  }

  assertHtxPermissionMetadataSafe(metadata);
  return metadata;
}

export function parseHtxPermissionMetadata(
  raw: Record<string, unknown> | null,
): HtxPermissionMetadata | null {
  if (!raw) {
    return null;
  }

  if (raw.marketType !== "spot" || typeof raw.exchangeAccountId !== "string") {
    return null;
  }

  const scopes = Array.isArray(raw.scopes)
    ? raw.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  try {
    return buildHtxPermissionMetadata({
      exchangeAccountId: raw.exchangeAccountId,
      scopes,
      warnings,
      accountLabel: typeof raw.accountLabel === "string" ? raw.accountLabel : undefined,
    });
  } catch {
    return null;
  }
}

/** Enforce HTX spot security posture on stored permission metadata. */
export function assertHtxPermissionMetadataSafe(metadata: HtxPermissionMetadata): void {
  if (metadata.marketType !== "spot") {
    throw new HtxConnectorValidationError(
      "MARKET_TYPE_NOT_ALLOWED",
      "HTX stored credentials must be spot-only",
    );
  }

  if (metadata.scopes.includes("withdraw")) {
    throw new HtxConnectorValidationError(
      "FORBIDDEN_PERMISSION",
      "HTX credential metadata must not include withdraw scope",
    );
  }

  if (!metadata.withdrawForbidden || !metadata.transferForbidden) {
    throw new HtxConnectorValidationError(
      "POLICY_VIOLATION",
      "HTX credential metadata must declare withdraw and transfer forbidden",
    );
  }
}
