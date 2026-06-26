import { CANONICAL_NETWORK } from "@/lib/waia-core/payment-watcher/watcher-config";

/** Detect idempotency key: TRC-20:{txHash}:{transferIndex}. */
export function paymentIdempotencyKey(txHash: string, transferIndex: number): string {
  return `${CANONICAL_NETWORK}:${txHash}:${transferIndex}`;
}

/** Parse tx hash from a detect idempotency key; returns null when malformed. */
export function parseTxHashFromIdempotencyKey(idempotencyKey: string): string | null {
  const parts = idempotencyKey.split(":");
  if (parts.length !== 3 || parts[0] !== CANONICAL_NETWORK) {
    return null;
  }
  return parts[1] ?? null;
}
