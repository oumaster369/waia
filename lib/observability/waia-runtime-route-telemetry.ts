import "server-only";

import { createAlertRouterSink } from "@/lib/observability/alerting/alert-router";
import type { PostgresDisposeOutcome } from "@/db/postgres-client";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";

/**
 * Structured stdout telemetry for `getWaiaRuntimeDb`-aware API routes (DEE-95f).
 *
 * @see docs/migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md — field meanings, triage, limitations.
 * @see docs/migrations/DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md — staging inference activation (operator).
 */
/** Stable route keys for `getWaiaRuntimeDb`-aware handlers (DEE-95f). */
export type WaiaRuntimeRouteKey =
  | "twin_engine"
  | "twin_prediction"
  | "twin_pattern_summary"
  | "twin_contradictions"
  | "twin_dialogue_turn"
  | "twin_dialogue_turns"
  | "dashboard_readiness"
  | "diary_entries"
  | "diary_scenario_answers"
  | "prediction_verification"
  | "prediction_verifications"
  | "repeatability"
  | "health_database"
  | "health_payment_watcher"
  | "health_settlement"
  | "health_settlement_reconciliation"
  | "trader_settlement_reconciliation_cases_list"
  | "trader_settlement_reconciliation_case_detail"
  | "trader_exchange_credentials_connect"
  | "trader_exchange_credentials_list"
  | "trader_exchange_credentials_sync_balances"
  | "trader_balance_snapshots_list"
  | "trader_research_runs_list"
  | "trader_exchange_credentials_sync_positions"
  | "trader_position_snapshots_list"
  | "trader_exchange_credentials_sync_trades"
  | "trader_trade_history_snapshots_list"
  | "trader_admin_organizations_list"
  | "trader_admin_audit_list"
  | "trader_admin_runtime_health"
  | "trader_admin_overview"
  | "trader_admin_kill_switches"
  | "trader_admin_kill_switch_commands"
  | "trader_admin_org_live_enable"
  | "trader_admin_org_live_enable_commands"
  | "trader_admin_strategy_promotions"
  | "trader_admin_strategy_promotion_commands"
  | "trader_admin_invoices_list"
  | "trader_admin_invoice_detail"
  | "trader_admin_invoice_commands"
  | "trader_admin_reporting_period_commands"
  | "trader_admin_billing_disputes"
  | "trader_admin_billing_dispute_commands"
  | "trader_admin_account_status"
  | "trader_admin_exchange_credentials"
  | "trader_admin_fhv_operations_status"
  | "trader_admin_fhv_operations_commands"
  | "trader_admin_fhv_operations_detail"
  | "admin_treasury_transactions"
  | "admin_treasury_transaction_commands"
  | "admin_treasury_commitments"
  | "admin_treasury_commitment_commands"
  | "admin_treasury_watched_addresses"
  | "admin_treasury_counterparties"
  | "admin_treasury_accounts"
  | "admin_treasury_categories"
  | "admin_treasury_category_budgets"
  | "admin_treasury_projects"
  | "admin_treasury_budgets"
  | "admin_treasury_funding_needs"
  | "admin_treasury_ideal_budgets"
  | "admin_treasury_ideal_budget_commands"
  | "admin_treasury_runway_plans"
  | "admin_treasury_runway_plan_commands"
  | "admin_treasury_attributions"
  | "admin_treasury_evidence"
  | "admin_treasury_evidence_content"
  | "admin_treasury_evidence_links"
  | "admin_treasury_inceptions"
  | "admin_treasury_reconciliations"
  | "admin_treasury_settings"
  | "admin_treasury_breath_preview"
  | "admin_treasury_overview_counts"
  | "admin_treasury_organizations"
  | "public_treasury"
  | "public_work_plan";

export type WaiaRuntimeRouteOutcome =
  | "success"
  | "client_error"
  | "config_error"
  | "internal_error"
  | "stale";

/** Twin dialogue gateway provider outcome — content-free (DEE-78). */
export type WaiaAiGatewayProviderOutcomeTelemetry =
  | "ok"
  | "rate_limit"
  | "timeout"
  | "provider_error"
  | "config"
  | "degraded";

