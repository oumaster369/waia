import { CANONICAL_NETWORK } from "@/lib/waia-core/payment-watcher/watcher-config";

const ALIASES: Record<string, typeof CANONICAL_NETWORK> = {
  "trc-20": CANONICAL_NETWORK,
  trc20: CANONICAL_NETWORK,
  "tron-trc20": CANONICAL_NETWORK,
  tron_trc20: CANONICAL_NETWORK,
};

/** Normalize observed network aliases to the canonical registry ID (ADR-0015). */
export function normalizeSettlementNetwork(raw: string): typeof CANONICAL_NETWORK | null {
  const trimmed = raw.trim();
  if (trimmed === CANONICAL_NETWORK) {
    return CANONICAL_NETWORK;
  }
  const alias = ALIASES[trimmed.toLowerCase()];
  return alias ?? null;
}
