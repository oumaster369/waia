export type AlertSourceStream = "waia_trader_event" | "waia_payment_watcher" | "waia_runtime_route";

export type AlertType =
  | "duplicate_order_risk"
  | "reconciliation_mismatch"
  | "data_quality_breach"
  | "paper_loop_critical"
  | "drawdown_stop_account"
  | "payment_watcher_failure"
  | "payment_watcher_offline";

export type AlertDeliveryOutcome =
  | "success"
  | "failed"
  | "config_error"
  | "suppressed"
  | "router_error"
  | "dry_run";

export type AlertingConfig = {
  enabled: boolean;
  alertsBotToken?: string;
  chatId?: string;
  threadId?: string;
};

export type AlertEnvelope = {
  alertType: AlertType;
  sourceStream: AlertSourceStream;
  organizationId: string | null;
  sourceKind: string;
  outcome: string;
  fingerprint: string;
  observedAt: string;
  extensions: Record<string, string | number | boolean | null>;
};

export type TelegramSendResult = {
  ok: boolean;
  httpStatus: number;
  retryable: boolean;
  errorCode?: string;
};

export type TelegramAlertSinkDeps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};
