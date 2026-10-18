import { requireHtxStoredPermissionMetadata } from "@/lib/trader/security/htx-secure-credential-resolver";

/**
 * Manual HTX synchronization is read-only application behavior. Admit only a
 * complete, account-bound stored policy before asking the credential service to
 * decrypt. Venue validation remains a separate, fresh check after decryption.
 */
export function hasValidHtxManualSyncReadPolicy(input: {
  venue: string;
  exchangeAccountId: string;
  permissionMetadata: Record<string, unknown> | null;
}): boolean {
  try {
    requireHtxStoredPermissionMetadata({ ...input, purpose: "read" });
    return true;
  } catch {
    return false;
  }
}
