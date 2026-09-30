import { CredentialPayloadInvalidError } from "@/lib/trader/credentials/errors";

/** True when permission metadata names the HTX `trade` scope. Other shapes stay closed. */
export function permissionMetadataIncludesTradeScopeV1(
  permissionMetadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!permissionMetadata) return false;
  const scopes = permissionMetadata.scopes;
  return Array.isArray(scopes) && scopes.some((scope) => scope === "trade");
}

/**
 * A trade-scoped key may be stored only when the caller reports the org live
 * switch as enabled. Omitted and false both refuse. This function does not
 * enable live trading.
 */
export function assertTradeScopeStoredOnlyWhenLiveEnabledV1(input: {
  permissionMetadata: Record<string, unknown> | null | undefined;
  orgLiveEnabled: boolean;
}): void {
  if (
    permissionMetadataIncludesTradeScopeV1(input.permissionMetadata) &&
    input.orgLiveEnabled !== true
  ) {
    throw new CredentialPayloadInvalidError(
      "Trade-scoped credentials require an enabled org live switch.",
    );
  }
}
