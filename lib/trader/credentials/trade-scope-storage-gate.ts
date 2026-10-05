import { CredentialPayloadInvalidError } from "@/lib/trader/credentials/errors";
import { parseHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";

/** True when permission metadata names the HTX `trade` scope. Other shapes stay closed. */
export function permissionMetadataIncludesTradeScopeV1(
  permissionMetadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!permissionMetadata) return false;
  const scopes = permissionMetadata.scopes;
  return Array.isArray(scopes) && scopes.some((scope) => scope === "trade");
}

/**
 * Legacy execution credentials require the live switch. A versioned observation
 * credential retains actual venue scopes but cannot authorize execution. Validate
 * its full policy and exact account before encryption; a claimed purpose alone
 * is never sufficient. Neither path enables live trading.
 */
export function assertTradeScopeStoredOnlyWhenLiveEnabledV1(input: {
  permissionMetadata: Record<string, unknown> | null | undefined;
  orgLiveEnabled: boolean;
  venue?: string;
  exchangeAccountId?: string;
}): void {
  if (input.permissionMetadata?.version === 2 || input.permissionMetadata?.purpose !== undefined) {
    const metadata = parseHtxPermissionMetadata(input.permissionMetadata);
    if (!metadata || metadata.version !== 2 || metadata.purpose !== "observation" ||
        input.venue !== "htx" || metadata.exchangeAccountId !== input.exchangeAccountId) {
      throw new CredentialPayloadInvalidError("Observation credential policy is invalid.");
    }
    return;
  }
  if (
    permissionMetadataIncludesTradeScopeV1(input.permissionMetadata) &&
    input.orgLiveEnabled !== true
  ) {
    throw new CredentialPayloadInvalidError(
      "Trade-scoped credentials require an enabled org live switch.",
    );
  }
}
