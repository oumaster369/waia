/** UTC minute schedule from the C5 collector contract. */
export function adminCollectorScheduledAt(event: unknown): Date | undefined {
  if (!event || typeof event !== "object" || !("scheduledTime" in event)) return undefined;
  const value = event.scheduledTime;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? at : undefined;
}

export function dueCollectorKeys(now: Date): readonly string[] {
  const minute = now.getUTCMinutes();
  const keys = ["admin_market_quotes", "admin_usd_quotes", "admin_account_valuation"];
  if (minute % 10 === 0) keys.push("admin_news");
  if (minute === 5) keys.push("admin_fear_greed");
  if (minute === 35) keys.push("admin_retention");
  return keys;
}

/** Journal cleanup stays due even when market collectors are switched off. */
export function tasksWhenCollectorsDisabled(due: readonly string[]): readonly string[] {
  return due.includes("admin_retention") ? ["admin_retention"] : [];
}

export function retentionCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export const RETENTION_DAYS = {
  quoteMinute: 30,
  news: 90,
  changeLog: 7,
  valuation: 7,
  equityPoint: 400,
  diagnostic: 30,
  jobRun: 30,
} as const;
