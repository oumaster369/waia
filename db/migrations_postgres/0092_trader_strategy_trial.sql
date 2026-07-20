-- DEE-415 / HTR-WP16: strategy trial (append-only)

CREATE TABLE "trader_strategy_trial" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" text NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"account_key" text NOT NULL,
	"portfolio_id" text NOT NULL,
	"seq" integer NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"ingest_time" timestamp with time zone NOT NULL,
	"registered_by" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_strategy_trial_ingest_after_event_check" CHECK ("ingest_time" >= "event_time"),
	CONSTRAINT "trader_strategy_trial_digest_check" CHECK ("content_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "trader_strategy_trial" ADD CONSTRAINT "trader_strategy_trial_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_strategy_trial_id_organization_unique" ON "trader_strategy_trial" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_strategy_trial_org_strategy_run_cycle_symbol_unique" ON "trader_strategy_trial" USING btree ("organization_id","strategy_id","strategy_version","run_id","cycle_id","symbol");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_strategy_trial_org_strategy_run_seq_unique" ON "trader_strategy_trial" USING btree ("organization_id","strategy_id","strategy_version","run_id","seq");
--> statement-breakpoint
CREATE INDEX "trader_strategy_trial_org_strategy_run_event_time_idx" ON "trader_strategy_trial" USING btree ("organization_id","strategy_id","strategy_version","run_id","event_time");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_strategy_trial_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_strategy_trial is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_strategy_trial_block_update ON public.trader_strategy_trial;
CREATE TRIGGER trader_strategy_trial_block_update
  BEFORE UPDATE ON public.trader_strategy_trial
  FOR EACH ROW EXECUTE FUNCTION public.waia_strategy_trial_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_strategy_trial_block_delete ON public.trader_strategy_trial;
CREATE TRIGGER trader_strategy_trial_block_delete
  BEFORE DELETE ON public.trader_strategy_trial
  FOR EACH ROW EXECUTE FUNCTION public.waia_strategy_trial_block_mutation();