export type WaiaRuntimeRouteTelemetryPayload = {
  event: "waia_runtime_route";
  route: WaiaRuntimeRouteKey;
  /** Present only after `getWaiaRuntimeDb` resolved successfully. */
  waia_db_backend?: "sqlite" | "postgres";
  http_status: number;
  outcome: WaiaRuntimeRouteOutcome;
  duration_ms: number;
  /** `Error.prototype.name` only — never log message text (privacy / PII). */
  error_class?: string;
  /**
   * Twin dialogue AI Gateway foundation path (DEE-77 / DEE-78). Content-free; no user text.
   * `live` — foundation enabled and OpenAI-compatible adapter returned assistant text.
   * Omitted on routes other than `twin_dialogue_turn` unless extended intentionally.
   */
  ai_gateway_foundation?: "off" | "fake_stub" | "live";
  /** Which completion backend handled the request when foundation path is active (DEE-78). */
  ai_gateway_provider?: "fake" | "openai-compatible";
  /** Provider-phase classification — never includes raw messages or user text (DEE-78). */
  ai_gateway_provider_outcome?: WaiaAiGatewayProviderOutcomeTelemetry;
  /** Wall time for provider-phase completion call when foundation path runs a provider. */
  ai_gateway_provider_phase_ms?: number;
  /** True when fake provider failed and assistant text fell back to product stub. */
  ai_gateway_degraded?: boolean;
  /**
   * Provider-reported token counts when present (DEE-79). Content-free; twin_dialogue_turn only.
   */
  ai_gateway_provider_prompt_tokens?: number;
  ai_gateway_provider_completion_tokens?: number;
  ai_gateway_provider_total_tokens?: number;
  /** Vendor correlation id when returned by adapter — never user text (DEE-79). */
  ai_gateway_provider_request_id?: string;
  /**
   * V1 demo readiness writer (`WAIA_READINESS_WRITER`). `twin_dialogue_turn` only; content-free.
   */
  readiness_writer_invoked?: boolean;
  readiness_writer_outcome?:
    | "disabled"
    | "replay_skipped"
    | "skipped"
    | "applied"
    | "noop"
    | "error";
  /**
   * DEE-109 bounded dialogue continuity (content-free). `off` env off; `replay_v1_standby` env on but gateway foundation off (no SQL read); `replay_v1` active path.
   */
  dialogue_continuity_mode?: "off" | "replay_v1" | "replay_v1_standby";
  /** Prior replay roles injected into provider messages (excluding current user turn); 0 when not active */
  dialogue_continuity_replay_roles_injected?: number;
  /** Total characters in replay injection only */
  dialogue_continuity_replay_chars?: number;
  /** True when builder clipped turns or omitted older replay due to caps */
  dialogue_continuity_replay_truncated?: boolean;

  /**
   * Postgres client lifecycle (DEE-110). Omitted when backend is SQLite or handle unresolved.
   */
  pg_client_lifecycle?: "per_request" | "singleton";
  /**
   * Result of {@link disposePostgresClientSafely} for per-request mode only.
   * Omitted when deferred via `waitUntil`, or for singleton / SQLite.
   */
  pg_close_outcome?: PostgresDisposeOutcome;
};

export type WaiaRuntimeRouteTelemetrySink = (line: string) => void;

const stdoutSink: WaiaRuntimeRouteTelemetrySink = (line) => {
  console.info(line);
};

const defaultSink: WaiaRuntimeRouteTelemetrySink = createAlertRouterSink(stdoutSink);

export function emitWaiaRuntimeRouteTelemetry(
  payload: WaiaRuntimeRouteTelemetryPayload,
  sink: WaiaRuntimeRouteTelemetrySink = defaultSink,
): void {
  sink(JSON.stringify(payload));
}

/** Matches misconfiguration throws from {@link getResolvedWaiaDbRuntimeConfig} and similar. */
export function isWaiaConfigError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("[waia]");
}

export function safeTelemetryErrorClass(err: unknown): string | undefined {
  if (err instanceof Error) {
    return err.name;
  }
  return undefined;
}

/** Attach DEE-110 lifecycle fields after dispose (typically in route `finally`). */
export function attachPostgresLifecycleToTelemetry(
  payload: WaiaRuntimeRouteTelemetryPayload,
  resolved: WaiaRuntimeDb | undefined,
  pgCloseOutcome: PostgresDisposeOutcome | undefined,
): void {
  if (resolved?.kind !== "postgres") {
    return;
  }
  payload.pg_client_lifecycle = resolved._sql ? "per_request" : "singleton";
  if (resolved._sql !== undefined) {
    payload.pg_close_outcome = pgCloseOutcome;
  }
}
