-- DEE-415 / HTR-WP18: trader accounting frontier (append-only)

CREATE TABLE "trader_accounting_frontier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_key" text NOT NULL,
	"run_id" text NOT NULL,
	"accounting_sequence" bigint NOT NULL,
	"frontier_as_of" timestamp with time zone NOT NULL,
	"cash" text NOT NULL,
	"position_quantity_json" jsonb NOT NULL,
	"gross_position_basis_json" jsonb NOT NULL,
	"net_position_basis_json" jsonb NOT NULL,
	"gross_realized_pnl" text NOT NULL,
	"net_realized_pnl" text NOT NULL,
	"marks_json" jsonb NOT NULL,
	"equity" text NOT NULL,
	"equity_hwm" text NOT NULL,
	"account_drawdown_bps" integer NOT NULL,
	"source_fill_id" uuid,
	"source_economics_digest" text NOT NULL,
	"semantic_content_digest" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_accounting_frontier_sequence_check" CHECK ("accounting_sequence" >= 1),
	CONSTRAINT "trader_accounting_frontier_drawdown_bps_check" CHECK ("account_drawdown_bps" >= 0),
	CONSTRAINT "trader_accounting_frontier_economics_digest_check" CHECK (
		"source_economics_digest" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "trader_accounting_frontier_semantic_digest_check" CHECK (
		"semantic_content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_accounting_frontier" ADD CONSTRAINT "trader_accounting_frontier_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_accounting_frontier" ADD CONSTRAINT "trader_accounting_frontier_source_fill_id_trader_fills_id_organization_id_fk" FOREIGN KEY ("source_fill_id","organization_id") REFERENCES "public"."trader_fills"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_accounting_frontier_id_organization_unique" ON "trader_accounting_frontier" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "taf_org_acct_run_seq_uq" ON "trader_accounting_frontier" USING btree ("organization_id","account_key","run_id","accounting_sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "taf_org_idempotency_key_uq" ON "trader_accounting_frontier" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "taf_org_acct_run_asof_ix" ON "trader_accounting_frontier" USING btree ("organization_id","account_key","run_id","frontier_as_of");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_accounting_frontier_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_accounting_frontier is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_accounting_frontier_block_update ON public.trader_accounting_frontier;
CREATE TRIGGER trader_accounting_frontier_block_update
  BEFORE UPDATE ON public.trader_accounting_frontier
  FOR EACH ROW EXECUTE FUNCTION public.waia_accounting_frontier_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_accounting_frontier_block_delete ON public.trader_accounting_frontier;
CREATE TRIGGER trader_accounting_frontier_block_delete
  BEFORE DELETE ON public.trader_accounting_frontier
  FOR EACH ROW EXECUTE FUNCTION public.waia_accounting_frontier_block_mutation();
