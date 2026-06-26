export type ScanRangeInput = {
  cursorBlock: string;
  tipBlock: string;
  startBlock: string;
  rescanWindow: number;
  maxBlocksPerCycle: number;
};

export type ScanRange = {
  fromBlock: string;
  toBlock: string;
  catchingUp: boolean;
};

function blockToNumber(block: string): number {
  const parsed = Number.parseInt(block, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function numberToBlock(value: number): string {
  return String(Math.max(0, value));
}

/** Cursor-anchored, catch-up-paged scan range (§4.2). */
export function computeScanRange(input: ScanRangeInput): ScanRange {
  const cursor = blockToNumber(input.cursorBlock);
  const tip = blockToNumber(input.tipBlock);
  const start = blockToNumber(input.startBlock);
  const window = Math.max(1, input.rescanWindow);
  const maxPerCycle = Math.max(1, input.maxBlocksPerCycle);

  const from = Math.max(start, cursor - window + 1);
  const to = Math.min(tip, from + maxPerCycle - 1);

  return {
    fromBlock: numberToBlock(from),
    toBlock: numberToBlock(to),
    catchingUp: to < tip,
  };
}

export function computeConfirmationDepth(tipBlock: string, transferBlock: string): number {
  const tip = blockToNumber(tipBlock);
  const transfer = blockToNumber(transferBlock);
  if (transfer <= 0 || tip < transfer) {
    return 0;
  }
  return tip - transfer + 1;
}

export function shouldDetect(depth: number): boolean {
  return depth >= 1;
}

export function shouldConfirm(depth: number, confirmationsRequired: number): boolean {
  return depth >= confirmationsRequired;
}

export function isReorgAgeoutEligible(createdAt: Date, now: Date, ageoutMinutes: number): boolean {
  const ageMs = now.getTime() - createdAt.getTime();
  return ageMs >= ageoutMinutes * 60 * 1000;
}
