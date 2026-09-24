export const ORDER_STATUS_LABELS = {
  CREATED: "Создан",
  RISK_APPROVED: "Риск одобрил",
  SENT_TO_EXCHANGE: "Отправлен на биржу",
  ACCEPTED: "Биржа приняла",
  PARTIALLY_FILLED: "Частично исполнен",
  FILLED: "Исполнено",
  CANCEL_REQUESTED: "Отмена запрошена",
  CANCELLED: "Отменён",
  REJECTED: "Отклонён",
  EXPIRED: "Истёк",
  FAILED: "Ошибка",
  RECONCILIATION_REQUIRED: "Требует сверки",
} as const;

export const WORKING_ORDER_STATES = [
  "CREATED",
  "RISK_APPROVED",
  "SENT_TO_EXCHANGE",
  "ACCEPTED",
  "PARTIALLY_FILLED",
  "CANCEL_REQUESTED",
  "RECONCILIATION_REQUIRED",
] as const;

export type OrderTraceStep = {
  step: string;
  state: "ok" | "not_applicable" | "unavailable";
  reason: string | null;
  recordId: string | null;
  at: string | null;
};

export type OrderTraceInput = {
  orderId: string;
  executionAttemptId: string | null;
  attempt: { id: string; executionPlanId: string; at: string } | null;
  plan: {
    id: string;
    riskAllowanceId: string | null;
    riskVerdictId: string | null;
    decisionId: string | null;
    forecastId: string | null;
    at: string;
  } | null;
  allowance: { id: string; at: string } | null;
  verdict: { id: string; at: string } | null;
  decision: { id: string; at: string } | null;
  forecast: { id: string; at: string } | null;
  reports: { id: string; at: string }[];
  events: { id: string; at: string }[];
  fills: { id: string; at: string }[];
};

function step(
  name: string,
  record: { id: string; at: string } | null,
  missingReason: string,
): OrderTraceStep {
  if (!record) {
    return { step: name, state: "unavailable", reason: missingReason, recordId: null, at: null };
  }
  return { step: name, state: "ok", reason: null, recordId: record.id, at: record.at };
}

export function buildOrderTrace(input: OrderTraceInput): {
  steps: OrderTraceStep[];
  fillCount: number;
  allowedActions: [];
} {
  if (!input.executionAttemptId) {
    return {
      steps: [
        {
          step: "execution_attempt",
          state: "not_applicable",
          reason: "LEGACY_ORDER_NO_V2_BINDING",
          recordId: null,
          at: null,
        },
      ],
      fillCount: input.fills.length,
      allowedActions: [],
    };
  }
  return {
    steps: [
      step("execution_attempt", input.attempt, "ATTEMPT_MISSING"),
      step("execution_plan", input.plan, "PLAN_MISSING"),
      step("risk_allowance", input.allowance, "ALLOWANCE_MISSING"),
      step("risk_verdict", input.verdict, "VERDICT_MISSING"),
      step("decision", input.decision, "DECISION_MISSING"),
      step("forecast", input.forecast, "FORECAST_MISSING"),
      {
        step: "exchange_reports",
        state: input.reports.length > 0 ? "ok" : "unavailable",
        reason: input.reports.length > 0 ? null : "REPORT_MISSING",
        recordId: input.reports[0]?.id ?? null,
        at: input.reports[0]?.at ?? null,
      },
      {
        step: "order_events",
        state: input.events.length > 0 ? "ok" : "unavailable",
        reason: null,
        recordId: input.events[0]?.id ?? null,
        at: input.events[0]?.at ?? null,
      },
      {
        step: "fills",
        state: "ok",
        reason: null,
        recordId: null,
        at: input.fills[0]?.at ?? null,
      },
    ],
    fillCount: input.fills.length,
    allowedActions: [],
  };
}
