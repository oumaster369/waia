import { computeTreasuryContentDigest } from "@/lib/waia-core/treasury/digest";

/** Immutable source-fact digest. Confirmation depth and DB ids are excluded. */
export function computeTreasuryRawEventDigest(input: {
  network: string;
  tokenContract: string;
  txHash: string;
  transferIndex: number;
  fromAddress: string;
  toAddress: string;
  nativeAmountAtomic: bigint;
  nativeDecimals: number;
  blockHeight: string;
  blockTimestamp: string | null;
}): string {
  return computeTreasuryContentDigest({
    schema: "treasury_chain_observation.raw_event.v1",
    network: input.network,
    tokenContract: input.tokenContract,
    txHash: input.txHash,
    transferIndex: input.transferIndex,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    nativeAmountAtomic: input.nativeAmountAtomic.toString(10),
    nativeDecimals: input.nativeDecimals,
    blockHeight: input.blockHeight,
    blockTimestamp: input.blockTimestamp,
  });
}
