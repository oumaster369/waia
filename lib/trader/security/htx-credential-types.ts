import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";
import { HtxConnectorValidationError } from "@/lib/trader/connectors/htx/errors";

/** HTX spot credential policy version stored in permissionMetadata. */
export const HTX_CREDENTIAL_METADATA_VERSION = 1 as const;

export type HtxCredentialPurpose = "read" | "trade";

const OBSERVATION_POLICY_FIELDS = new Set([
  "version", "purpose", "marketType", "exchangeAccountId", "scopes", "warnings",
  "accountLabel", "withdrawForbidden", "transferForbidden",
]);

export type HtxPermissionMetadata = {
  marketType: "spot";
  exchangeAccountId: string;
  scopes: string[];
  warnings: string[];
  accountLabel?: string;
  withdrawForbidden: true;
  transferForbidden: true;
} & (
  | { version: typeof HTX_CREDENTIAL_METADATA_VERSION; purpose?: never }
  | { version: 2; purpose: "observation" }
);

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
  scopes: readonly string[];
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
  if (!raw) return null;
  try {
    const metadata = raw as HtxPermissionMetadata;
    assertHtxPermissionMetadataSafe(metadata);
    // Preserve verified fields; never reconstruct policy flags or silently
    // filter malformed scopes into a different permission statement.
    const verified = {
      version: metadata.version,
      marketType: metadata.marketType,
      exchangeAccountId: metadata.exchangeAccountId,
      scopes: [...metadata.scopes],
      warnings: [...metadata.warnings],
      withdrawForbidden: metadata.withdrawForbidden,
      transferForbidden: metadata.transferForbidden,
      ...(metadata.accountLabel === undefined ? {} : { accountLabel: metadata.accountLabel }),
    };
    return metadata.version === 2
      ? { ...verified, version: 2, purpose: "observation" }
      : { ...verified, version: 1 };
  } catch {
    return null;
  }
}

/** Stored policy is necessary, but never substitutes for fresh venue admission. */
export function assertHtxPermissionMetadataSafe(
  metadata: HtxPermissionMetadata,
  purpose: HtxCredentialPurpose = "read",
): void {
  if ((metadata.version !== HTX_CREDENTIAL_METADATA_VERSION && metadata.version !== 2) ||
      (metadata.version === 2 && metadata.purpose !== "observation") ||
      (metadata.version === 2 && Object.keys(metadata).some((key) => !OBSERVATION_POLICY_FIELDS.has(key))) ||
      (metadata.version === 1 && metadata.purpose !== undefined) ||
      typeof metadata.exchangeAccountId !== "string" ||
      !metadata.exchangeAccountId.trim() ||
      metadata.exchangeAccountId !== metadata.exchangeAccountId.trim() ||
      !Array.isArray(metadata.scopes) ||
      !Array.isArray(metadata.warnings) ||
      !metadata.warnings.every((warning) => typeof warning === "string") ||
      (metadata.accountLabel !== undefined && typeof metadata.accountLabel !== "string")) {
    throw new HtxConnectorValidationError("PERMISSION_METADATA_UNVERIFIED", "HTX stored permission metadata is invalid");
  }
  if (metadata.marketType !== "spot") {
    throw new HtxConnectorValidationError("MARKET_TYPE_NOT_ALLOWED", "HTX stored credentials must be spot-only");
  }
  if (metadata.scopes.some((scope) => scope !== "read" && scope !== "trade")) {
    throw new HtxConnectorValidationError("FORBIDDEN_PERMISSION", "HTX credential metadata contains forbidden or unknown permissions");
  }
  if (metadata.withdrawForbidden !== true || metadata.transferForbidden !== true) {
    throw new HtxConnectorValidationError("POLICY_VIOLATION", "HTX credential metadata must declare withdraw and transfer forbidden");
  }
  if (metadata.version === 2 &&
      (purpose === "trade" || new Set(metadata.scopes).size !== metadata.scopes.length)) {
    throw new HtxConnectorValidationError("POLICY_VIOLATION", "Observation credentials cannot authorize execution");
  }
  if (!metadata.scopes.includes("read") ||
      (purpose !== "read" && purpose !== "trade") ||
      (purpose === "trade" && !metadata.scopes.includes("trade"))) {
    throw new HtxConnectorValidationError("PERMISSION_METADATA_UNVERIFIED", "HTX required credential permissions are not verified");
  }
}

/**
 * Application purpose and venue capabilities are separate. Preserve the actual
 * verified scopes; version 2 never authorizes execution, even if live is enabled.
 * Older resolvers reject this version instead of discarding its purpose.
 */
export function buildHtxObservationPermissionMetadata(
  input: Parameters<typeof buildHtxPermissionMetadata>[0],
): HtxPermissionMetadata {
  const metadata: HtxPermissionMetadata = {
    ...buildHtxPermissionMetadata(input), version: 2, purpose: "observation",
  };
  assertHtxPermissionMetadataSafe(metadata, "read");
  return metadata;
}
