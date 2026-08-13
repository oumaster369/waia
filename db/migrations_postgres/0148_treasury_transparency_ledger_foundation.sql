-- DEE-606 WP-1: Breath of WAIA Core Treasury / Transparency ledger foundation (Postgres).
-- Migration identity reserved after DEE-518 tip 0147; merge-order gate remains binding.
-- Hand-authored; do not db:generate.

CREATE TYPE "public"."treasury_tx_status" AS ENUM('DETECTED', 'MANUAL_DRAFT', 'NEEDS_REVIEW', 'CLASSIFIED', 'VERIFIED', 'RECONCILIATION_REQUIRED', 'REJECTED', 'DUPLICATE');
--> statement-breakpoint
CREATE TYPE "public"."treasury_detail_publication" AS ENUM('PRIVATE', 'DETAIL_PUBLIC', 'SUPERSEDED');
--> statement-breakpoint
CREATE TYPE "public"."treasury_tx_direction" AS ENUM('INFLOW', 'OUTFLOW', 'INTERNAL');
--> statement-breakpoint
CREATE TYPE "public"."treasury_tx_kind" AS ENUM('OPENING_BALANCE', 'CONTRIBUTION', 'EXPENSE', 'EXTERNAL_INFLOW', 'EXTERNAL_OUTFLOW', 'INTERNAL_TRANSFER', 'REFUND', 'CORRECTION', 'BALANCE_ADJUSTMENT');
--> statement-breakpoint
CREATE TYPE "public"."treasury_provenance" AS ENUM('WATCHER', 'MANUAL');
--> statement-breakpoint
CREATE TYPE "public"."treasury_budget_status" AS ENUM('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED');
--> statement-breakpoint
CREATE TYPE "public"."treasury_funding_need_status" AS ENUM('OPEN', 'PARTIALLY_FUNDED', 'FUNDED', 'CLOSED', 'CANCELLED');
--> statement-breakpoint
CREATE TYPE "public"."treasury_commitment_status" AS ENUM('DRAFT', 'APPROVED', 'RELEASED', 'FULFILLED', 'CANCELLED');
--> statement-breakpoint
CREATE TYPE "public"."treasury_evidence_kind" AS ENUM('RECEIPT', 'INVOICE', 'CONFIRMATION', 'SCREENSHOT', 'DOCUMENT', 'CHAIN_PROVENANCE');
--> statement-breakpoint
CREATE TYPE "public"."treasury_evidence_visibility" AS ENUM('ADMIN_ONLY', 'PUBLIC');
--> statement-breakpoint
CREATE TYPE "public"."treasury_attribution_status" AS ENUM('UNMATCHED', 'ATTRIBUTED', 'ANONYMOUS', 'REVOKED');
--> statement-breakpoint
CREATE TYPE "public"."treasury_address_direction_scope" AS ENUM('INBOUND', 'OUTBOUND', 'BOTH');
--> statement-breakpoint
CREATE TYPE "public"."treasury_balance_recon_status" AS ENUM('MATCHED', 'PENDING_CONFIRMATIONS', 'MISMATCH', 'UNAVAILABLE');
--> statement-breakpoint
CREATE TYPE "public"."treasury_inception_status" AS ENUM('ACTIVE', 'SUPERSEDED');
--> statement-breakpoint
CREATE TYPE "public"."treasury_ideal_budget_status" AS ENUM('DRAFT', 'ACTIVE', 'SUPERSEDED');
--> statement-breakpoint
CREATE TYPE "public"."treasury_ideal_budget_publication" AS ENUM('PRIVATE', 'PUBLIC');
--> statement-breakpoint
CREATE TYPE "public"."treasury_runway_plan_status" AS ENUM('DRAFT', 'ACTIVE', 'SUPERSEDED');
--> statement-breakpoint
CREATE TYPE "public"."treasury_observation_status" AS ENUM('OBSERVED', 'CONFIRMED', 'DROPPED');
--> statement-breakpoint
CREATE TABLE "treasury_fund_buckets" (
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_fund_buckets_pk" PRIMARY KEY("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "treasury_watched_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"network" text NOT NULL,
	"address" text NOT NULL,
	"token_contract" text NOT NULL,
	"asset_code" text NOT NULL,
	"direction_scope" "treasury_address_direction_scope" NOT NULL,
	"include_in_balance_recon" boolean DEFAULT true NOT NULL,
	"label" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_watcher_checkpoints" (
	"organization_id" uuid NOT NULL,
	"checkpoint_key" text NOT NULL,
	"last_scanned_block" text NOT NULL,
	"last_scanned_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"cycle_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_watcher_checkpoints_pk" PRIMARY KEY("organization_id","checkpoint_key")
);
--> statement-breakpoint
CREATE TABLE "treasury_evidence_objects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"storage_backend" text NOT NULL,
	"object_key" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"kind" "treasury_evidence_kind" NOT NULL,
	"visibility" "treasury_evidence_visibility" DEFAULT 'ADMIN_ONLY' NOT NULL,
	"source" text NOT NULL,
	"uploaded_by_user_id" uuid,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"currency" text NOT NULL,
	"planned_amount_micros" bigint NOT NULL,
	"status" "treasury_budget_status" NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_budgets_planned_positive" CHECK ("planned_amount_micros" > 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_funding_needs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"public_explanation" text,
	"target_stage" text,
	"required_amount_micros" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "treasury_funding_need_status" NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"budget_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_funding_needs_required_positive" CHECK ("required_amount_micros" > 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_runway_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"method" text DEFAULT 'APPROVED_PLANNED_BURN' NOT NULL,
	"currency" text NOT NULL,
	"daily_burn_micros" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"status" "treasury_runway_plan_status" NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_runway_plans_burn_positive" CHECK ("daily_burn_micros" > 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_publication_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"breath_enabled" boolean DEFAULT false NOT NULL,
	"stage_label" text,
	"work_summary" text,
	"methodology_note" text NOT NULL,
	"recent_activity_limit" integer DEFAULT 5 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_publication_settings_recent_limit_positive" CHECK ("recent_activity_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_ideal_annual_budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_year" integer NOT NULL,
	"currency" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"status" "treasury_ideal_budget_status" NOT NULL,
	"publication_state" "treasury_ideal_budget_publication" NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_ideal_annual_budgets_amount_positive" CHECK ("amount_micros" > 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_chain_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"watched_address_id" uuid NOT NULL,
	"network" text NOT NULL,
	"token_contract" text NOT NULL,
	"asset_code" text NOT NULL,
	"tx_hash" text NOT NULL,
	"transfer_index" integer NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"direction" "treasury_tx_direction" NOT NULL,
	"native_amount_atomic" bigint NOT NULL,
	"native_decimals" smallint NOT NULL,
	"block_height" text NOT NULL,
	"block_timestamp" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"confirmations_observed" integer NOT NULL,
	"confirmations_required" integer NOT NULL,
	"observation_status" "treasury_observation_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"ingestion_source" text NOT NULL,
	"raw_event_digest" text NOT NULL,
	"related_payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_chain_observations_direction_scope" CHECK ("direction" IN ('INFLOW', 'OUTFLOW')),
	CONSTRAINT "treasury_chain_observations_native_nonneg" CHECK ("native_amount_atomic" >= 0),
	CONSTRAINT "treasury_chain_observations_decimals_nonneg" CHECK ("native_decimals" >= 0),
	CONSTRAINT "treasury_chain_observations_confirmations_nonneg" CHECK ("confirmations_observed" >= 0 AND "confirmations_required" > 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "treasury_tx_status" NOT NULL,
	"detail_publication" "treasury_detail_publication" DEFAULT 'PRIVATE' NOT NULL,
	"provenance" "treasury_provenance" NOT NULL,
	"canonical_network" text,
	"canonical_token_contract" text,
	"canonical_tx_hash" text,
	"canonical_transfer_index" integer,
	"direction" "treasury_tx_direction" NOT NULL,
	"kind" "treasury_tx_kind",
	"fund_bucket_code" text DEFAULT 'UNASSIGNED' NOT NULL,
	"native_amount_atomic" bigint NOT NULL,
	"native_decimals" smallint NOT NULL,
	"native_asset" text NOT NULL,
	"native_contract" text,
	"accounting_amount_micros" bigint,
	"accounting_denomination_policy" text,
	"cash_effect_micros" bigint,
	"counterparty_is_internal" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"purpose" text,
	"category" text,
	"counterparty_display" text,
	"publish_counterparty" boolean DEFAULT false NOT NULL,
	"project_module" text,
	"milestone_stage" text,
	"budget_id" uuid,
	"funding_need_id" uuid,
	"description" text,
	"internal_notes" text,
	"public_description" text,
	"tx_hash" text,
	"corrects_transaction_id" uuid,
	"duplicate_of_transaction_id" uuid,
	"detail_superseded_by_id" uuid,
	"ledger_inception_id" uuid,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"detail_published_at" timestamp with time zone,
	"detail_published_by_user_id" uuid,
	"latest_revision_id" uuid,
	"record_content_digest" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_transactions_native_nonneg" CHECK ("native_amount_atomic" >= 0),
	CONSTRAINT "treasury_transactions_decimals_nonneg" CHECK ("native_decimals" >= 0),
	CONSTRAINT "treasury_transactions_accounting_nonneg" CHECK ("accounting_amount_micros" IS NULL OR "accounting_amount_micros" >= 0),
	CONSTRAINT "treasury_transactions_kind_direction" CHECK (
		"kind" IS NULL OR (
			("kind" = 'OPENING_BALANCE' AND "direction" = 'INFLOW') OR
			("kind" = 'CONTRIBUTION' AND "direction" = 'INFLOW') OR
			("kind" = 'EXTERNAL_INFLOW' AND "direction" = 'INFLOW') OR
			("kind" = 'EXPENSE' AND "direction" = 'OUTFLOW') OR
			("kind" = 'EXTERNAL_OUTFLOW' AND "direction" = 'OUTFLOW') OR
			("kind" = 'INTERNAL_TRANSFER' AND "direction" = 'INTERNAL') OR
			("kind" = 'REFUND' AND "direction" IN ('INFLOW', 'OUTFLOW')) OR
			("kind" = 'CORRECTION' AND "direction" IN ('INFLOW', 'OUTFLOW')) OR
			("kind" = 'BALANCE_ADJUSTMENT' AND "direction" IN ('INFLOW', 'OUTFLOW'))
		)
	),
	CONSTRAINT "treasury_transactions_cash_effect_consistency" CHECK (
		"kind" IS NULL OR "cash_effect_micros" IS NULL OR "accounting_amount_micros" IS NULL OR (
			("kind" = 'INTERNAL_TRANSFER' AND "cash_effect_micros" = 0) OR
			("kind" IN ('OPENING_BALANCE', 'CONTRIBUTION', 'EXTERNAL_INFLOW') AND "cash_effect_micros" = "accounting_amount_micros" AND "accounting_amount_micros" > 0) OR
			("kind" IN ('EXPENSE', 'EXTERNAL_OUTFLOW') AND "cash_effect_micros" = -"accounting_amount_micros" AND "accounting_amount_micros" > 0) OR
			("kind" = 'REFUND' AND (
				("direction" = 'INFLOW' AND "cash_effect_micros" = "accounting_amount_micros" AND "accounting_amount_micros" > 0) OR
				("direction" = 'OUTFLOW' AND "cash_effect_micros" = -"accounting_amount_micros" AND "accounting_amount_micros" > 0)
			)) OR
			("kind" IN ('CORRECTION', 'BALANCE_ADJUSTMENT') AND "cash_effect_micros" <> 0 AND (
				("cash_effect_micros" > 0 AND "direction" = 'INFLOW') OR
				("cash_effect_micros" < 0 AND "direction" = 'OUTFLOW')
			))
		)
	),
	CONSTRAINT "treasury_transactions_canonical_tuple_complete" CHECK (
		("canonical_network" IS NULL AND "canonical_token_contract" IS NULL AND "canonical_tx_hash" IS NULL AND "canonical_transfer_index" IS NULL)
		OR
		("canonical_network" IS NOT NULL AND "canonical_token_contract" IS NOT NULL AND "canonical_tx_hash" IS NOT NULL AND "canonical_transfer_index" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE TABLE "treasury_ledger_inceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"network" text NOT NULL,
	"token_contract" text NOT NULL,
	"asset_code" text NOT NULL,
	"inception_block" text NOT NULL,
	"inception_block_hash" text,
	"inception_time" timestamp with time zone NOT NULL,
	"opening_balance_transaction_id" uuid NOT NULL,
	"watcher_start_block" text NOT NULL,
	"evidence_object_id" uuid,
	"status" "treasury_inception_status" NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "treasury_transaction_observation_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"observation_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_tx_obs_links_role_check" CHECK ("observation_role" IN ('PRIMARY', 'INTERNAL_COUNTERPARTY', 'SECONDARY'))
);
--> statement-breakpoint
CREATE TABLE "treasury_transaction_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"patch_json" jsonb NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"reason" text,
	"content_digest" text NOT NULL,
	"prev_revision_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_evidence_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"evidence_object_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_contribution_attributions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"status" "treasury_attribution_status" NOT NULL,
	"contributor_user_id" uuid,
	"attribution_method" text NOT NULL,
	"consent_public_identity" boolean DEFAULT false NOT NULL,
	"note" text,
	"attributed_by_user_id" uuid,
	"attributed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_commitments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"budget_id" uuid,
	"amount_micros" bigint NOT NULL,
	"currency" text NOT NULL,
	"purpose" text NOT NULL,
	"counterparty_display" text,
	"publish_counterparty" boolean DEFAULT false NOT NULL,
	"detail_publication" "treasury_detail_publication" DEFAULT 'PRIVATE' NOT NULL,
	"expected_at" date,
	"effective_from" timestamp with time zone NOT NULL,
	"status" "treasury_commitment_status" NOT NULL,
	"evidence_object_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"released_by_user_id" uuid,
	"released_at" timestamp with time zone,
	"fulfilled_by_user_id" uuid,
	"fulfilled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"fulfills_transaction_id" uuid,
	"record_content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_commitments_amount_positive" CHECK ("amount_micros" > 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_commitment_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"commitment_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"patch_json" jsonb NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"reason" text,
	"content_digest" text NOT NULL,
	"prev_revision_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_runway_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"runway_plan_id" uuid NOT NULL,
	"runway_as_of" timestamp with time zone NOT NULL,
	"free_funds_at_as_of_micros" bigint NOT NULL,
	"approved_daily_burn_micros" bigint NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"input_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_runway_snapshots_burn_positive" CHECK ("approved_daily_burn_micros" > 0),
	CONSTRAINT "treasury_runway_snapshots_free_nonneg" CHECK ("free_funds_at_as_of_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "treasury_balance_reconciliations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"ledger_inception_id" uuid,
	"as_of_block" text NOT NULL,
	"as_of_time" timestamp with time zone NOT NULL,
	"observed_onchain_balance_atomic" bigint,
	"accounting_cash_balance_micros" bigint,
	"delta_micros" bigint,
	"explained_pending_micros" bigint DEFAULT 0 NOT NULL,
	"unexplained_residual_micros" bigint,
	"status" "treasury_balance_recon_status" NOT NULL,
	"tolerance_micros" bigint DEFAULT 0 NOT NULL,
	"evidence_object_id" uuid,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_balance_recon_tolerance_nonneg" CHECK ("tolerance_micros" >= 0)
);

--> statement-breakpoint
ALTER TABLE "treasury_fund_buckets" ADD CONSTRAINT "treasury_fund_buckets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_watched_addresses" ADD CONSTRAINT "treasury_watched_addresses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_watcher_checkpoints" ADD CONSTRAINT "treasury_watcher_checkpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_evidence_objects" ADD CONSTRAINT "treasury_evidence_objects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_evidence_objects" ADD CONSTRAINT "treasury_evidence_objects_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_budgets" ADD CONSTRAINT "treasury_budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_funding_needs" ADD CONSTRAINT "treasury_funding_needs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_runway_plans" ADD CONSTRAINT "treasury_runway_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_runway_plans" ADD CONSTRAINT "treasury_runway_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_runway_plans" ADD CONSTRAINT "treasury_runway_plans_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_publication_settings" ADD CONSTRAINT "treasury_publication_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_publication_settings" ADD CONSTRAINT "treasury_publication_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_ideal_annual_budgets" ADD CONSTRAINT "treasury_ideal_annual_budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_ideal_annual_budgets" ADD CONSTRAINT "treasury_ideal_annual_budgets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_ideal_annual_budgets" ADD CONSTRAINT "treasury_ideal_annual_budgets_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_chain_observations" ADD CONSTRAINT "treasury_chain_observations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_chain_observations" ADD CONSTRAINT "treasury_chain_observations_related_payment_id_payments_payment_id_fk" FOREIGN KEY ("related_payment_id") REFERENCES "public"."payments"("payment_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_detail_published_by_user_id_users_id_fk" FOREIGN KEY ("detail_published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_watched_addresses_network_address_contract_unique" ON "treasury_watched_addresses" USING btree ("network","address","token_contract");
--> statement-breakpoint
CREATE INDEX "treasury_watched_addresses_org_active_idx" ON "treasury_watched_addresses" USING btree ("organization_id","is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_budgets_org_code_unique" ON "treasury_budgets" USING btree ("organization_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_ideal_annual_budgets_active_public_unique" ON "treasury_ideal_annual_budgets" USING btree ("organization_id","period_year") WHERE "status" = 'ACTIVE' AND "publication_state" = 'PUBLIC';
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_chain_observations_idempotency_unique" ON "treasury_chain_observations" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_chain_observations_transfer_address_unique" ON "treasury_chain_observations" USING btree ("network","tx_hash","transfer_index","watched_address_id");
--> statement-breakpoint
CREATE INDEX "treasury_chain_observations_org_observed_idx" ON "treasury_chain_observations" USING btree ("organization_id","observed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_transactions_canonical_transfer_unique" ON "treasury_transactions" USING btree ("organization_id","canonical_network","canonical_token_contract","canonical_tx_hash","canonical_transfer_index") WHERE "canonical_tx_hash" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "treasury_transactions_org_status_idx" ON "treasury_transactions" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX "treasury_transactions_org_detail_pub_idx" ON "treasury_transactions" USING btree ("organization_id","detail_publication");
--> statement-breakpoint
CREATE INDEX "treasury_transactions_org_occurred_idx" ON "treasury_transactions" USING btree ("organization_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "treasury_transactions_budget_idx" ON "treasury_transactions" USING btree ("budget_id");
--> statement-breakpoint
CREATE INDEX "treasury_transactions_kind_status_idx" ON "treasury_transactions" USING btree ("kind","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_ledger_inceptions_active_unique" ON "treasury_ledger_inceptions" USING btree ("organization_id","network","token_contract") WHERE "status" = 'ACTIVE';
--> statement-breakpoint
ALTER TABLE "treasury_watched_addresses" ADD CONSTRAINT "treasury_watched_addresses_id_org_unique_fk_source" UNIQUE ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "treasury_evidence_objects" ADD CONSTRAINT "treasury_evidence_objects_id_org_unique_fk_source" UNIQUE ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "treasury_budgets" ADD CONSTRAINT "treasury_budgets_id_org_unique_fk_source" UNIQUE ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "treasury_funding_needs" ADD CONSTRAINT "treasury_funding_needs_id_org_unique_fk_source" UNIQUE ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "treasury_runway_plans" ADD CONSTRAINT "treasury_runway_plans_id_org_unique_fk_source" UNIQUE ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "treasury_chain_observations" ADD CONSTRAINT "treasury_chain_observations_id_org_unique_fk_source" UNIQUE ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_id_org_unique_fk_source" UNIQUE ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "treasury_ledger_inceptions" ADD CONSTRAINT "treasury_ledger_inceptions_id_org_unique_fk_source" UNIQUE ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "treasury_commitments" ADD CONSTRAINT "treasury_commitments_id_org_unique_fk_source" UNIQUE ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "treasury_chain_observations" ADD CONSTRAINT "treasury_chain_observations_watched_address_same_org_fk" FOREIGN KEY ("watched_address_id","organization_id") REFERENCES "public"."treasury_watched_addresses"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_fund_bucket_same_org_fk" FOREIGN KEY ("organization_id","fund_bucket_code") REFERENCES "public"."treasury_fund_buckets"("organization_id","code") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_budget_same_org_fk" FOREIGN KEY ("budget_id","organization_id") REFERENCES "public"."treasury_budgets"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_funding_need_same_org_fk" FOREIGN KEY ("funding_need_id","organization_id") REFERENCES "public"."treasury_funding_needs"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_corrects_same_org_fk" FOREIGN KEY ("corrects_transaction_id","organization_id") REFERENCES "public"."treasury_transactions"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_duplicate_of_same_org_fk" FOREIGN KEY ("duplicate_of_transaction_id","organization_id") REFERENCES "public"."treasury_transactions"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_detail_superseded_same_org_fk" FOREIGN KEY ("detail_superseded_by_id","organization_id") REFERENCES "public"."treasury_transactions"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_funding_needs" ADD CONSTRAINT "treasury_funding_needs_budget_same_org_fk" FOREIGN KEY ("budget_id","organization_id") REFERENCES "public"."treasury_budgets"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_ledger_inceptions" ADD CONSTRAINT "treasury_ledger_inceptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_ledger_inceptions" ADD CONSTRAINT "treasury_ledger_inceptions_opening_balance_same_org_fk" FOREIGN KEY ("opening_balance_transaction_id","organization_id") REFERENCES "public"."treasury_transactions"("id","organization_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_ledger_inceptions" ADD CONSTRAINT "treasury_ledger_inceptions_evidence_same_org_fk" FOREIGN KEY ("evidence_object_id","organization_id") REFERENCES "public"."treasury_evidence_objects"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_ledger_inceptions" ADD CONSTRAINT "treasury_ledger_inceptions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_ledger_inceptions" ADD CONSTRAINT "treasury_ledger_inceptions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_ledger_inception_same_org_fk" FOREIGN KEY ("ledger_inception_id","organization_id") REFERENCES "public"."treasury_ledger_inceptions"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transaction_observation_links" ADD CONSTRAINT "treasury_tx_obs_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transaction_observation_links" ADD CONSTRAINT "treasury_tx_obs_links_tx_same_org_fk" FOREIGN KEY ("transaction_id","organization_id") REFERENCES "public"."treasury_transactions"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transaction_observation_links" ADD CONSTRAINT "treasury_tx_obs_links_obs_same_org_fk" FOREIGN KEY ("observation_id","organization_id") REFERENCES "public"."treasury_chain_observations"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_tx_obs_links_tx_obs_unique" ON "treasury_transaction_observation_links" USING btree ("transaction_id","observation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_tx_obs_links_observation_unique" ON "treasury_transaction_observation_links" USING btree ("observation_id");
--> statement-breakpoint
ALTER TABLE "treasury_transaction_revisions" ADD CONSTRAINT "treasury_transaction_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transaction_revisions" ADD CONSTRAINT "treasury_transaction_revisions_tx_same_org_fk" FOREIGN KEY ("transaction_id","organization_id") REFERENCES "public"."treasury_transactions"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_transaction_revisions" ADD CONSTRAINT "treasury_transaction_revisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_transaction_revisions_tx_seq_unique" ON "treasury_transaction_revisions" USING btree ("transaction_id","seq");
--> statement-breakpoint
ALTER TABLE "treasury_evidence_links" ADD CONSTRAINT "treasury_evidence_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_evidence_links" ADD CONSTRAINT "treasury_evidence_links_tx_same_org_fk" FOREIGN KEY ("transaction_id","organization_id") REFERENCES "public"."treasury_transactions"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_evidence_links" ADD CONSTRAINT "treasury_evidence_links_evidence_same_org_fk" FOREIGN KEY ("evidence_object_id","organization_id") REFERENCES "public"."treasury_evidence_objects"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_evidence_links_tx_evidence_unique" ON "treasury_evidence_links" USING btree ("transaction_id","evidence_object_id");
--> statement-breakpoint
ALTER TABLE "treasury_contribution_attributions" ADD CONSTRAINT "treasury_contribution_attributions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_contribution_attributions" ADD CONSTRAINT "treasury_contribution_attributions_tx_same_org_fk" FOREIGN KEY ("transaction_id","organization_id") REFERENCES "public"."treasury_transactions"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_contribution_attributions" ADD CONSTRAINT "treasury_contribution_attributions_contributor_user_id_users_id_fk" FOREIGN KEY ("contributor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_contribution_attributions" ADD CONSTRAINT "treasury_contribution_attributions_attributed_by_user_id_users_id_fk" FOREIGN KEY ("attributed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_contribution_attributions_open_tx_unique" ON "treasury_contribution_attributions" USING btree ("transaction_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "treasury_commitments" ADD CONSTRAINT "treasury_commitments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitments" ADD CONSTRAINT "treasury_commitments_budget_same_org_fk" FOREIGN KEY ("budget_id","organization_id") REFERENCES "public"."treasury_budgets"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitments" ADD CONSTRAINT "treasury_commitments_evidence_same_org_fk" FOREIGN KEY ("evidence_object_id","organization_id") REFERENCES "public"."treasury_evidence_objects"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitments" ADD CONSTRAINT "treasury_commitments_fulfills_tx_same_org_fk" FOREIGN KEY ("fulfills_transaction_id","organization_id") REFERENCES "public"."treasury_transactions"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitments" ADD CONSTRAINT "treasury_commitments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitments" ADD CONSTRAINT "treasury_commitments_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitments" ADD CONSTRAINT "treasury_commitments_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitments" ADD CONSTRAINT "treasury_commitments_fulfilled_by_user_id_users_id_fk" FOREIGN KEY ("fulfilled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitments" ADD CONSTRAINT "treasury_commitments_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitment_revisions" ADD CONSTRAINT "treasury_commitment_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitment_revisions" ADD CONSTRAINT "treasury_commitment_revisions_commitment_same_org_fk" FOREIGN KEY ("commitment_id","organization_id") REFERENCES "public"."treasury_commitments"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_commitment_revisions" ADD CONSTRAINT "treasury_commitment_revisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_commitment_revisions_commitment_seq_unique" ON "treasury_commitment_revisions" USING btree ("commitment_id","seq");
--> statement-breakpoint
ALTER TABLE "treasury_runway_snapshots" ADD CONSTRAINT "treasury_runway_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_runway_snapshots" ADD CONSTRAINT "treasury_runway_snapshots_plan_same_org_fk" FOREIGN KEY ("runway_plan_id","organization_id") REFERENCES "public"."treasury_runway_plans"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_balance_reconciliations" ADD CONSTRAINT "treasury_balance_reconciliations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_balance_reconciliations" ADD CONSTRAINT "treasury_balance_reconciliations_inception_same_org_fk" FOREIGN KEY ("ledger_inception_id","organization_id") REFERENCES "public"."treasury_ledger_inceptions"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treasury_balance_reconciliations" ADD CONSTRAINT "treasury_balance_reconciliations_evidence_same_org_fk" FOREIGN KEY ("evidence_object_id","organization_id") REFERENCES "public"."treasury_evidence_objects"("id","organization_id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "treasury_balance_reconciliations_org_created_idx" ON "treasury_balance_reconciliations" USING btree ("organization_id","created_at");
