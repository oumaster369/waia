export const BILLING_AUTOMATION_CAPTION =
  "Automatic: calculation and draft. Issuance: administrator confirmation";

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
      { id: 1, note: "Manual: period-closing command", at: facts.lastClosedAt },
      { id: 2, note: "Automatic after period close", at: facts.lastDraftAt },
      { id: 3, note: "Automatic after period close", at: facts.lastDraftAt },
      { id: 4, note: "Automatic after period close", at: facts.lastDraftAt },
      { id: 5, note: "Issuance: administrator confirmation (ADR-0008)", at: facts.lastIssuedAt },
      { id: 6, note: "Issuance: administrator confirmation (ADR-0008)", at: facts.lastIssuedAt },
      { id: 7, note: "Notifications: not implemented", at: null },
      {
        id: 8,
        note: `Latest applied payment; settlement runs: ${facts.settlementRuns}`,
        at: facts.lastAppliedAt,
      },
      {
        id: 9,
        note: "Overdue checks are not scheduled in the Worker",
        at: facts.lastSuspensionAt,
      },
    ],
  };
}
