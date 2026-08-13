export function treasuryObservationIdempotencyKey(input: {
  network: string;
  txHash: string;
  transferIndex: number;
  watchedAddressId: string;
}): string {
  return `${input.network}:${input.txHash}:${input.transferIndex}:${input.watchedAddressId}`;
}

export function treasurySemanticTransferKey(input: {
  organizationId: string;
  network: string;
  tokenContract: string;
  txHash: string;
  transferIndex: number;
}): string {
  return `${input.organizationId}:${input.network}:${input.tokenContract}:${input.txHash}:${input.transferIndex}`;
}
