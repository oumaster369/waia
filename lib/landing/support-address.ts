import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { isValidTronAddress, tronScanAddressUrl } from "@/lib/treasury-admin/explorer";

export type PublishedSupportAddress = {
  address: string;
  explorerUrl: string;
};

/** Fail-closed server-owned public support address binding. */
export function readPublishedSupportAddress(): PublishedSupportAddress | null {
  const address = process.env.WAIA_PUBLIC_SUPPORT_USDT_TRC20_ADDRESS?.trim() ?? "";
  if (!isValidTronAddress(address)) return null;
  const explorerUrl = tronScanAddressUrl(address);
  return explorerUrl ? { address, explorerUrl } : null;
}
