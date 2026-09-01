export const FINANCE_ASSISTANT_INTENTS = [
  "REPORT_OVERVIEW",
  "REPORT_BUDGET",
  "REPORT_TRANSACTIONS",
  "REPORT_WALLET",
  "CREATE_COUNTERPARTY",
  "UPDATE_COUNTERPARTY",
  "CREATE_ACCOUNT",
  "UPDATE_ACCOUNT",
  "CREATE_CATEGORY",
  "UPDATE_CATEGORY",
  "SET_CATEGORY_BUDGET",
  "CREATE_PROJECT",
  "UPDATE_PROJECT",
  "CREATE_TRANSACTION",
  "SUBMIT_TRANSACTION_FOR_REVIEW",
  "CLASSIFY_TRANSACTION",
  "VERIFY_TRANSACTION",
  "REJECT_TRANSACTION",
  "CONFIRM_DUPLICATE_TRANSACTION",
  "REOPEN_TRANSACTION_RECONCILIATION",
  "RETURN_TRANSACTION_FROM_RECONCILIATION",
  "LINK_TRANSACTION_CORRECTION",
  "SET_TRANSACTION_DETAIL_PUBLICATION",
  "CONFIRM_BALANCE_CHECKPOINT",
  "UPDATE_FINANCE_SETTINGS",
  "CREATE_WATCHED_ADDRESS",
  "UPDATE_WATCHED_ADDRESS",
  "UNSUPPORTED",
] as const;

export type FinanceAssistantIntentName = (typeof FINANCE_ASSISTANT_INTENTS)[number];

export type FinanceAssistantPlan = {
  intent: FinanceAssistantIntentName;
  summary: string;
  language: "ru" | "en";
  question: string | null;
  fields: Record<string, string | null>;
  providerRequestId: string | null;
  model: string;
};

export type FinanceAssistantWriteIntent = Exclude<
  FinanceAssistantIntentName,
  "REPORT_OVERVIEW" | "REPORT_BUDGET" | "REPORT_TRANSACTIONS" | "REPORT_WALLET" | "UNSUPPORTED"
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
  kind: "overview" | "budget" | "transactions" | "wallet";
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
