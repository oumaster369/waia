export type JobCatalogEntry = {
  jobKey: string;
  owner: string;
  cron: string | null;
  capability: string | null;
};

export const ADMIN_JOB_CATALOG: readonly JobCatalogEntry[] = [
  { jobKey: "payment_watcher", owner: "worker", cron: "* * * * *", capability: null },
  { jobKey: "treasury_watcher", owner: "worker", cron: "* * * * *", capability: null },
  { jobKey: "settlement", owner: "worker", cron: "* * * * *", capability: null },
  { jobKey: "market_brain", owner: "worker", cron: "* * * * *", capability: null },
  { jobKey: "paper_loop", owner: "worker", cron: "* * * * *", capability: null },
  { jobKey: "admin_market_quotes", owner: "worker", cron: "* * * * *", capability: null },
  { jobKey: "admin_usd_quotes", owner: "worker", cron: "* * * * *", capability: null },
  { jobKey: "admin_account_valuation", owner: "worker", cron: "* * * * *", capability: null },
  { jobKey: "admin_news", owner: "worker", cron: "*/10 * * * *", capability: null },
  { jobKey: "admin_fear_greed", owner: "worker", cron: "5 * * * *", capability: null },
  { jobKey: "admin_retention", owner: "worker", cron: "35 * * * *", capability: null },
  {
    jobKey: "account_observation",
    owner: "execution-host",
    cron: null,
    capability: "выполняется на execution host",
  },
  {
    jobKey: "invoice_issue",
    owner: "human",
    cron: null,
    capability: "ручной выпуск, не расписание",
  },
];

export function missedJobRuns(
  runs: readonly { jobKey: string; startedAtMs: number }[],
  nowMs: number,
  periodMs: number,
): string[] {
  const latest = new Map<string, number>();
  for (const run of runs) {
    const known = latest.get(run.jobKey);
    if (known === undefined || run.startedAtMs > known) latest.set(run.jobKey, run.startedAtMs);
  }
  return [...latest.entries()]
    .filter(([, started]) => nowMs - started > periodMs * 2)
    .map(([jobKey]) => jobKey);
}
