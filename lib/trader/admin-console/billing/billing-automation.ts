export const BILLING_AUTOMATION_CAPTION =
  "Автоматически: расчёт и черновик. Выпуск: подтверждение администратора";

export type BillingAutomationFacts = {
  lastClosedAt: string | null;
  lastDraftAt: string | null;
  lastIssuedAt: string | null;
  lastAppliedAt: string | null;
  settlementRuns: number;
  lastSuspensionAt: string | null;
};

export function billingAutomation(facts: BillingAutomationFacts): {
  caption: string;
  stages: { id: number; note: string; at: string | null }[];
} {
  return {
    caption: BILLING_AUTOMATION_CAPTION,
    stages: [
      { id: 1, note: "Вручную: команда закрытия периода", at: facts.lastClosedAt },
      { id: 2, note: "Автоматически после закрытия", at: facts.lastDraftAt },
      { id: 3, note: "Автоматически после закрытия", at: facts.lastDraftAt },
      { id: 4, note: "Автоматически после закрытия", at: facts.lastDraftAt },
      { id: 5, note: "Выпуск: подтверждение администратора (ADR-0008)", at: facts.lastIssuedAt },
      { id: 6, note: "Выпуск: подтверждение администратора (ADR-0008)", at: facts.lastIssuedAt },
      { id: 7, note: "Уведомления: не реализовано", at: null },
      {
        id: 8,
        note: `Последний зачтённый платёж; запусков settlement: ${facts.settlementRuns}`,
        at: facts.lastAppliedAt,
      },
      {
        id: 9,
        note: "Проверка просрочки не запланирована в Worker",
        at: facts.lastSuspensionAt,
      },
    ],
  };
}
