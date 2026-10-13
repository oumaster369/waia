/** Shared names for canonical job evidence; safe in both server facts and client UI. */
export const JOB_LABELS: Record<string, string> = {
  payment_watcher: "Payment observation",
  treasury_watcher: "Treasury observation",
  settlement: "Payment application",
  market_brain: "Market mode",
  paper_loop: "Virtual Paper portfolio",
  admin_market_quotes: "HTX quotes",
  admin_usd_quotes: "USD quotes",
  admin_account_valuation: "Account valuation",
  admin_news: "News",
  admin_fear_greed: "Fear & Greed",
  admin_retention: "Projection storage",
  account_observation: "Exchange account observation",
  invoice_issue: "Manual invoice issuance",
};
export const JOB_STATUS: Record<string, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Error",
  skipped: "Skipped",
};
