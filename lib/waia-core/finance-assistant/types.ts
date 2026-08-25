export const FINANCE_ASSISTANT_INTENTS = [
  "REPORT_OVERVIEW",
  "REPORT_BUDGET",
  "REPORT_TRANSACTIONS",
  "CREATE_COUNTERPARTY",
  "CREATE_ACCOUNT",
  "CREATE_CATEGORY",
  "CREATE_PROJECT",
  "CREATE_TRANSACTION",
  "UNSUPPORTED",
] as const;

export type FinanceAssistantIntentName = (typeof FINANCE_ASSISTANT_INTENTS)[number];

export type FinanceAssistantPlan = {
  intent: FinanceAssistantIntentName;
  summary: string;
  fields: Record<string, string | null>;
  providerRequestId: string | null;
  model: string;
};

export type FinanceAssistantWriteIntent = Exclude<
  FinanceAssistantIntentName,
  "REPORT_OVERVIEW" | "REPORT_BUDGET" | "REPORT_TRANSACTIONS" | "UNSUPPORTED"
>;

export type FinanceAssistantConfirmationPayload = {
  version: 1;
  subjectUserId: string;
  organizationId: string;
  intent: FinanceAssistantWriteIntent;
  fields: Record<string, string | null>;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export const FINANCE_ASSISTANT_MAX_MESSAGE_CHARS = 4_000;
export const FINANCE_ASSISTANT_CONFIRMATION_TTL_SECONDS = 10 * 60;

export type FinanceAssistantReport = {
  kind: "overview" | "budget" | "transactions";
  title: string;
  generatedAt: string;
  data: Record<string, unknown>;
};

export class FinanceAssistantError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FinanceAssistantError";
  }
}
