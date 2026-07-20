-- DEE-415 / HTR-WP16: strategy drawdown checkpoint (append-only)

CREATE TABLE "trader_strategy_drawdown_checkpoint" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_key" text NOT NULL,
	"portfolio_id" text NOT NULL,
	"run_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" text NOT NULL,
	"seq" integer NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"strategy_allocation_usdt" text NOT NULL,
	"strategy_equity_usdt" text NOT NULL,
	"strategy_peak_hwm" text NOT NULL,
	"strategy_drawdown_bps" integer NOT NULL,
	"breach_state" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_strategy_drawdown_checkpoint_breach_state_check" CHECK (
		"breach_state" IN ('NONE','CLOSE_ONLY','STOP_ACCOUNT')
	),
	CONSTRAINT "trader_strategy_drawdown_checkpoint_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_strategy_drawdown_checkpoint" ADD CONSTRAINT "trader_strategy_drawdown_checkpoint_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_strategy_drawdown_checkpoint_id_organization_unique" ON "trader_strategy_drawdown_checkpoint" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tsdd_chkpt_org_acct_run_strat_ver_seq_uq" ON "trader_strategy_drawdown_checkpoint" USING btree ("organization_id","account_key","portfolio_id","run_id","strategy_id","strategy_version","seq");
--> statement-breakpoint
CREATE INDEX "tsdd_chkpt_org_acct_run_strat_ver_asof_ix" ON "trader_strategy_drawdown_checkpoint" USING btree ("organization_id","account_key","portfolio_id","run_id","strategy_id","strategy_version","as_of");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_strategy_drawdown_checkpoint_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_strategy_drawdown_checkpoint is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_strategy_drawdown_checkpoint_block_update ON public.trader_strategy_drawdown_checkpoint;
CREATE TRIGGER trader_strategy_drawdown_checkpoint_block_update
  BEFORE UPDATE ON public.trader_strategy_drawdown_checkpoint
  FOR EACH ROW EXECUTE FUNCTION public.waia_strategy_drawdown_checkpoint_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_strategy_drawdown_checkpoint_block_delete ON public.trader_strategy_drawdown_checkpoint;
CREATE TRIGGER trader_strategy_drawdown_checkpoint_block_delete
  BEFORE DELETE ON public.trader_strategy_drawdown_checkpoint
  FOR EACH ROW EXECUTE FUNCTION public.waia_strategy_drawdown_checkpoint_block_mutation();
