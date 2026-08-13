import type { TreasuryTxDirection } from "@/lib/waia-core/treasury/types";
import type {
  ObservationRole,
  TreasuryWatchedAddressRecord,
} from "@/lib/waia-core/treasury/watcher/types";

export type MatchedWatchedAddress = {
  address: TreasuryWatchedAddressRecord;
  direction: Extract<TreasuryTxDirection, "INFLOW" | "OUTFLOW">;
};

export function matchWatchedAddresses(input: {
  fromAddress: string;
  toAddress: string;
  addresses: readonly TreasuryWatchedAddressRecord[];
}): MatchedWatchedAddress[] {
  const matches: MatchedWatchedAddress[] = [];
  for (const address of input.addresses) {
    if (!address.isActive) continue;
    const isRecipient = address.address === input.toAddress;
    const isSender = address.address === input.fromAddress;
    if (
      isRecipient &&
      (address.directionScope === "INBOUND" || address.directionScope === "BOTH")
    ) {
      matches.push({ address, direction: "INFLOW" });
      continue;
    }
    if (isSender && (address.directionScope === "OUTBOUND" || address.directionScope === "BOTH")) {
      matches.push({ address, direction: "OUTFLOW" });
    }
  }
  return matches;
}

/** Frozen: OUTFLOW (sender) is PRIMARY; INFLOW (recipient) is INTERNAL_COUNTERPARTY. */
export function assignObservationRoles(
  matches: readonly MatchedWatchedAddress[],
): Array<MatchedWatchedAddress & { observationRole: ObservationRole }> {
  const hasOutflow = matches.some((row) => row.direction === "OUTFLOW");
  const hasInflow = matches.some((row) => row.direction === "INFLOW");
  const internalPair = hasOutflow && hasInflow && matches.length >= 2;
  return matches.map((row) => {
    if (!internalPair) {
      return { ...row, observationRole: "PRIMARY" as const };
    }
    if (row.direction === "OUTFLOW") {
      return { ...row, observationRole: "PRIMARY" as const };
    }
    return { ...row, observationRole: "INTERNAL_COUNTERPARTY" as const };
  });
}
