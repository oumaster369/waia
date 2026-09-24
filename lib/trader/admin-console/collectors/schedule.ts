/** UTC minute schedule from the C5 collector contract. Valuation is not due until a writer exists. */
export function dueCollectorKeys(now: Date): readonly string[] {
  const minute = now.getUTCMinutes();
  const keys = ["admin_market_quotes", "admin_usd_quotes"];
  if (minute % 10 === 0) keys.push("admin_news");
  if (minute === 5) keys.push("admin_fear_greed");
  if (minute === 35) keys.push("admin_retention");
  return keys;
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
