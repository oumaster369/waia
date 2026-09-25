/** Shared names for canonical job evidence; safe in both server facts and client UI. */
export const JOB_LABELS: Record<string, string> = {
  payment_watcher: "Наблюдение платежей",
  treasury_watcher: "Наблюдение казначейства",
  settlement: "Зачёт платежей",
  market_brain: "Рыночный контур",
  paper_loop: "Виртуальный портфель Paper",
  admin_market_quotes: "Котировки HTX",
  admin_usd_quotes: "Котировки USD",
  admin_account_valuation: "Оценка счетов",
  admin_news: "Новости",
  admin_fear_greed: "Fear & Greed",
  admin_retention: "Хранение проекций",
  account_observation: "Наблюдение биржевых счетов",
  invoice_issue: "Ручной выпуск счетов",
};
export const JOB_STATUS: Record<string, string> = {
  running: "Выполняется",
  succeeded: "Успешно",
  failed: "Ошибка",
  skipped: "Пропущено",
};
