-- DEE-1050: admin console v2 tables. Identifiers only in the change log.

CREATE TABLE "trader_admin_market_quote_latest" (
  "source" text NOT NULL,
  "symbol" text NOT NULL,
  "base" text NOT NULL,
  "quote" text NOT NULL,
  "last" text,
  "bid" text,
  "ask" text,
  "open_24h" text,
  "high_24h" text,
  "low_24h" text,
  "volume_24h" text,
  "price_definition" text NOT NULL,
  "source_ts" timestamp with time zone,
  "observed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "trader_admin_market_quote_latest_pk" PRIMARY KEY ("source","symbol"),
  CONSTRAINT "trader_admin_market_quote_latest_price_definition_check" CHECK ("price_definition" IN ('last','mid'))
);
--> statement-breakpoint
CREATE TABLE "trader_admin_market_quote_minute" (
  "source" text NOT NULL,
  "symbol" text NOT NULL,
  "minute" timestamp with time zone NOT NULL,
  "close" text NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "trader_admin_market_quote_minute_pk" PRIMARY KEY ("source","symbol","minute"),
  CONSTRAINT "trader_admin_market_quote_minute_symbol_check" CHECK ("symbol" IN ('BTC-USD','ETH-USD','USDT-USD','btcusdt','ethusdt'))
);
--> statement-breakpoint
CREATE TABLE "trader_admin_fear_greed" (
  "day" date PRIMARY KEY NOT NULL,
  "value" integer NOT NULL,
  "classification" text NOT NULL,
  "source_ts" timestamp with time zone,
  "next_update_at" timestamp with time zone,
  "observed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "trader_admin_fear_greed_value_check" CHECK ("value" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "trader_admin_change_log" (
  "seq" bigserial PRIMARY KEY NOT NULL,
  "xid" xid8 NOT NULL,
  "changed_at" timestamp with time zone NOT NULL,
  "source_table" text NOT NULL,
  "op" text NOT NULL,
  "entity_id" text NOT NULL,
  "organization_id" uuid,
  "entity_version" bigint,
  CONSTRAINT "trader_admin_change_log_op_check" CHECK ("op" IN ('INSERT','UPDATE','DELETE'))
);
--> statement-breakpoint
CREATE INDEX "trader_admin_change_log_xid_idx" ON "trader_admin_change_log" USING btree ("xid");
--> statement-breakpoint
CREATE INDEX "trader_admin_change_log_changed_at_idx" ON "trader_admin_change_log" USING btree ("changed_at");
--> statement-breakpoint
CREATE TABLE "trader_admin_news_item" (
  "id" uuid PRIMARY KEY NOT NULL,
  "dedupe_key" text NOT NULL,
  "cluster_key" text,
  "source" text NOT NULL,
  "url" text NOT NULL,
  "published_at" timestamp with time zone,
  "first_observed_at" timestamp with time zone NOT NULL,
  "symbols" text[] NOT NULL DEFAULT '{}',
  "category" text NOT NULL,
  "current_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "trader_admin_news_item_dedupe_key_unique" UNIQUE ("dedupe_key"),
  CONSTRAINT "trader_admin_news_item_category_check" CHECK ("category" IN ('news','announcement','macro','regulation','protocol'))
);
--> statement-breakpoint
CREATE INDEX "trader_admin_news_item_cluster_key_idx" ON "trader_admin_news_item" USING btree ("cluster_key");
--> statement-breakpoint
CREATE INDEX "trader_admin_news_item_first_observed_at_idx" ON "trader_admin_news_item" USING btree ("first_observed_at" DESC);
--> statement-breakpoint
CREATE TABLE "trader_admin_news_item_version" (
  "news_item_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "content_hash" text NOT NULL,
  "observed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "trader_admin_news_item_version_pk" PRIMARY KEY ("news_item_id","version"),
  CONSTRAINT "trader_admin_news_item_version_title_check" CHECK (char_length("title") <= 500),
  CONSTRAINT "trader_admin_news_item_version_summary_check" CHECK ("summary" IS NULL OR char_length("summary") <= 500),
  CONSTRAINT "trader_admin_news_item_version_news_item_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "trader_admin_news_item"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "trader_admin_account_valuation" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "exchange_account_id" text NOT NULL,
  "valuation_key" text NOT NULL,
  "observation_id" uuid,
  "observation_recorded_at" timestamp with time zone,
  "lots_revision" text NOT NULL,
  "quote_set_json" jsonb NOT NULL,
  "quote_set_digest" text NOT NULL,
  "method_version" text NOT NULL,
  "equity" text NOT NULL,
  "free_quote" text NOT NULL,
  "locked_quote" text NOT NULL,
  "holdings_value" text NOT NULL,
  "trader_lots_value" text NOT NULL,
  "trader_cost_basis" text NOT NULL,
  "trader_unrealized" text NOT NULL,
  "currency" text NOT NULL DEFAULT 'USDT',
  "state" text NOT NULL,
  "reasons" jsonb NOT NULL DEFAULT '[]',
  "computed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "trader_admin_account_valuation_key_unique" UNIQUE ("organization_id","exchange_account_id","valuation_key")
);
--> statement-breakpoint
CREATE INDEX "trader_admin_account_valuation_computed_at_idx" ON "trader_admin_account_valuation" USING btree ("organization_id","exchange_account_id","computed_at" DESC);
--> statement-breakpoint
CREATE TABLE "trader_admin_equity_point" (
  "organization_id" uuid NOT NULL,
  "exchange_account_id" text NOT NULL,
  "bucket" timestamp with time zone NOT NULL,
  "equity" text NOT NULL,
  "trader_unrealized" text NOT NULL,
  "valuation_key" text NOT NULL,
  "method_version" text NOT NULL,
  "state" text NOT NULL,
  CONSTRAINT "trader_admin_equity_point_pk" PRIMARY KEY ("organization_id","exchange_account_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "trader_admin_diagnostic_event" (
  "id" uuid PRIMARY KEY NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "service" text NOT NULL,
  "environment" text NOT NULL,
  "release" text,
  "severity" text NOT NULL,
  "error_class" text NOT NULL,
  "message_redacted" text NOT NULL,
  "stack_redacted" text,
  "fingerprint" text NOT NULL,
  "route" text,
  "organization_id" uuid,
  "exchange_account_id" text,
  "strategy_id" text,
  "stage" text,
  "cycle_id" text,
  "order_id" text,
  "trace_id" text,
  "context_json" jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT "trader_admin_diagnostic_event_severity_check" CHECK ("severity" IN ('fatal','error','warning')),
  CONSTRAINT "trader_admin_diagnostic_event_message_check" CHECK (char_length("message_redacted") <= 2000),
  CONSTRAINT "trader_admin_diagnostic_event_stack_check" CHECK ("stack_redacted" IS NULL OR char_length("stack_redacted") <= 16000)
);
--> statement-breakpoint
CREATE INDEX "trader_admin_diagnostic_event_occurred_at_idx" ON "trader_admin_diagnostic_event" USING btree ("occurred_at" DESC);
--> statement-breakpoint
CREATE TABLE "trader_admin_incident" (
  "id" uuid PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "service" text NOT NULL,
  "fingerprint" text NOT NULL,
  "title" text NOT NULL,
  "severity" text NOT NULL,
  "status" text NOT NULL,
  "first_seen_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "occurrences" integer NOT NULL DEFAULT 1,
  "affected_accounts" integer NOT NULL DEFAULT 0,
  "first_release" text,
  "last_release" text,
  "resolved_at" timestamp with time zone,
  "resolved_release" text,
  "assignee" text,
  "fix_url" text,
  "muted_until" timestamp with time zone,
  "note" text,
  "state_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "trader_admin_incident_environment_service_fingerprint_unique" UNIQUE ("environment","service","fingerprint"),
  CONSTRAINT "trader_admin_incident_status_check" CHECK ("status" IN ('new','investigating','fix_prepared','deployed_verifying','resolved','regressed'))
);
--> statement-breakpoint
CREATE INDEX "trader_admin_incident_status_last_seen_idx" ON "trader_admin_incident" USING btree ("status","last_seen_at" DESC);
--> statement-breakpoint
CREATE TABLE "trader_admin_incident_event" (
  "id" uuid PRIMARY KEY NOT NULL,
  "incident_id" uuid NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_user_id" uuid,
  "reason" text,
  "evidence" text,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "trader_admin_incident_event_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "trader_admin_incident"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "trader_admin_job_run" (
  "id" uuid PRIMARY KEY NOT NULL,
  "job_key" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone,
  "status" text NOT NULL,
  "processed" integer NOT NULL DEFAULT 0,
  "blocked" integer NOT NULL DEFAULT 0,
  "error_class" text,
  "error_message_redacted" text,
  "release" text,
  "details_json" jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT "trader_admin_job_run_status_check" CHECK ("status" IN ('running','succeeded','failed','skipped'))
);
--> statement-breakpoint
CREATE INDEX "trader_admin_job_run_job_key_started_at_idx" ON "trader_admin_job_run" USING btree ("job_key","started_at" DESC);
--> statement-breakpoint
CREATE TABLE "trader_admin_assistant_conversation" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "admin_user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "trader_admin_assistant_conversation_admin_user_idx" ON "trader_admin_assistant_conversation" USING btree ("admin_user_id","updated_at" DESC);
--> statement-breakpoint
CREATE TABLE "trader_admin_assistant_message" (
  "id" uuid PRIMARY KEY NOT NULL,
  "conversation_id" uuid NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "blocks_json" jsonb,
  "status" text NOT NULL,
  "scope_json" jsonb,
  "attachments_json" jsonb,
  "citations_json" jsonb,
  "data_revisions_json" jsonb,
  "cache_key" text,
  "provider" text,
  "model" text,
  "provider_lifecycle" text,
  "prompt_version" text,
  "tool_policy_version" text,
  "latency_ms" integer,
  "usage_json" jsonb,
  "error_code" text,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "trader_admin_assistant_message_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "trader_admin_assistant_conversation"("id") ON DELETE cascade,
  CONSTRAINT "trader_admin_assistant_message_role_check" CHECK ("role" IN ('user','assistant')),
  CONSTRAINT "trader_admin_assistant_message_status_check" CHECK ("status" IN ('pending','complete','failed','stopped','provider_unavailable'))
);
--> statement-breakpoint
CREATE TABLE "trader_admin_assistant_tool_call" (
  "id" uuid PRIMARY KEY NOT NULL,
  "message_id" uuid NOT NULL,
  "tool_name" text NOT NULL,
  "tool_version" text NOT NULL,
  "args_json" jsonb NOT NULL,
  "result_digest" text,
  "result_summary_json" jsonb,
  "status" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone,
  "error_code" text,
  CONSTRAINT "trader_admin_assistant_tool_call_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "trader_admin_assistant_message"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "trader_admin_saved_view" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "admin_user_id" uuid NOT NULL,
  "section" text NOT NULL,
  "name" text NOT NULL,
  "state_json" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_admin_visit_marker" (
  "admin_user_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "previous_seen_at" timestamp with time zone
);
