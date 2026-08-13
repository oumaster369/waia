import { parseChainBlockHeight } from "@/lib/waia-core/treasury/inception-rules";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";

export { parseChainBlockHeight };

export function blockHeightToString(value: bigint): string {
  if (value < 0n) {
    throw new TreasuryValidationError("INVALID_BLOCK_HEIGHT", "block height must be >= 0");
  }
  return value.toString(10);
}

export function maxBlockHeight(a: bigint, b: bigint): bigint {
  return a >= b ? a : b;
}

export function minBlockHeight(a: bigint, b: bigint): bigint {
  return a <= b ? a : b;
}

export function compareBlockHeight(a: string, b: string): number {
  const left = parseChainBlockHeight(a, "block_a");
  const right = parseChainBlockHeight(b, "block_b");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function isBlockAtOrBefore(candidate: string, boundary: string): boolean {
  return compareBlockHeight(candidate, boundary) <= 0;
}

/** Inclusive confirmation depth: tip - transfer + 1. Zero when transfer is not yet on the captured tip. */
export function computeConfirmationDepth(tipBlock: string, transferBlock: string): number {
  const tip = parseChainBlockHeight(tipBlock, "tip");
  const transfer = parseChainBlockHeight(transferBlock, "transfer");
  if (transfer <= 0n || tip < transfer) {
    return 0;
  }
  const depth = tip - transfer + 1n;
  if (depth > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TreasuryValidationError(
      "CONFIRMATION_DEPTH_OVERFLOW",
      "confirmation depth exceeds safe integer storage for the int column",
    );
  }
  return Number(depth);
}

export type TreasuryScanRange = {
  fromBlock: string;
  toBlock: string;
  catchingUp: boolean;
};

/**
 * Inclusive next-block scanning. Cursor is last_scanned_block; next eligible is cursor+1,
 * clamped to watcher_start_block, never at/below inception_block.
 */
export function computeTreasuryScanRange(input: {
  lastScannedBlock: string;
  tipBlock: string;
  watcherStartBlock: string;
  inceptionBlock: string;
  rescanWindow: number;
  maxBlocksPerCycle: number;
}): TreasuryScanRange {
  const cursor = parseChainBlockHeight(input.lastScannedBlock, "last_scanned_block");
  const tip = parseChainBlockHeight(input.tipBlock, "tip");
  const start = parseChainBlockHeight(input.watcherStartBlock, "watcher_start_block");
  const inception = parseChainBlockHeight(input.inceptionBlock, "inception_block");
  const window = BigInt(Math.max(1, input.rescanWindow));
  const maxPerCycle = BigInt(Math.max(1, input.maxBlocksPerCycle));

  const nextExclusiveFloor = start;
  const rescanFrom = cursor - window + 1n;
  let from = maxBlockHeight(nextExclusiveFloor, rescanFrom);
  if (from <= inception) {
    from = inception + 1n;
  }
  from = maxBlockHeight(from, start);
  if (from > tip) {
    return {
      fromBlock: blockHeightToString(from),
      toBlock: blockHeightToString(from - 1n < 0n ? 0n : from - 1n),
      catchingUp: false,
    };
  }
  const to = minBlockHeight(tip, from + maxPerCycle - 1n);
  return {
    fromBlock: blockHeightToString(from),
    toBlock: blockHeightToString(to),
    catchingUp: to < tip,
  };
}

export function seedLastScannedBlock(watcherStartBlock: string): string {
  const start = parseChainBlockHeight(watcherStartBlock, "watcher_start_block");
  if (start === 0n) {
    throw new TreasuryValidationError(
      "INVALID_WATCHER_START",
      "watcher_start_block must be > 0 so last_scanned_block can be start-1",
    );
  }
  return blockHeightToString(start - 1n);
}

export function eachBlockInclusive(fromBlock: string, toBlock: string): string[] {
  const from = parseChainBlockHeight(fromBlock, "from");
  const to = parseChainBlockHeight(toBlock, "to");
  if (to < from) {
    return [];
  }
  const blocks: string[] = [];
  for (let current = from; current <= to; current += 1n) {
    blocks.push(blockHeightToString(current));
  }
  return blocks;
}
