/** DEE-416 — bounded FHV operator observability constants. */

export const FHV_OPERATOR_STATUS_SCHEMA_VERSION = "fhv-operator-status/v1" as const;
export const FHV_ALERT_POLICY_SCHEMA_VERSION = "fhv-alert-policy/v1" as const;
export const FHV_OPERATOR_COMMAND_SCHEMA_VERSION = "fhv-operator-command/v1" as const;

export const FHV_OPERATOR_STATUS_MAX_BYTES = 256 * 1024;
export const FHV_OPERATOR_STATUS_WRITE_INTERVAL_MS = 5_000;

export const FHV_STATUS_MAX_RECENT_ALERTS = 20;
export const FHV_STATUS_MAX_RECENT_SIGNALS = 10;
export const FHV_STATUS_MAX_RECENT_ORDERS = 10;
export const FHV_STATUS_MAX_RECENT_FILLS = 10;
export const FHV_STATUS_MAX_OPEN_POSITIONS = 10;
export const FHV_STATUS_MAX_HYPOTHESES = 5;
export const FHV_STATUS_MAX_CANDIDATES = 5;
export const FHV_STATUS_MAX_EVIDENCE_EVENT_IDS = 20;
export const FHV_STATUS_MAX_VETOES = 10;
export const FHV_STATUS_MAX_RISK_REDUCTIONS = 10;

export const FHV_COMMAND_MAX_TTL_MS = 15 * 60 * 1000;
export const FHV_COMMAND_RATE_LIMIT_PER_HOUR = 10;

export const FHV_DETAIL_API_DEFAULT_LIMIT = 50;
export const FHV_DETAIL_API_MAX_LIMIT = 200;

export const GIB = 1024 ** 3;

export type FhvCampaignKind = "CERTIFIED_BASELINE_FHV" | "RESEARCH_EVOLUTION_CAMPAIGN";

export type FhvOperatorAction =
  | "PAUSE_AT_CHECKPOINT"
  | "RESUME_FROM_CHECKPOINT"
  | "GRACEFUL_STOP"
  | "EMERGENCY_STOP"
  | "CREATE_DIAGNOSTIC_BUNDLE";
