/** Process-local full-history rescan counter for WP09 qualification (legacy oracle invocations on default path). */
let fullHistoryRescanCount = 0;

export function resetFullHistoryRescanCount(): void {
  fullHistoryRescanCount = 0;
}

export function recordFullHistoryRescan(reason: string): void {
  void reason;
  fullHistoryRescanCount += 1;
}

export function getFullHistoryRescanCount(): number {
  return fullHistoryRescanCount;
}
